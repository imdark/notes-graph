package app.notesgraph.pro.push

import android.content.Context
import app.notesgraph.pro.utils.canonicalEndpoint
import app.notesgraph.pro.utils.dataStore
import app.notesgraph.pro.utils.get
import app.notesgraph.pro.utils.set
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import timber.log.Timber

/**
 * Receives "an agent run is waiting on you" from the server, whether or not
 * the app is open. Messages are data-only, so this runs for every one and
 * builds the notification itself (with its answer buttons) rather than
 * leaving a plain one to the system.
 */
class AgentPushService : FirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        when (data["type"]) {
            "agent-question" -> AgentQuestion.fromPush(data)?.let { question ->
                // A server this phone has signed out of may not have heard
                // yet; its runs are someone else's business now.
                val known = runBlocking { servers(this@AgentPushService) }
                if (known.any { canonicalEndpoint(it) == canonicalEndpoint(question.server) }) {
                    AgentNotifications.show(this, question)
                }
            }
            "agent-question-closed" -> data["questionIds"].orEmpty()
                .split(',')
                .filter { it.isNotEmpty() }
                .forEach { AgentNotifications.cancel(this, it) }
            "monitor-alert" -> {
                // Same rule as questions: only from servers this phone is signed in to.
                val server = data["server"].orEmpty()
                val known = runBlocking { servers(this@AgentPushService) }
                if (known.any { canonicalEndpoint(it) == canonicalEndpoint(server) }) {
                    MonitorNotifications.show(this, data)
                }
            }
        }
    }

    /**
     * FCM rotated this install's token. Tell every server the app registered
     * with, now - the app may not be opened again for days.
     */
    override fun onNewToken(token: String) {
        runBlocking {
            for (server in servers(this@AgentPushService)) {
                runCatching { AgentApi.registerToken(server, token) }
                    .onFailure { Timber.w(it, "[agent-push] re-register with $server failed") }
            }
        }
    }

    companion object {
        private const val SERVERS_KEY = "agent-push-servers"

        /** The servers this phone gets agent pushes from. */
        suspend fun servers(context: Context): List<String> {
            val raw = context.dataStore.get(SERVERS_KEY)
            if (raw.isEmpty()) return emptyList()
            return runCatching {
                val array = JSONArray(raw)
                List(array.length()) { array.getString(it) }
            }.getOrDefault(emptyList())
        }

        suspend fun setServers(context: Context, servers: List<String>) {
            context.dataStore.set(SERVERS_KEY, JSONArray(servers).toString())
        }
    }
}
