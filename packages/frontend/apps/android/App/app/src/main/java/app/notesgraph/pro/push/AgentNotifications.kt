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
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import app.notesgraph.pro.R

/**
 * The notification for an agent run that is waiting on the phone's owner.
 *
 * Small things are answered right from the shade: Allow / Deny for a tool,
 * a choice or a typed reply for a question. Tapping it opens
 * [AgentQuestionActivity], which shows the whole tool input first - a
 * command should be read before it is allowed, and a push carries only the
 * start of it.
 *
 * One notification per question, tagged with its id, so answering or
 * closing one never touches another run's.
 */
object AgentNotifications {
    const val CHANNEL_ID = "agent-questions"
    private const val NOTIFICATION_ID = 1
    /** How long "Sent" stays up before it clears itself. */
    private const val SENT_TIMEOUT_MS = 4_000L

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Agents waiting on you",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "An agent run needs a permission or an answer from you."
            }
        )
    }

    fun show(context: Context, question: AgentQuestion, error: String? = null) {
        ensureChannel(context)
        val title = if (question.isPermission) {
            "${question.agentName} wants permission"
        } else {
            "${question.agentName} asks you"
        }
        val body = buildString {
            append(question.text)
            if (question.isPermission && question.detail.isNotEmpty()) {
                append("\n\n").append(question.detail)
            }
        }
        val builder = base(context, question)
            .setContentTitle(title)
            .setContentText(question.text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setOnlyAlertOnce(error != null)
            .setContentIntent(openIntent(context, question))
            // The lock screen says only that something is waiting: a command
            // or an answer about someone's family is not for a passer-by.
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(
                base(context, question)
                    .setContentTitle(title)
                    .setContentText("Unlock to see it and answer.")
                    .build()
            )
        if (error != null) builder.setSubText("Not sent: $error")

        if (question.isPermission) {
            builder.addAction(button(context, question, "Allow", AgentAnswerReceiver.ALLOW))
            builder.addAction(button(context, question, "Deny", AgentAnswerReceiver.DENY))
            builder.addAction(replyAction(context, question, "Deny with note", emptyList()))
        } else {
            // Android shows three actions; the reply keeps one, and offers
            // every choice as a chip besides.
            question.options.take(2).forEach { option ->
                builder.addAction(
                    button(context, question, option, AgentAnswerReceiver.OPTION, option)
                )
            }
            builder.addAction(replyAction(context, question, "Reply", question.options))
        }
        post(context, question.questionId, builder)
    }

    /** The answer landed: say so briefly, then get out of the way. */
    fun sent(context: Context, question: AgentQuestion, summary: String) {
        val builder = base(context, question)
            .setContentTitle(question.agentName)
            .setContentText(summary)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOnlyAlertOnce(true)
            .setTimeoutAfter(SENT_TIMEOUT_MS)
        post(context, question.questionId, builder)
    }

    fun cancel(context: Context, questionId: String) {
        NotificationManagerCompat.from(context).cancel(questionId, NOTIFICATION_ID)
    }

    private fun base(context: Context, question: AgentQuestion) =
        NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_ai)
            .setAutoCancel(true)
            .setGroup("agent-job-${question.jobId}")

    @SuppressLint("MissingPermission")
    private fun post(context: Context, tag: String, builder: NotificationCompat.Builder) {
        // Without the Android 13 notification permission there is nothing to
        // show; the question still waits in the app.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) return
        NotificationManagerCompat.from(context).notify(tag, NOTIFICATION_ID, builder.build())
    }

    private fun requestCode(question: AgentQuestion, action: String, extra: String = "") =
        "${question.questionId}:$action:$extra".hashCode()

    private fun openIntent(context: Context, question: AgentQuestion): PendingIntent {
        val intent = Intent(context, AgentQuestionActivity::class.java)
            .putExtras(question.toBundle())
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return PendingIntent.getActivity(
            context, requestCode(question, "open"), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun answerIntent(
        context: Context,
        question: AgentQuestion,
        action: String,
        option: String = "",
    ): PendingIntent {
        val intent = Intent(context, AgentAnswerReceiver::class.java)
            .setAction(action)
            .putExtras(question.toBundle())
            .putExtra(AgentAnswerReceiver.EXTRA_OPTION, option)
        return PendingIntent.getBroadcast(
            context, requestCode(question, action, option), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun replyAction(
        context: Context,
        question: AgentQuestion,
        label: String,
        choices: List<String>,
    ): NotificationCompat.Action {
        val input = RemoteInput.Builder(AgentAnswerReceiver.KEY_REPLY)
            .setLabel(if (question.isPermission) "Tell it what to do instead" else "Your answer")
            .apply { if (choices.isNotEmpty()) setChoices(choices.toTypedArray()) }
            .build()
        val intent = Intent(context, AgentAnswerReceiver::class.java)
            .setAction(AgentAnswerReceiver.REPLY)
            .putExtras(question.toBundle())
        // Mutable: the system writes the typed reply into this intent.
        val pending = PendingIntent.getBroadcast(
            context, requestCode(question, AgentAnswerReceiver.REPLY), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )
        return NotificationCompat.Action.Builder(0, label, pending)
            .addRemoteInput(input)
            .setAllowGeneratedReplies(false)
            .setAuthenticationRequired(true)
            .build()
    }

    /**
     * An answer button. It needs the phone unlocked first (Android 12+), so
     * anyone picking up a locked phone can't allow a tool from the lock screen.
     */
    private fun button(
        context: Context,
        question: AgentQuestion,
        label: String,
        action: String,
        option: String = "",
    ) = NotificationCompat.Action.Builder(0, label, answerIntent(context, question, action, option))
        .setAuthenticationRequired(true)
        .build()
}
