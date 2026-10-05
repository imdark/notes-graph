package app.notesgraph.pro.push

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.notesgraph.pro.MainActivity
import app.notesgraph.pro.R

/**
 * "A monitor saw something": a price dropped below its threshold, a value
 * changed. Informational, so it has its own quieter channel than the agent
 * questions, and one notification per monitor (a newer reading replaces
 * the older one). Tapping it opens the app; the value is also in the note
 * the monitor keeps up to date.
 */
object MonitorNotifications {
    private const val CHANNEL_ID = "monitor-alerts"
    private const val NOTIFICATION_ID = 2

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Monitor alerts",
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = "A monitor you set up saw a change or crossed its threshold."
            }
        )
    }

    @SuppressLint("MissingPermission")
    fun show(context: Context, data: Map<String, String>) {
        val monitorId = data["monitorId"] ?: return
        val name = data["name"].orEmpty().ifEmpty { "Monitor" }
        val value = data["value"].orEmpty()
        val reason = data["reason"].orEmpty()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) return
        ensureChannel(context)

        val open = PendingIntent.getActivity(
            context,
            monitorId.hashCode(),
            Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val body = listOf(value, reason).filter { it.isNotEmpty() }.joinToString(" · ")
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_ai)
            .setContentTitle(name)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(open)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        NotificationManagerCompat.from(context).notify(monitorId, NOTIFICATION_ID, builder.build())
    }
}
