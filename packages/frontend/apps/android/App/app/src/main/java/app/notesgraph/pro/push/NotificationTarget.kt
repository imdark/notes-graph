package app.notesgraph.pro.push

import android.content.Context
import android.content.Intent
import app.notesgraph.pro.MainActivity
import org.json.JSONObject

/**
 * Where tapping a notification goes: the app, opened on the note (and block)
 * the notification is about. MainActivity reads these extras and hands them
 * to the web layer's `window.notesgraphOpenFromNotification`.
 */
object NotificationTarget {
    private const val EXTRA_OPEN = "ng_open_target"
    private const val EXTRA_HANDLED = "ng_open_handled"
    private const val CAPTURE_TARGET = "{\"capture\":true}"

    private fun isCaptureLaunch(intent: Intent) =
        intent.component?.className?.endsWith(".CaptureLauncher") == true

    /**
     * The app, on `docId` (at `blockId`) in `workspaceId`; the Agents page
     * without a doc; the journal page for `journal` (YYYY-MM-DD) when given.
     */
    fun intent(
        context: Context,
        workspaceId: String?,
        docId: String?,
        blockId: String? = null,
        journal: String? = null,
    ): Intent {
        val target = JSONObject()
        if (!workspaceId.isNullOrEmpty()) target.put("workspaceId", workspaceId)
        if (!docId.isNullOrEmpty()) target.put("docId", docId)
        if (!blockId.isNullOrEmpty()) target.put("blockId", blockId)
        if (!journal.isNullOrEmpty()) target.put("journal", journal)
        return Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_OPEN, target.toString())
    }

    /**
     * The target an intent carries, once: it is marked taken so a config
     * change or a resume with the same intent doesn't open it again. The
     * "NotesGraph Capture" launcher icon (an alias of MainActivity) carries
     * capture mode.
     */
    fun take(intent: Intent?): String? {
        if (intent == null || intent.getBooleanExtra(EXTRA_HANDLED, false)) return null
        val target = intent.getStringExtra(EXTRA_OPEN)
            ?: CAPTURE_TARGET.takeIf { isCaptureLaunch(intent) }
            ?: return null
        intent.putExtra(EXTRA_HANDLED, true)
        return target
    }
}
