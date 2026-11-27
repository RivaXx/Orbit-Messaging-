package com.orbit.messenger

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.TimeZone

internal object OrbitNoteAlarms {
    private const val channel = "orbit-note-reminders"
    private const val scheduled = "com.orbit.messenger.NOTE_DUE"
    private const val snooze = "com.orbit.messenger.NOTE_SNOOZE"
    const val open = "com.orbit.messenger.NOTE_OPEN"
    private const val day = 86_400_000L
    private val uuid = Regex("[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}")
    private val zones by lazy { TimeZone.getAvailableIDs().toSet() }
    private fun prefs(context: Context) = context.getSharedPreferences("orbit-note-alarms", Context.MODE_PRIVATE)
    private fun rows(value: String?): List<JSONObject> = runCatching {
        val items = JSONArray(value ?: "[]")
        (0 until items.length()).mapNotNull(items::optJSONObject)
    }.getOrDefault(emptyList())

    private fun action(context: Context, action: String, id: String = ""): PendingIntent {
        val intent = if (action == open) Intent(context, OrbitActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
        else Intent(context, OrbitNoteAlarmReceiver::class.java)
        intent.action = action
        intent.data = Uri.parse("orbit-note://alarm/" + id)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        return if (action == open) PendingIntent.getActivity(context, 0, intent, flags)
        else PendingIntent.getBroadcast(context, 0, intent, flags)
    }
    private fun show(context: Context, id: String) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        if (!manager.areNotificationsEnabled()) return
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(
            NotificationChannel(channel, "Note reminders", NotificationManager.IMPORTANCE_HIGH)
        )
        val notice = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.orbit_notification)
            .setContentTitle("Orbit note reminder")
            .setContentText("Your note is due")
            .setContentIntent(action(context, open, id))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setDefaults(Notification.DEFAULT_SOUND)
            .addAction(0, "Snooze 10 min", action(context, snooze, id))
            .build()
        manager.notify(channel + id, 1, notice)
    }
    private fun next(row: JSONObject, now: Long): Long? {
        val anchor = row.optLong("at")
        val last = row.optLong("last")
        val snoozed = maxOf(row.optLong("snooze"), row.optLong("localSnooze"))
        if (snoozed > last && snoozed >= now - day) return snoozed
        if (snoozed > 0 && row.optString("repeat") == "none") return null
        val floor = maxOf(now - day + 1, last + 1)
        val step = when (row.optString("repeat")) {"daily" -> 1; "weekly" -> 7; else -> 0}
        if (step == 0 || anchor >= floor) return anchor.takeIf { it >= floor }
        val zone = row.optString("zone").takeIf { it in zones } ?: "UTC"
        val source = Calendar.getInstance(TimeZone.getTimeZone(zone)).apply { timeInMillis = anchor }
        val jump = ((floor - anchor) / (step * day) - 1).coerceAtLeast(0).coerceAtMost(100000).toInt()
        val calendar = (source.clone() as Calendar).apply { add(Calendar.DAY_OF_MONTH, jump * step) }
        var count = jump
        while (calendar.timeInMillis < floor) {
            count++
            calendar.timeInMillis = source.timeInMillis
            calendar.add(Calendar.DAY_OF_MONTH, count * step)
        }
        val following = (source.clone() as Calendar).apply { add(Calendar.DAY_OF_MONTH, (count + 1) * step) }
        return if (following.timeInMillis <= now) following.timeInMillis else calendar.timeInMillis
    }
    private fun setAlarm(context: Context, data: List<JSONObject>, now: Long) {
        val manager = context.getSystemService(AlarmManager::class.java)
        val token = action(context, scheduled)
        val due = data.mapNotNull { next(it, now) }.minOrNull()
        if (due == null) {
            manager.cancel(token)
            return
        }
        val trigger = maxOf(due, now + 1_000)
        if (Build.VERSION.SDK_INT < 31 || manager.canScheduleExactAlarms()) {
            if (runCatching { manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, token) }.isSuccess) return
        }
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, token)
    }
    private fun store(context: Context, owner: String, data: List<JSONObject>) {
        check(prefs(context).edit().putString("account", owner).putString("notes", JSONArray(data).toString()).commit())
    }

    @Synchronized fun sync(context: Context, account: String, raw: JSONArray) {
        require(uuid.matches(account) && raw.length() <= 5_000)
        val previous = prefs(context)
        val previousRows = rows(previous.getString("notes", null))
        val old = if (previous.getString("account", null) == account) previousRows.associateBy { it.getString("id") } else emptyMap()
        val assigned = (0 until raw.length()).map { index ->
            val row = raw.getJSONObject(index)
            val id = row.getString("id")
            require(uuid.matches(id) && row.getLong("at") in 1..9_000_000_000_000L)
            val oldRow = old[id]
            val sameRule = oldRow != null && listOf("at", "snooze", "repeat", "zone").all { row.optString(it) == oldRow.optString(it) }
            if (sameRule && oldRow != null) {
                row.put("last", oldRow.optLong("last"))
                row.put("localSnooze", oldRow.optLong("localSnooze"))
            }
            row
        }
        val active = assigned.map { it.getString("id") }.toSet()
        val manager = context.getSystemService(NotificationManager::class.java)
        previousRows.filter { old.isEmpty() || it.getString("id") !in active }.forEach {
            manager.cancel(channel + it.getString("id"), 1)
        }
        store(context, account, assigned)
        setAlarm(context, assigned, System.currentTimeMillis())
    }

    @Synchronized fun clear(context: Context, account: String) {
        if (prefs(context).getString("account", null) == account) sync(context, account, JSONArray())
    }

    @Synchronized fun noteLink(context: Context, intent: Intent): String? {
        if (intent.action != open) return null
        val id = intent.data?.lastPathSegment ?: return null
        return id.takeIf { uuid.matches(it) && rows(prefs(context).getString("notes", null)).any { row -> row.optString("id") == it } }
    }

    @Synchronized fun receive(context: Context, intent: Intent) {
        val prefs = prefs(context)
        val owner = prefs.getString("account", null) ?: return
        val data = rows(prefs.getString("notes", null))
        val now = System.currentTimeMillis()
        when (intent.action) {
            scheduled -> {
                val due = data.mapNotNull { row ->
                    next(row, now)?.takeIf { it <= now }?.let { row to it }
                }
                for ((row, instant) in due) {
                    row.put("last", instant)
                    if (row.optLong("localSnooze") <= instant) row.remove("localSnooze")
                }
                if (due.isNotEmpty()) store(context, owner, data)
                for ((row, _) in due) show(context, row.getString("id"))
            }
            snooze -> {
                val id = intent.data?.lastPathSegment
                val row = data.find { it.optString("id") == id } ?: return
                row.put("localSnooze", now + 600_000)
                store(context, owner, data)
                context.getSystemService(NotificationManager::class.java).cancel(channel + id, 1)
            }
        }
        setAlarm(context, data, now)
    }
}

class OrbitNoteAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        runCatching { OrbitNoteAlarms.receive(context, intent) }
    }
}
