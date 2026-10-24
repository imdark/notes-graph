package app.notesgraph.pro.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.os.Build
import android.text.SpannableString
import android.text.Spanned
import android.text.style.RelativeSizeSpan
import android.text.style.StyleSpan
import android.view.View
import android.widget.RemoteViews
import androidx.core.widget.RemoteViewsCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.notesgraph.pro.AppLock
import app.notesgraph.pro.R
import app.notesgraph.pro.push.AgentApi
import app.notesgraph.pro.push.NotificationTarget
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import timber.log.Timber
import java.util.concurrent.TimeUnit

/**
 * A home-screen widget showing one note, or today's journal, as text.
 * Tapping it opens the note in the app; the refresh button reads it again.
 * The note is read from the server ([NoteWidgetWorker]), so it shows what
 * the app has synced, every half hour and shortly after leaving the app.
 */
class NoteWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, widgetIds: IntArray) {
        NoteWidgetWorker.schedule(context)
        NoteWidgetWorker.refresh(context)
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_REFRESH) {
            NoteWidgetWorker.refresh(context)
            return
        }
        super.onReceive(context, intent)
    }

    override fun onDeleted(context: Context, widgetIds: IntArray) {
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                widgetIds.forEach { NoteWidgets.forget(context, it) }
            } finally {
                pending.finish()
            }
        }
    }

    override fun onDisabled(context: Context) {
        NoteWidgetWorker.cancel(context)
    }

    companion object {
        const val ACTION_REFRESH = "app.notesgraph.pro.widget.REFRESH"
    }
}

/** Reads every widget's note from the server and redraws it. */
class NoteWidgetWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        NoteWidgets.widgetIds(applicationContext).forEach { refreshOne(applicationContext, it) }
        return Result.success()
    }

    companion object {
        private const val REFRESH_WORK = "note-widget-refresh"
        private const val PERIODIC_WORK = "note-widget-periodic"

        suspend fun refreshOne(context: Context, widgetId: Int) {
            val config = NoteWidgets.config(context, widgetId)
            // A locked app keeps its notes off the home screen too, and off
            // the phone's storage outside it.
            if (config == null || AppLock.isEnabled(context)) {
                if (config != null) NoteWidgets.forgetContent(context, widgetId)
                NoteWidgetViews.render(context, widgetId, config, null)
                return
            }
            val cached = NoteWidgets.content(context, widgetId)
            if (cached == null) NoteWidgetViews.render(context, widgetId, config, null)
            val content = try {
                NoteWidgets.fetch(config)
            } catch (e: Exception) {
                Timber.w(e, "[note-widget] could not read the note for widget $widgetId")
                val reason = (e as? AgentApi.HttpError)?.message
                    ?: context.getString(R.string.note_widget_offline)
                cached?.copy(error = reason) ?: NoteWidgets.Content(
                    title = config.title,
                    markdown = "",
                    docId = config.docId,
                    date = null,
                    error = reason,
                )
            }
            NoteWidgets.setContent(context, widgetId, content)
            NoteWidgetViews.render(context, widgetId, config, content)
        }

        /** Redraw every widget from the server, after [delaySeconds]. */
        fun refresh(context: Context, delaySeconds: Long = 0) {
            val request = OneTimeWorkRequestBuilder<NoteWidgetWorker>()
                .setInitialDelay(delaySeconds, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(REFRESH_WORK, ExistingWorkPolicy.REPLACE, request)
        }

        /** Every half hour, which also turns a journal widget over to the new day. */
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<NoteWidgetWorker>(30, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
                )
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(PERIODIC_WORK, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK)
        }
    }
}

internal object NoteWidgetViews {

