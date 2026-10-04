package app.notesgraph.pro.plugin

import android.Manifest
import android.os.Build
import app.notesgraph.pro.push.AgentApi
import app.notesgraph.pro.push.AgentNotifications
import app.notesgraph.pro.push.AgentPushService
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import timber.log.Timber
import kotlin.coroutines.resume

/**
 * Turns on "an agent run is waiting on you" pushes for the servers the app
 * is signed in to. Everything after this lives natively (AgentPushService,
 * AgentAnswerReceiver), so a push is shown and answered with the app closed.
 */
@CapacitorPlugin(
    name = "AgentPush",
    permissions = [
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = AgentPushPlugin.NOTIFICATIONS),
    ],
)
class AgentPushPlugin : Plugin() {

    /** `{ servers: string[] }` - every server the app has an account on. */
    @PluginMethod
    fun register(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            getPermissionState(NOTIFICATIONS) != PermissionState.GRANTED
        ) {
            requestPermissionForAlias(NOTIFICATIONS, call, "onNotificationPermission")
            return
        }
        registerNow(call)
    }

    @PermissionCallback
    private fun onNotificationPermission(call: PluginCall) {
        // Register either way: if notifications are allowed later in system
        // settings, pushes are already flowing.
        registerNow(call)
    }

    private fun registerNow(call: PluginCall) {
        val servers = call.getArray("servers")?.toList<String>().orEmpty()
        launch(Dispatchers.IO) {
            AgentNotifications.ensureChannel(context)
            val token = fcmToken()
            if (token == null) {
                // No Firebase project in this build (the placeholder config):
                // questions still wait in the app.
                call.resolve(JSObject().put("token", null).put("registered", JSArray()))
                return@launch
            }
            val registered = JSArray()
            for (server in servers) {
                runCatching { AgentApi.registerToken(server, token) }
                    .onSuccess { registered.put(server) }
                    .onFailure { Timber.w(it, "[agent-push] register with $server failed") }
            }
            AgentPushService.setServers(context, servers)
            call.resolve(
                JSObject()
                    .put("token", token)
                    .put("registered", registered)
                    .put("permission", getPermissionState(NOTIFICATIONS)?.toString())
            )
        }
    }

    /** `{ server }` - on sign-out, stop this phone hearing about that account. */
    @PluginMethod
    fun unregister(call: PluginCall) {
        val server = call.getString("server") ?: return call.reject("Missing server parameter")
        launch(Dispatchers.IO) {
            fcmToken()?.let { token ->
                runCatching { AgentApi.unregisterToken(server, token) }
            }
            AgentPushService.setServers(
                context,
                AgentPushService.servers(context).filter { it != server },
            )
            call.resolve(JSObject().put("ok", true))
        }
    }

    private suspend fun fcmToken(): String? = suspendCancellableCoroutine { cont ->
        try {
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                if (!task.isSuccessful) Timber.w(task.exception, "[agent-push] no FCM token")
                cont.resume(if (task.isSuccessful) task.result else null)
            }
        } catch (e: Exception) {
            Timber.w(e, "[agent-push] Firebase is not set up in this build")
            cont.resume(null)
        }
    }

    companion object {
        const val NOTIFICATIONS = "notifications"
    }
}
