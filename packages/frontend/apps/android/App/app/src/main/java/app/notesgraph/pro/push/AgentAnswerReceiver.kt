package app.notesgraph.pro.push

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject
import timber.log.Timber

/** Answers a question from its notification's buttons, without the app. */
class AgentAnswerReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val question = AgentQuestion.fromBundle(intent.extras) ?: return
        val reply = RemoteInput.getResultsFromIntent(intent)
            ?.getCharSequence(KEY_REPLY)?.toString()?.trim().orEmpty()
        val (body, summary) = when (intent.action) {
            ALLOW -> JSONObject().put("allowed", true) to "Allowed"
            DENY -> JSONObject().put("allowed", false) to "Denied"
            OPTION -> {
                val option = intent.getStringExtra(EXTRA_OPTION).orEmpty()
                JSONObject().put("answer", option) to "Answered: $option"
            }
            REPLY -> {
                if (reply.isEmpty()) return
                if (question.isPermission) {
                    JSONObject().put("allowed", false).put("answer", reply) to "Denied with your note"
                } else {
                    JSONObject().put("answer", reply) to "Answered: $reply"
                }
            }
            else -> return
        }

        val pending = goAsync()
        scope.launch {
            try {
                answer(context.applicationContext, question, body, summary)
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val ALLOW = "app.notesgraph.pro.agent.ALLOW"
        const val DENY = "app.notesgraph.pro.agent.DENY"
        const val OPTION = "app.notesgraph.pro.agent.OPTION"
        const val REPLY = "app.notesgraph.pro.agent.REPLY"
        const val KEY_REPLY = "agent-reply"
        const val EXTRA_OPTION = "agent-option"

        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

        /** Why an answer did not go, and whether the question still waits for one. */
        class Failure(val message: String, val stillWaiting: Boolean)

        /**
         * Send an answer and show how it went on the question's notification:
         * "Sent", or the question again with why it did not go. Shared with
         * [AgentQuestionActivity], which says "Sent" itself and so passes
         * [quiet] to just clear the notification. Returns the failure, if any.
         */
        suspend fun answer(
            context: Context,
            question: AgentQuestion,
            body: JSONObject,
            summary: String,
            quiet: Boolean = false,
        ): Failure? {
            fun done(message: String) {
                if (quiet) AgentNotifications.cancel(context, question.questionId)
                else AgentNotifications.sent(context, question, message)
            }
            return try {
                AgentApi.answer(question.server, question.workspaceId, question.jobId, question.questionId, body)
                done("$summary - it carries on from here.")
                null
            } catch (e: AgentApi.HttpError) {
                val message = e.message ?: "HTTP ${e.status}"
                // Answered elsewhere, or the run ended: nothing left to decide here.
                if (e.status == 400 || e.status == 404) {
                    done(e.message ?: "No longer waiting.")
                    Failure(message, stillWaiting = false)
                } else {
                    AgentNotifications.show(context, question, e.message)
                    Failure(message, stillWaiting = true)
                }
            } catch (e: Exception) {
                Timber.w(e, "[agent-push] answer failed")
                AgentNotifications.show(context, question, "no connection")
                Failure(e.message ?: "no connection", stillWaiting = true)
            }
        }
    }
}