    fun render(
        context: Context,
        widgetId: Int,
        config: NoteWidgets.Config?,
        content: NoteWidgets.Content?,
    ) {
        val views = RemoteViews(context.packageName, R.layout.note_widget)
        views.setOnClickPendingIntent(R.id.note_widget_refresh, refreshIntent(context, widgetId))
        views.setViewVisibility(R.id.note_widget_status, View.GONE)

        if (config == null) {
            views.setTextViewText(R.id.note_widget_title, context.getString(R.string.app_name))
            views.setViewVisibility(R.id.note_widget_refresh, View.GONE)
            showMessage(views, context.getString(R.string.note_widget_choose))
            val choose = PendingIntent.getActivity(
                context,
                widgetId * 4,
                Intent(context, NoteWidgetConfigActivity::class.java)
                    .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.note_widget_root, choose)
            views.setOnClickPendingIntent(R.id.note_widget_empty, choose)
            update(context, widgetId, views)
            return
        }

        val today = NoteWidgets.today()
        val open = openIntent(context, widgetId, config, today, mutable = false)
        views.setOnClickPendingIntent(R.id.note_widget_root, open)
        views.setOnClickPendingIntent(R.id.note_widget_empty, open)

        if (AppLock.isEnabled(context)) {
            views.setTextViewText(R.id.note_widget_title, context.getString(R.string.app_name))
            views.setViewVisibility(R.id.note_widget_refresh, View.GONE)
            showMessage(views, context.getString(R.string.note_widget_locked))
            update(context, widgetId, views)
            return
        }

        views.setViewVisibility(R.id.note_widget_refresh, View.VISIBLE)
        val title = when {
            content != null && content.title.isNotBlank() -> content.title
            config.journal -> today
            else -> config.title.ifBlank { context.getString(R.string.note_widget_untitled) }
        }
        views.setTextViewText(R.id.note_widget_title, title)

        val lines = content?.let { markdownLines(it.markdown) }.orEmpty()
        if (content?.error != null && lines.isNotEmpty()) {
            views.setTextViewText(
                R.id.note_widget_status,
                context.getString(R.string.note_widget_stale, content.error),
            )
            views.setViewVisibility(R.id.note_widget_status, View.VISIBLE)
        }
        val message = when {
            content == null -> context.getString(R.string.note_widget_loading)
            lines.isNotEmpty() -> null
            content.error != null -> context.getString(R.string.note_widget_failed)
            config.journal && content.docId == null -> context.getString(R.string.note_widget_journal_empty)
            else -> context.getString(R.string.note_widget_note_empty)
        }
        if (message != null) {
            showMessage(views, message)
        } else {
            views.setViewVisibility(R.id.note_widget_empty, View.GONE)
            views.setViewVisibility(R.id.note_widget_lines, View.VISIBLE)
            views.setPendingIntentTemplate(
                R.id.note_widget_lines,
                openIntent(context, widgetId, config, today, mutable = true),
            )
            val items = RemoteViewsCompat.RemoteCollectionItems.Builder().setViewTypeCount(1)
            lines.forEachIndexed { index, line ->
                val item = RemoteViews(context.packageName, R.layout.note_widget_line)
                item.setTextViewText(R.id.note_widget_line, line)
                item.setOnClickFillInIntent(R.id.note_widget_line, Intent())
                items.addItem(index.toLong(), item)
            }
            RemoteViewsCompat.setRemoteAdapter(
                context, views, widgetId, R.id.note_widget_lines, items.build()
            )
        }
        update(context, widgetId, views)
    }

    private fun showMessage(views: RemoteViews, message: String) {
        views.setViewVisibility(R.id.note_widget_lines, View.GONE)
        views.setViewVisibility(R.id.note_widget_empty, View.VISIBLE)
        views.setTextViewText(R.id.note_widget_empty, message)
    }

    private fun update(context: Context, widgetId: Int, views: RemoteViews) {
        AppWidgetManager.getInstance(context).updateAppWidget(widgetId, views)
    }

