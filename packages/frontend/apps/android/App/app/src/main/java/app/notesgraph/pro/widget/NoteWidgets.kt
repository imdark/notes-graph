package app.notesgraph.pro.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import app.notesgraph.pro.push.AgentApi
import app.notesgraph.pro.utils.dataStore
import app.notesgraph.pro.utils.del
import app.notesgraph.pro.utils.get
import app.notesgraph.pro.utils.set
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject
import timber.log.Timber
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

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

    enum class TextSize(val sp: Float) { Small(12f), Medium(14f), Large(16f) }

    /** Space above and below each line. */
    enum class Spacing(val dp: Int) { Compact(0), Normal(1), Roomy(4) }

    /** System follows the phone's dark mode; the others hold one look. */
    enum class Theme { System, Light, Dark }

    data class Style(
        val textSize: TextSize = TextSize.Medium,
        val spacing: Spacing = Spacing.Normal,
        val theme: Theme = Theme.System,
    )

    /** Today's journal when [docId] is null, else that one note. */
    data class Config(
        val server: String,
        val workspaceId: String,
        val docId: String?,
        val title: String,
        val style: Style = Style(),
    ) {
        val journal get() = docId == null
    }

    /** A calendar event on a journal widget's day; times in epoch millis. */
    data class Event(val title: String, val start: Long, val end: Long, val allDay: Boolean)

    data class Content(
        val title: String,
        val markdown: String,
        /** The note shown; null for a day with no journal yet. */
        val docId: String?,
        /** The day a journal widget's copy is for. */
        val date: String?,
        /** Why the last refresh failed; the copy shown is then the one before. */
        val error: String?,
        /** The day's calendar events, for a journal widget. */
        val events: List<Event> = emptyList(),
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
            // Widgets added before the style settings get the defaults.
            style = Style(
                textSize = enumOr(json.optString("textSize"), TextSize.Medium),
                spacing = enumOr(json.optString("spacing"), Spacing.Normal),
                theme = enumOr(json.optString("theme"), Theme.System),
            ),
        )
    }

    suspend fun setConfig(context: Context, widgetId: Int, config: Config) {
        val old = config(context, widgetId)
        context.dataStore.set(
            configKey(widgetId),
            JSONObject()
                .put("server", config.server)
                .put("workspaceId", config.workspaceId)
                .put("docId", config.docId ?: "")
                .put("title", config.title)
                .put("textSize", config.style.textSize.name)
                .put("spacing", config.style.spacing.name)
                .put("theme", config.style.theme.name)
                .toString(),
        )
        // What was shown before belongs to the old choice; a new look alone
        // keeps it.
        if (old?.copy(style = config.style) != config) context.dataStore.del(contentKey(widgetId))
    }

    suspend fun content(context: Context, widgetId: Int): Content? {
        val json = parse(context.dataStore.get(contentKey(widgetId))) ?: return null
        return Content(
            title = json.optString("title"),
            markdown = json.optString("markdown"),
            docId = json.optString("docId").takeIf { it.isNotEmpty() },
            date = json.optString("date").takeIf { it.isNotEmpty() },
            error = json.optString("error").takeIf { it.isNotEmpty() },
            events = json.optJSONArray("events")?.let { events ->
                (0 until events.length()).map { i ->
                    val event = events.getJSONObject(i)
                    Event(
                        title = event.optString("title"),
                        start = event.optLong("start"),
                        end = event.optLong("end"),
                        allDay = event.optBoolean("allDay"),
                    )
                }
            }.orEmpty(),
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
                .put(
                    "events",
                    JSONArray(content.events.map { event ->
                        JSONObject()
                            .put("title", event.title)
                            .put("start", event.start)
                            .put("end", event.end)
                            .put("allDay", event.allDay)
                    }),
                )
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
            // The journal shows without its events rather than not at all.
            val events = try {
                events(config)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Timber.w(e, "[note-widget] could not read today's calendar events")
                emptyList()
            }
            return Content(
                title = reply.optString("title").ifEmpty { date },
                markdown = reply.optString("markdown"),
                docId = reply.optString("docId").takeIf { it.isNotEmpty() && it != "null" },
                date = date,
                error = null,
                events = events,
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

    private const val EVENTS_QUERY = """
        query noteWidgetEvents(${'$'}id: String!, ${'$'}from: DateTime!, ${'$'}to: DateTime!) {
          workspace(id: ${'$'}id) {
            calendars { events(from: ${'$'}from, to: ${'$'}to) { title startAtUtc endAtUtc allDay status } }
          }
        }
    """

    /**
     * Today's events from the workspace's calendars, the ones the journal
     * page shows above the notes, in start order. Today is the phone's day.
     */
    private suspend fun events(config: Config): List<Event> {
        val dayStart = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        val dayEnd = Calendar.getInstance().apply {
            timeInMillis = dayStart
            add(Calendar.DAY_OF_MONTH, 1)
        }.timeInMillis
        val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val reply = AgentApi.graphql(
            config.server,
            EVENTS_QUERY,
            JSONObject()
                .put("id", config.workspaceId)
                .put("from", iso.format(Date(dayStart)))
                .put("to", iso.format(Date(dayEnd - 1))),
        )
        val calendars = reply.optJSONObject("data")?.optJSONObject("workspace")
            ?.optJSONArray("calendars")
            ?: throw IllegalStateException(graphqlError(reply) ?: "no calendars in the reply")
        val events = ArrayList<Event>()
        for (c in 0 until calendars.length()) {
            val list = calendars.getJSONObject(c).optJSONArray("events") ?: continue
            for (e in 0 until list.length()) {
                val event = list.getJSONObject(e)
                if (event.optString("status").equals("cancelled", ignoreCase = true)) continue
                val start = parseIso(event.optString("startAtUtc")) ?: continue
                val end = parseIso(event.optString("endAtUtc")) ?: start
                // One that ended at midnight belongs to yesterday, as in the app.
                if (end <= dayStart && start < dayStart) continue
                events.add(
                    Event(
                        title = event.optString("title").takeIf { it != "null" }.orEmpty(),
                        start = start,
                        end = end,
                        allDay = event.optBoolean("allDay"),
                    )
                )
            }
        }
        return events.sortedWith(compareBy({ !it.allDay }, { it.start }))
    }

    private fun graphqlError(reply: JSONObject): String? =
        reply.optJSONArray("errors")?.optJSONObject(0)?.optString("message")?.takeIf { it.isNotEmpty() }

    private fun parseIso(value: String): Long? {
        if (value.isEmpty() || value == "null") return null
        // The server sends `2026-10-27T16:00:00.000Z`.
        return runCatching {
            SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX", Locale.US).parse(value)?.time
        }.getOrNull() ?: runCatching {
            SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssX", Locale.US).parse(value)?.time
        }.getOrNull()
    }

    private inline fun <reified T : Enum<T>> enumOr(name: String, default: T): T =
        enumValues<T>().firstOrNull { it.name == name } ?: default

    private fun parse(raw: String): JSONObject? =
        if (raw.isEmpty()) null else runCatching { JSONObject(raw) }.getOrNull()
}
