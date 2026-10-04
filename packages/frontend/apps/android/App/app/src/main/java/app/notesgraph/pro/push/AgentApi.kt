package app.notesgraph.pro.push

import android.net.Uri
import app.notesgraph.pro.NotesGraphApp
import app.notesgraph.pro.service.AuthHttp
import app.notesgraph.pro.service.CookieStore
import app.notesgraph.pro.utils.TokenCipher
import app.notesgraph.pro.utils.dataStore
import app.notesgraph.pro.utils.get
import app.notesgraph.pro.utils.set
import app.notesgraph.pro.utils.tokenKey
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.coroutines.executeAsync
import org.json.JSONObject

/**
 * The few server calls a phone makes about an agent run without the WebView:
 * register for pushes, read one question, answer it.
 *
 * Signed in the way the app is - the native JWT the app keeps in the
 * keystore - refreshed here when it has expired, since a notification is
 * usually answered long after the app was last open. With no JWT at all, the
 * persisted session cookie goes as a bearer, which the server still accepts.
 */
internal object AgentApi {
    class HttpError(val status: Int, message: String) : Exception(message)

    private val json = "application/json".toMediaType()

    suspend fun registerToken(server: String, token: String) {
        post(server, "/api/inventory/push-tokens", JSONObject().put("token", token).put("platform", "android"))
    }

    suspend fun unregisterToken(server: String, token: String) {
        post(server, "/api/inventory/push-tokens/remove", JSONObject().put("token", token))
    }

    /** `{ question, jobStatus }` - the full question, tool input and all. */
    suspend fun question(server: String, workspaceId: String, jobId: String, questionId: String) =
        get(server, "${jobPath(workspaceId, jobId)}/questions/${enc(questionId)}")

    suspend fun answer(
        server: String,
        workspaceId: String,
        jobId: String,
        questionId: String,
        body: JSONObject,
    ) = post(server, "${jobPath(workspaceId, jobId)}/questions/${enc(questionId)}/answer", body)

    private fun enc(value: String) = Uri.encode(value)

    private fun jobPath(workspaceId: String, jobId: String) =
        "/api/inventory/workspaces/${enc(workspaceId)}/jobs/${enc(jobId)}"

    private suspend fun get(server: String, path: String) =
        send(server) { Request.Builder().url(server.trimEnd('/') + path).get() }

    private suspend fun post(server: String, path: String, body: JSONObject) =
        send(server) {
            Request.Builder().url(server.trimEnd('/') + path).post(body.toString().toRequestBody(json))
        }

    private class Reply(val code: Int, val text: String)

    private suspend fun send(server: String, build: () -> Request.Builder): JSONObject =
        withContext(Dispatchers.IO) {
            val bearer = credential(server)
                ?: throw HttpError(401, "Not signed in to $server on this phone.")
            var reply = execute(build, bearer)
            // The JWT lives 15 minutes; a notification is answered whenever.
            if (reply.code == 401 && isJwt(bearer)) {
                val fresh = refresh(server, bearer)
                    ?: throw HttpError(401, "Signed out - open NotesGraph to sign in again.")
                reply = execute(build, fresh)
            }
            if (reply.code !in 200..299) {
                val message = runCatching { JSONObject(reply.text).optString("message") }
                    .getOrNull()?.takeIf { it.isNotEmpty() } ?: "HTTP ${reply.code}"
                throw HttpError(reply.code, message)
            }
            runCatching { JSONObject(reply.text) }.getOrElse { JSONObject() }
        }

    private suspend fun execute(build: () -> Request.Builder, bearer: String): Reply {
        val request = build()
            .addHeader("Authorization", "Bearer $bearer")
            .addHeader("x-notesgraph-client-kind", "native")
            .build()
        return AuthHttp.client.newCall(request).executeAsync().use { response ->
            Reply(response.code, response.body.string())
        }
    }

    private fun isJwt(token: String) = token.split('.').size == 3

    private suspend fun credential(server: String): String? {
        val store = NotesGraphApp.context().dataStore
        val stored = store.get(tokenKey(server))
        if (stored.isNotEmpty()) {
            val cipher = TokenCipher()
            (cipher.decrypt(stored) ?: cipher.legacyPlaintext(stored))?.let { return it }
        }
        val host = runCatching { server.toHttpUrl().host }.getOrNull() ?: return null
        return CookieStore.readPersistedSessionCookie(host)
    }

    /** Swap an expired JWT for a fresh one, and keep it for the app too. */
    private suspend fun refresh(server: String, expired: String): String? {
        val request = Request.Builder()
            .url(server.trimEnd('/') + "/api/auth/native/refresh")
            .addHeader("Authorization", "Bearer $expired")
            .addHeader("x-notesgraph-client-kind", "native")
            .post("{}".toRequestBody(json))
            .build()
        return AuthHttp.client.newCall(request).executeAsync().use { response ->
            if (!response.isSuccessful) return@use null
            val token = JSONObject(response.body.string()).optString("token").takeIf { it.isNotEmpty() }
                ?: return@use null
            NotesGraphApp.context().dataStore.set(tokenKey(server), TokenCipher().encrypt(token))
            token
        }
    }
}