    private fun refreshIntent(context: Context, widgetId: Int) = PendingIntent.getBroadcast(
        context,
        widgetId * 4 + 1,
        Intent(context, NoteWidgetProvider::class.java).setAction(NoteWidgetProvider.ACTION_REFRESH),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    /** The app, on the note; on today's journal page for a journal widget. */
    private fun openIntent(
        context: Context,
        widgetId: Int,
        config: NoteWidgets.Config,
        today: String,
        mutable: Boolean,
    ): PendingIntent {
        val intent = NotificationTarget.intent(
            context,
            config.workspaceId,
            config.docId,
            journal = if (config.journal) today else null,
        )
        // A list's click template is filled in per row, so it must be mutable.
        val mutability = if (mutable && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_MUTABLE
        } else if (mutable) {
            0
        } else {
            PendingIntent.FLAG_IMMUTABLE
        }
        return PendingIntent.getActivity(
            context,
            widgetId * 4 + if (mutable) 3 else 2,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or mutability,
        )
    }
}

private val heading = Regex("^(#{1,6})\\s+(.*)$")
private val task = Regex("^(\\s*)[-*+]\\s+\\[([ xX])]\\s*(.*)$")
private val bullet = Regex("^(\\s*)[-*+]\\s+(.*)$")
private val quote = Regex("^>\\s?(.*)$")
private val image = Regex("!\\[[^]]*]\\([^)]*\\)")
private val link = Regex("\\[([^]]*)]\\([^)]*\\)")
private val emphasis = Regex("(\\*\\*|__|~~|`)(.+?)\\1")

private const val MAX_LINES = 200
/**
 * Longest line kept. A widget update travels to the launcher in one parcel
 * (about 1 MB at most); 200 lines this long stay well inside it.
 */
private const val MAX_LINE_CHARS = 500

/**
 * A note's markdown as the lines a widget shows: headings in bold, tasks as
 * check boxes, bullets as bullets, and links, images and inline markup
 * reduced to their text.
 */
internal fun markdownLines(markdown: String): List<CharSequence> {
    val lines = ArrayList<CharSequence>()
    var inCode = false
    var lastBlank = true
    for (raw in markdown.lines()) {
        if (lines.size >= MAX_LINES) break
        val line = raw.trimEnd().let {
            if (it.length > MAX_LINE_CHARS) it.take(MAX_LINE_CHARS - 1) + "…" else it
        }
        if (line.trimStart().startsWith("```")) {
            inCode = !inCode
            continue
        }
        if (inCode) {
            lines.add(line)
            lastBlank = false
            continue
        }
        if (line.isBlank()) {
            if (!lastBlank) lines.add("")
            lastBlank = true
            continue
        }
        lastBlank = false
        lines.add(styled(line))
    }
    while (lines.isNotEmpty() && lines.last().isEmpty()) lines.removeAt(lines.size - 1)
    return lines
}

private fun styled(line: String): CharSequence {
    heading.matchEntire(line)?.let { match ->
        val text = inline(match.groupValues[2])
        val span = SpannableString(text)
        span.setSpan(StyleSpan(Typeface.BOLD), 0, text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        if (match.groupValues[1].length <= 2) {
            span.setSpan(RelativeSizeSpan(1.1f), 0, text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        return span
    }
    task.matchEntire(line)?.let { match ->
        val box = if (match.groupValues[2] == " ") "☐" else "☑"
        return indent(match.groupValues[1]) + "$box " + inline(match.groupValues[3])
    }
    bullet.matchEntire(line)?.let { match ->
        return indent(match.groupValues[1]) + "• " + inline(match.groupValues[2])
    }
    quote.matchEntire(line)?.let { match ->
        return "│ " + inline(match.groupValues[1])
    }
    return inline(line)
}

private fun indent(spaces: String) = " ".repeat(spaces.replace("\t", "  ").length / 2)

private fun inline(text: String) = text
    .replace(image, "")
    .replace(link, "$1")
    .replace(emphasis, "$2")
    .trim()
