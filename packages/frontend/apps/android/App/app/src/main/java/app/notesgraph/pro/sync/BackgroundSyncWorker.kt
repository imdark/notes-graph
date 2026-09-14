package app.notesgraph.pro.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.notesgraph.pro.service.CookieStore
import app.notesgraph.pro.utils.TokenCipher
import app.notesgraph.pro.utils.dataStore
import app.notesgraph.pro.utils.get
import app.notesgraph.pro.utils.tokenKey
import org.json.JSONObject
import timber.log.Timber
import uniffi.notesgraph_mobile_native.PushSpace
import uniffi.notesgraph_mobile_native.newDocStoragePool
import java.io.File
import java.net.URI
import java.util.concurrent.TimeUnit

/**
 * Headless background push-sync. Runs without the WebView (WorkManager, network
 * constrained) and flushes pending local doc edits to the cloud via the native
 * Rust client (`DocStoragePool.pushPendingUpdates`). Push-only.
 *
 * It reads a "sync manifest" the app persists to DataStore while it's alive
 * (the server URL + the list of the user's spaces), and the fresh session token
 * the app keeps current — neither of which is otherwise reachable headless.
 *
 * NOTE (device QA): a run must not fight the WebView's own pool over the same
 * SQLite files. WorkManager periodic min interval is 15 min; scheduling is
 * network-constrained so it effectively "wakes on connectivity". The DB path
 * MUST match NbStorePlugin.connect exactly (see [dbPath]).
 */
class BackgroundSyncWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val raw = applicationContext.dataStore.get(MANIFEST_KEY)
        if (raw.isEmpty()) {
            // No manifest → background sync is off / not signed in. Nothing to do.
            return Result.success()
        }
        val manifest = try {
            JSONObject(raw)
        } catch (e: Exception) {
            Timber.w(e, "[background-sync] bad manifest json")
            return Result.success()
        }

        val serverBaseUrl = manifest.optString("serverBaseUrl")
        val clientVersion = manifest.optString("clientVersion")
        if (serverBaseUrl.isEmpty()) return Result.success()

        // The durable credential for a closed app is the persisted session
        // cookie (the JWT is only 15 min and often expired here). Proceed if we
        // have either.
        val token = readToken(serverBaseUrl) ?: ""
        val host = runCatching { URI(serverBaseUrl).host }.getOrNull()
        val sessionCookie =
            host?.let { CookieStore.readPersistedSessionCookie(it) } ?: ""
        if (token.isEmpty() && sessionCookie.isEmpty()) {
            Timber.w("[background-sync] no credentials; skipping this run")
            return Result.success()
        }

        val spacesJson = manifest.optJSONArray("spaces") ?: return Result.success()
        val pool = newDocStoragePool()
        try {
            val spaces = ArrayList<PushSpace>(spacesJson.length())
            for (i in 0 until spacesJson.length()) {
                val entry = spacesJson.getJSONObject(i)
                val universalId = entry.optString("universalId")
                val spaceType = entry.optString("spaceType")
                val spaceId = entry.optString("spaceId")
                // Two distinct peers: `dbPeer` locates the SQLite file (== the
                // storage flavour / serverId), `peerId` is the sync cursor key
                // (== `cloud:<serverId>`).
                val dbPeer = entry.optString("dbPeer")
                val peerId = entry.optString("peerId")
                if (
                    universalId.isEmpty() || spaceType.isEmpty() ||
                    spaceId.isEmpty() || dbPeer.isEmpty() || peerId.isEmpty()
                ) {
                    continue
                }
                val db = dbPath(applicationContext, spaceType, spaceId, dbPeer)
                if (!db.exists()) {
                    // Never synced locally yet — nothing to push.
                    continue
                }
                pool.connect(universalId, db.path)
                spaces.add(PushSpace(universalId, spaceType, spaceId, peerId))
            }

            if (spaces.isEmpty()) return Result.success()

            val summary = pool.pushPendingUpdates(
                serverBaseUrl,
                token,
                sessionCookie,
                clientVersion,
                spaces,
            )
            Timber.i(
                "[background-sync] pushed ${summary.pushedUpdates} update(s) " +
                    "across ${summary.pushedDocs} doc(s); ${summary.failedDocs} failed"
            )
            // Retry (with backoff) if some docs couldn't be pushed — e.g. a
            // flaky connection or an expired token that will be refreshed.
            return if (summary.failedDocs > 0u) Result.retry() else Result.success()
        } catch (e: Exception) {
            Timber.w(e, "[background-sync] push run failed")
            return Result.retry()
        } finally {
            try {
                pool.close()
            } catch (_: Exception) {
            }
        }
    }

    private suspend fun readToken(serverBaseUrl: String): String? {
        val stored = applicationContext.dataStore.get(tokenKey(serverBaseUrl))
        if (stored.isEmpty()) return null
        val cipher = TokenCipher()
        return cipher.decrypt(stored) ?: cipher.legacyPlaintext(stored)
    }

    companion object {
        const val MANIFEST_KEY = "sync-manifest"
        private const val WORK_NAME = "notesgraph-background-sync"

        /**
         * Location of a space's SQLite DB — MUST match NbStorePlugin.connect's
         * path + peer sanitization exactly, or the worker opens a different file.
         */
        fun dbPath(context: Context, spaceType: String, spaceId: String, peer: String): File {
            val sanitizedPeer = peer
                .replace(Regex("[/!@#$%^&*()+~`\"':;,?<>|]"), "_")
                .replace(Regex("_+"), "_")
                .replace(Regex("_+$"), "")
            return context.filesDir
                .resolve("workspaces")
                .resolve(spaceType)
                .resolve(sanitizedPeer)
                .resolve("$spaceId.db")
        }

        /** Enqueue the periodic, network-constrained background push. Idempotent. */
        fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = PeriodicWorkRequestBuilder<BackgroundSyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request,
            )
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
        }
    }
}
