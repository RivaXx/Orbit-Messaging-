package com.orbit.messenger

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.content.ContextCompat
import org.json.JSONObject

internal class OrbitNotifications(private val activity: Activity) {
    private val manager = activity.getSystemService(NotificationManager::class.java)
    private val prefs = activity.getSharedPreferences("orbit-notification-permission", Activity.MODE_PRIVATE)

    fun enabled(): Boolean = NotificationManagerCompat.from(activity).areNotificationsEnabled() &&
        (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)

    fun request(launcher: (String) -> Unit, done: (Boolean) -> Unit) {
        when {
            enabled() -> done(true)
            Build.VERSION.SDK_INT >= 33 && (!prefs.getBoolean("requested", false) || activity.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) -> {
                prefs.edit().putBoolean("requested", true).apply()
                launcher(Manifest.permission.POST_NOTIFICATIONS)
            }
            else -> {
                val settings = if (Build.VERSION.SDK_INT >= 26) {
                    Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
                } else Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${activity.packageName}"))
                activity.startActivity(settings)
                done(false)
            }
        }
    }

    fun show(args: JSONObject, unlocked: Boolean): Boolean {
        if (!enabled()) return false
        val kind = args.optString("kind")
        val tag = args.getString("tag")
        require(kind in setOf("message", "call", "reminder", "test") && tag.length in 1..100)
        val silent = args.optBoolean("silent")
        val channel = if (silent) "orbit-silent-v1" else if (kind == "call") "orbit-calls-v1" else "orbit-messages-v1"
        if (Build.VERSION.SDK_INT >= 26) {
            val name = if (silent) "Silent Orbit alerts" else if (kind == "call") "Orbit calls" else "Orbit messages and reminders"
            val importance = if (silent) NotificationManager.IMPORTANCE_LOW else NotificationManager.IMPORTANCE_HIGH
            manager.createNotificationChannel(NotificationChannel(channel, name, importance))
            if (manager.getNotificationChannel(channel)?.importance == NotificationManager.IMPORTANCE_NONE) return false
        }
        val launch = Intent(activity, OrbitActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val tap = PendingIntent.getActivity(activity, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val defaultText = if (kind == "call") "Incoming Orbit call" else if (kind == "reminder") "An Orbit reminder is due" else "You have a new message."
        val preview = unlocked && args.optBoolean("preview")
        val builder = NotificationCompat.Builder(activity, channel).setSmallIcon(R.drawable.orbit_notification)
            .setContentTitle(if (preview || kind == "test") args.optString("title", "Orbit").take(80) else "Orbit Messenger")
            .setContentText(if (preview || kind == "test") args.optString("body", defaultText).take(160) else defaultText)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setAutoCancel(true).setOnlyAlertOnce(true).setSilent(silent)
            .setPriority(if (silent) NotificationCompat.PRIORITY_LOW else NotificationCompat.PRIORITY_HIGH).setContentIntent(tap)
        if (!silent && Build.VERSION.SDK_INT < 26) builder.setDefaults(NotificationCompat.DEFAULT_ALL)
        if (kind == "call") builder.setCategory(NotificationCompat.CATEGORY_CALL).setTimeoutAfter(45000)
        try { manager.notify(tag, 0, builder.build()) } catch (_: SecurityException) { return false }
        return true
    }

    fun clear(tag: String) = manager.cancel(tag, 0)
    fun clearAll() = manager.cancelAll()

    fun incomingCall(id: String, caller: String, token: String, silent: Boolean, remaining: Long) {
        if (!enabled()) return
        val channel = if (silent) "orbit-incoming-silent-v2" else "orbit-incoming-v2"
        if (Build.VERSION.SDK_INT >= 26) {
            val configured = NotificationChannel(channel, if (silent) "Silent incoming calls" else "Incoming calls", NotificationManager.IMPORTANCE_HIGH)
            if (silent) {
                configured.setSound(null, null)
                configured.enableVibration(false)
            } else {
                configured.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build())
            }
            manager.createNotificationChannel(configured)
            if (manager.getNotificationChannel(channel)?.importance == NotificationManager.IMPORTANCE_NONE) return
        }
        fun action(kind: String, number: Int): PendingIntent {
            val target = Intent(activity, OrbitActivity::class.java).setAction("com.orbit.messenger.CALL")
                .setData(Uri.parse("orbit-call://incoming/$id/$kind"))
                .putExtra("orbit-call-token", token).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            return PendingIntent.getActivity(activity, number, target, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
        val view = action("view", 1)
        val decline = action("decline", 2)
        val answer = action("answer", 3)
        val person = Person.Builder().setName(caller).setImportant(true).build()
        val canOpenFullScreen = !silent && (Build.VERSION.SDK_INT < 34 || manager.canUseFullScreenIntent())
        val base = NotificationCompat.Builder(activity, channel).setSmallIcon(R.drawable.orbit_notification)
            .setContentTitle(caller).setContentText("Incoming Orbit call").setContentIntent(view)
            .setCategory(NotificationCompat.CATEGORY_CALL).setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setOngoing(true).setTimeoutAfter(remaining)
        if (Build.VERSION.SDK_INT < 26 && !silent) base.setDefaults(NotificationCompat.DEFAULT_ALL)
        val tag = "orbit-call-$id"
        // Android requires a full-screen intent or foreground service for CallStyle.
        if (canOpenFullScreen || Build.VERSION.SDK_INT < 31) {
            try {
                if (canOpenFullScreen) base.setFullScreenIntent(view, true)
                base.setStyle(NotificationCompat.CallStyle.forIncomingCall(person, decline, answer))
                manager.notify(tag, 0, base.build())
                return
            } catch (_: IllegalArgumentException) {
                base.setStyle(null).setFullScreenIntent(null, false)
            }
        }
        base.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", decline)
            .addAction(android.R.drawable.sym_action_call, "Answer", answer)
        manager.notify(tag, 0, base.build())
    }
}
