package com.orbit.messenger

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
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
}
