package app.notesgraph.pro.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import app.notesgraph.pro.push.AgentApi
import app.notesgraph.pro.utils.dataStore
import app.notesgraph.pro.utils.del
import app.notesgraph.pro.utils.get
import app.notesgraph.pro.utils.set
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * What the home-screen note widgets know, kept in the app's DataStore: the
 * workspace the app last had open (the default for a new widget), what each
 * widget shows, and the last copy of it, so a widget has something to show
 * offline and right after the phone restarts.
 */
internal object NoteWidgets {
    private const val WORKSPACE_KEY = "note-widget-workspace"
    /** Most of a note's markdown kept per widget: far more than it can show. */
    private const val MAX_STORED_CHARS = 32_000

    private fun configKey(widgetId: Int) = "note-widget-$widgetId"
    private fun contentKey(widgetId: Int) = "note-widget-$widgetId-content"

    data class Workspace(val server: String, val workspaceId: String)

    /** Today's journal when [docId] is null, else that one note. */
    data class Config(
        val server: String,
        val workspaceId: String,
        val docId: String?,
        val title: String,
    ) {
        val journal get() = docId == null
    }

    data class Content(
        val title: String,
        val markdown: String,
        /** The note shown; null for a day with no journal yet. */
        val docId: String?,
        /** The day a journal widget's copy is for. */
        val date: String?,
        /** Why the last refresh failed; the copy shown is then the one before. */
        val error: String?,
    )

    fun widgetIds(context: Context): IntArray =
        AppWidgetManager.getInstance(context)
            .getAppWidgetIds(ComponentName(context, NoteWidgetProvider::class.java))

    fun today(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

    suspend fun workspace(context: Context): Workspace? {
        val json = parse(context.dataStore.get(WORKSPACE_KEY)) ?: return null
        val server = json.optString("server")
        val workspaceId = json.optString("workspaceId")
        if (server.isEmpty() || workspaceId.isEmpty()) return null
        return Workspace(server, workspaceId)
    }

    suspend fun setWorkspace(context: Context, workspace: Workspace?) {
        if (workspace == null) {
            context.dataStore.del(WORKSPACE_KEY)
            return
        }
        context.dataStore.set(
            WORKSPACE_KEY,
            JSONObject()
                .put("server", workspace.server)
                .put("workspaceId", workspace.workspaceId)
                .toString(),
        )
    }

    suspend fun config(context: Context, widgetId: Int): Config? {
        val json = parse(context.dataStore.get(configKey(widgetId))) ?: return null
        val server = json.optString("server")
        val workspaceId = json.optString("workspaceId")
        if (server.isEmpty() || workspaceId.isEmpty()) return null
        return Config(
            server = server,
            workspaceId = workspaceId,
            docId = json.optString("docId").takeIf { it.isNotEmpty() },
            title = json.optString("title"),
        )
    }

    suspend fun setConfig(context: Context, widgetId: Int, config: Config) {
        context.dataStore.set(
            configKey(widgetId),
            JSONObject()
                .put("server", config.server)
                .put("workspaceId", config.workspaceId)
                .put("docId", config.docId ?: "")
                .put("title", config.title)
                .toString(),
        )
        // What was shown before belongs to the old choice.
        context.dataStore.del(contentKey(widgetId))
    }

    suspend fun content(context: Context, widgetId: Int): Content? {
        val json = parse(context.dataStore.get(contentKey(widgetId))) ?: return null
        return Content(
            title = json.optString("title"),
            markdown = json.optString("markdown"),
            docId = json.optString("docId").takeIf { it.isNotEmpty() },
            date = json.optString("date").takeIf { it.isNotEmpty() },
            error = json.optString("error").takeIf { it.isNotEmpty() },
        )
    }

    suspend fun setContent(context: Context, widgetId: Int, content: Content) {
        context.dataStore.set(
            contentKey(widgetId),
            JSONObject()
                .put("title", content.title)
                // The widget shows the start of a note; the DataStore also
                // holds the sign-in, so a long note mustn't bloat every read.
                .put("markdown", content.markdown.take(MAX_STORED_CHARS))
                .put("docId", content.docId ?: "")
                .put("date", content.date ?: "")
                .put("error", content.error ?: "")
                .toString(),
        )
    }

    suspend fun forget(context: Context, widgetId: Int) {
        context.dataStore.del(configKey(widgetId))
        context.dataStore.del(contentKey(widgetId))
    }

    /** Drop a widget's copy of its note, keeping what it shows. */
    suspend fun forgetContent(context: Context, widgetId: Int) {
        context.dataStore.del(contentKey(widgetId))
    }

    /** Read what [config] shows from the server, as of now. */
    suspend fun fetch(config: Config): Content {
        val workspace = "/api/notes/workspaces/${AgentApi.enc(config.workspaceId)}"
        if (config.journal) {
            val date = today()
            val reply = AgentApi.get(config.server, "$workspace/journal?date=$date")
            return Content(
                title = reply.optString("title").ifEmpty { date },
                markdown = reply.optString("markdown"),
                docId = reply.optString("docId").takeIf { it.isNotEmpty() && it != "null" },
                date = date,
                error = null,
            )
        }
        val docId = config.docId!!
        val reply = AgentApi.get(config.server, "$workspace/docs/${AgentApi.enc(docId)}/markdown")
        return Content(
            title = reply.optString("title").ifEmpty { config.title },
            markdown = reply.optString("markdown"),
            docId = docId,
            date = null,
            error = null,
        )
    }

    /** `[{ docId, title }]` - the workspace's notes whose title contains [query]. */
    suspend fun search(workspace: Workspace, query: String): List<Pair<String, String>> {
        val path = "/api/notes/workspaces/${AgentApi.enc(workspace.workspaceId)}/docs" +
            "?q=${AgentApi.enc(query)}"
        val docs = AgentApi.get(workspace.server, path).optJSONArray("docs") ?: return emptyList()
        return (0 until docs.length()).map { i ->
            val doc = docs.getJSONObject(i)
            doc.optString("docId") to doc.optString("title")
        }
    }

    private fun parse(raw: String): JSONObject? =
        if (raw.isEmpty()) null else runCatching { JSONObject(raw) }.getOrNull()
}
