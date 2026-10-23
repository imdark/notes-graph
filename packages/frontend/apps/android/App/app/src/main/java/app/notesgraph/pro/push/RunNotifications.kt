package app.notesgraph.pro.push

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.notesgraph.pro.R

/**
 * "An agent run ended": done, waiting on a review (its task is committed),
 * deployed, blocked, or failed. Its own channel, quieter than questions,
 * since nothing is held up waiting. One notification per run, tagged with
 * its job id, so a repeated report replaces rather than stacks. Tapping it
 * opens the run's note, which has the full account.
 */
object RunNotifications {
    private const val CHANNEL_ID = "agent-runs"
    private const val NOTIFICATION_ID = 3

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Agent runs finished",
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = "An agent run you started is done, ready for review, deployed, blocked or failed."
            }
        )
    }

    private fun headline(outcome: String) = when (outcome) {
        "review" -> "Ready for review"
        "deployed" -> "Deployed"
        "blocked" -> "Blocked"
        "failed" -> "Failed"
        else -> "Done"
    }

    @SuppressLint("MissingPermission")
    fun show(context: Context, data: Map<String, String>) {
        val jobId = data["jobId"] ?: return
        val name = data["title"].orEmpty().ifEmpty { data["agentName"].orEmpty() }
            .ifEmpty { "Agent run" }
        val title = "${headline(data["outcome"].orEmpty())}: $name"
        val body = data["text"].orEmpty()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) return
        ensureChannel(context)

        // Opens the note the run was on, or the Agents page for one on none.
        val open = PendingIntent.getActivity(
            context,
            jobId.hashCode(),
            NotificationTarget.intent(
                context, data["workspaceId"], data["docId"], data["blockId"]
            ),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        fun builder() = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_ai)
            .setContentTitle(title)
            .setAutoCancel(true)
            .setContentIntent(open)
        val notification = builder()
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            // The summary may quote the note; the lock screen gets only the outcome.
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(builder().setContentText("Unlock to see it.").build())
        NotificationManagerCompat.from(context).notify(jobId, NOTIFICATION_ID, notification.build())
    }
}
