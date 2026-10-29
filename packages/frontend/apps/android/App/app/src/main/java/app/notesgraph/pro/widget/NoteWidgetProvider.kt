package app.notesgraph.pro.widget

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.graphics.Typeface
import android.os.Build
import android.text.SpannableString
import android.text.Spanned
import android.text.format.DateFormat
import android.text.style.RelativeSizeSpan
import android.text.style.StyleSpan
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.widget.RemoteViewsCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.notesgraph.pro.AppLock
import app.notesgraph.pro.R
import app.notesgraph.pro.push.AgentApi
import app.notesgraph.pro.push.NotificationTarget
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import timber.log.Timber
import java.io.IOException
import java.util.Date
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

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
            NoteWidgetViews.showRefreshing(context)
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
        var offline = false
        NoteWidgets.widgetIds(applicationContext).forEach {
            if (!refreshOne(applicationContext, it)) offline = true
        }
        // A dropped connection is tried again soon, rather than leaving the
        // old copy up until the next half-hour pass.
        return if (offline && runAttemptCount < MAX_RETRIES) Result.retry() else Result.success()
    }

    /**
     * Before Android 12 an expedited refresh runs as a brief foreground
     * service, which must show something; from 12 on this isn't shown.
     */
    override suspend fun getForegroundInfo(): ForegroundInfo {
        val manager = applicationContext.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            manager.getNotificationChannel(REFRESH_CHANNEL) == null
        ) {
            manager.createNotificationChannel(
                NotificationChannel(
                    REFRESH_CHANNEL,
                    applicationContext.getString(R.string.note_widget_refresh_channel),
                    NotificationManager.IMPORTANCE_MIN,
                )
            )
        }
        val notification = NotificationCompat.Builder(applicationContext, REFRESH_CHANNEL)
            .setSmallIcon(R.drawable.ic_ai)
            .setContentTitle(applicationContext.getString(R.string.note_widget_refreshing))
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setSilent(true)
            .build()
        return ForegroundInfo(REFRESH_NOTIFICATION_ID, notification)
    }

    companion object {
        private const val REFRESH_WORK = "note-widget-refresh"
        private const val PERIODIC_WORK = "note-widget-periodic"
        private const val MAX_RETRIES = 4
        private const val REFRESH_CHANNEL = "note-widget-refresh"
        private const val REFRESH_NOTIFICATION_ID = 0x5717

        private val NETWORK =
            Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        /** What a failed connection says on the widget: which way it failed. */
        fun networkFailure(e: IOException): Int = when (e) {
            is java.net.UnknownHostException -> R.string.note_widget_offline
            is java.net.SocketTimeoutException -> R.string.note_widget_timed_out
            is java.net.ConnectException -> R.string.note_widget_unreachable
            is javax.net.ssl.SSLException -> R.string.note_widget_tls_failed
            else -> R.string.note_widget_connection_failed
        }

        /** Read and redraw one widget; false when the connection failed. */
        suspend fun refreshOne(context: Context, widgetId: Int): Boolean {
            val config = NoteWidgets.config(context, widgetId)
            // A locked app keeps its notes off the home screen too, and off
            // the phone's storage outside it.
            if (config == null || AppLock.isEnabled(context)) {
                if (config != null) NoteWidgets.forgetContent(context, widgetId)
                NoteWidgetViews.render(context, widgetId, config, null)
                return true
            }
            val cached = NoteWidgets.content(context, widgetId)
            if (cached == null) {
                NoteWidgetViews.render(context, widgetId, config, null, refreshing = true)
            }
            var offline = false
            val content = try {
                NoteWidgets.fetch(config)
            } catch (e: CancellationException) {
                // A newer refresh replaced this one (the refresh button, or
                // leaving the app); it is not a failure to show.
                throw e
            } catch (e: Exception) {
                Timber.w(e, "[note-widget] could not read the note for widget $widgetId")
                offline = e is IOException
                val reason = when (e) {
                    is AgentApi.HttpError -> e.message
                    is IOException -> context.getString(networkFailure(e))
                    else -> e.message
                } ?: e.javaClass.simpleName
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
            return !offline
        }

        /**
         * Redraw every widget from the server, after [delaySeconds].
         *
         * The refresh button's run is expedited and asks for a network: plain
         * background work ran with the app's network cut off (seen on an S24
         * with Battery Saver on: blocked=BATTERY_SAVER|APP_BACKGROUND), so the
         * DNS lookup failed and the widget said "no connection" with the
         * phone online. An expedited job is let through Battery Saver; past
         * its quota it runs as ordinary work.
         */
        fun refresh(context: Context, delaySeconds: Long = 0) {
            val request = OneTimeWorkRequestBuilder<NoteWidgetWorker>()
                .apply {
                    // An initial delay and expedited don't go together.
                    if (delaySeconds > 0) {
                        setInitialDelay(delaySeconds, TimeUnit.SECONDS)
                    } else {
                        setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                    }
                }
                .setConstraints(NETWORK)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(REFRESH_WORK, ExistingWorkPolicy.REPLACE, request)
        }

        /** Every half hour, which also turns a journal widget over to the new day. */
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<NoteWidgetWorker>(30, TimeUnit.MINUTES)
                .setConstraints(NETWORK)
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

    /**
     * Spin in the refresh button's place on every widget, at once, so a press
     * shows before the refresh is picked up. The next [render] puts the
     * button back. Offline the refresh waits for a network, so it would spin
     * until then: the button stays as it is.
     */
    fun showRefreshing(context: Context) {
        if (!phoneOnline(context)) return
        val ids = NoteWidgets.widgetIds(context)
        if (ids.isEmpty()) return
        val views = RemoteViews(context.packageName, R.layout.note_widget)
        setRefreshing(views, true)
        AppWidgetManager.getInstance(context).partiallyUpdateAppWidget(ids, views)
    }

    /**
     * Whether the phone has a working internet connection, on any network.
     * Not the app's active network: with Battery Saver on and the app in the
     * background that reads as none, the app's own access being what is
     * blocked, though the (expedited) refresh still runs.
     */
    @Suppress("DEPRECATION")
    private fun phoneOnline(context: Context): Boolean {
        val connectivity = context.getSystemService(ConnectivityManager::class.java)
            ?: return false
        return connectivity.allNetworks.any { network ->
            connectivity.getNetworkCapabilities(network)?.run {
                hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                    hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            } == true
        }
    }

    private fun setRefreshing(views: RemoteViews, refreshing: Boolean) {
        views.setViewVisibility(R.id.note_widget_refresh, if (refreshing) View.GONE else View.VISIBLE)
        views.setViewVisibility(R.id.note_widget_refreshing, if (refreshing) View.VISIBLE else View.GONE)
    }

    fun render(
        context: Context,
        widgetId: Int,
        config: NoteWidgets.Config?,
        content: NoteWidgets.Content?,
        refreshing: Boolean = false,
    ) {
        val views = RemoteViews(context.packageName, R.layout.note_widget)
        views.setOnClickPendingIntent(R.id.note_widget_refresh, refreshIntent(context, widgetId))
        views.setViewVisibility(R.id.note_widget_status, View.GONE)
        setRefreshing(views, refreshing)

        if (config == null) {
            views.setTextViewText(R.id.note_widget_title, context.getString(R.string.app_name))
            views.setViewVisibility(R.id.note_widget_refresh, View.GONE)
            views.setViewVisibility(R.id.note_widget_refreshing, View.GONE)
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
            views.setViewVisibility(R.id.note_widget_refreshing, View.GONE)
            showMessage(views, context.getString(R.string.note_widget_locked))
            colors(context, config.style.theme)?.let { applyColors(views, it) }
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

        val style = config.style
        val colors = colors(context, style.theme)
        views.setTextViewTextSize(R.id.note_widget_title, TypedValue.COMPLEX_UNIT_SP, style.textSize.sp + 1)
        views.setTextViewTextSize(R.id.note_widget_empty, TypedValue.COMPLEX_UNIT_SP, style.textSize.sp)

        // Yesterday's events are not today's, if the copy is from yesterday.
        val events = content?.takeIf { it.date == today }?.events.orEmpty()
        val noteLines = content?.let { markdownLines(it.markdown) }.orEmpty()
        val lines = if (events.isEmpty()) noteLines else buildList {
            addAll(eventLines(context, events))
            when {
                // The notes start a new part of the widget below the events.
                noteLines.isNotEmpty() -> {
                    add(noteLines.first().copy(gap = true))
                    addAll(noteLines.drop(1))
                }
                content?.docId == null ->
                    add(WidgetLine(context.getString(R.string.note_widget_journal_empty), gap = true))
            }
        }
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
            val pad = dp(context, style.spacing.dp)
            // A heading or a new part of the page gets a little room above it.
            val gap = dp(context, 4 + style.spacing.dp)
            val items = RemoteViewsCompat.RemoteCollectionItems.Builder().setViewTypeCount(1)
            lines.forEachIndexed { index, line ->
                val item = RemoteViews(context.packageName, R.layout.note_widget_line)
                item.setTextViewText(R.id.note_widget_line, line.text)
                item.setTextViewTextSize(R.id.note_widget_line, TypedValue.COMPLEX_UNIT_SP, style.textSize.sp)
                item.setViewPadding(
                    R.id.note_widget_line, 0, if (line.gap && index > 0) gap else pad, 0, pad,
                )
                colors?.let { item.setTextColor(R.id.note_widget_line, it.text) }
                item.setOnClickFillInIntent(R.id.note_widget_line, Intent())
                items.addItem(index.toLong(), item)
            }
            RemoteViewsCompat.setRemoteAdapter(
                context, views, widgetId, R.id.note_widget_lines, items.build()
            )
        }
        colors?.let { applyColors(views, it) }
        update(context, widgetId, views)
    }

    private class Colors(val background: Int, val text: Int, val secondary: Int)

    /** A fixed light or dark look; null to follow the phone's dark mode. */
    private fun colors(context: Context, theme: NoteWidgets.Theme) = when (theme) {
        NoteWidgets.Theme.System -> null
        NoteWidgets.Theme.Light -> Colors(
            R.drawable.note_widget_background_light,
            context.getColor(R.color.note_widget_text_light),
            context.getColor(R.color.note_widget_secondary_light),
        )
        NoteWidgets.Theme.Dark -> Colors(
            R.drawable.note_widget_background_dark,
            context.getColor(R.color.note_widget_text_dark),
            context.getColor(R.color.note_widget_secondary_dark),
        )
    }

    private fun applyColors(views: RemoteViews, colors: Colors) {
        views.setInt(R.id.note_widget_root, "setBackgroundResource", colors.background)
        views.setTextColor(R.id.note_widget_title, colors.text)
        views.setTextColor(R.id.note_widget_status, colors.secondary)
        views.setTextColor(R.id.note_widget_empty, colors.secondary)
        views.setInt(R.id.note_widget_refresh, "setColorFilter", colors.secondary)
    }

    private fun dp(context: Context, value: Int) =
        (value * context.resources.displayMetrics.density).roundToInt()

    /** Today's events, above the journal: "09:00–10:00  Stand-up". */
    private fun eventLines(context: Context, events: List<NoteWidgets.Event>): List<WidgetLine> {
        val time = DateFormat.getTimeFormat(context)
        val untitled = context.getString(R.string.note_widget_untitled)
        return events.map { event ->
            val at = if (event.allDay) {
                context.getString(R.string.note_widget_all_day)
            } else {
                "${time.format(Date(event.start))}–${time.format(Date(event.end))}"
            }
            val text = SpannableString("$at  ${event.title.ifBlank { untitled }}")
            text.setSpan(StyleSpan(Typeface.BOLD), 0, at.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            WidgetLine(text)
        }
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

/** One row of the widget; [gap] puts a little room above it. */
internal data class WidgetLine(val text: CharSequence, val gap: Boolean = false)

/** A heading's level, 0 for any other line. */
private class Parsed(val level: Int, val text: CharSequence)

/**
 * A note's markdown as the lines a widget shows: headings in bold, tasks as
 * check boxes, bullets as bullets, table rows as their cells, and links,
 * images and inline markup reduced to their text.
 *
 * A widget is small, so what takes room without saying anything is left
 * out: blank lines between blocks, tasks and bullets with no text, tables
 * with no rows (a journal's empty "todos" tables), and headings with
 * nothing under them (a journal's untouched project sections).
 */
internal fun markdownLines(markdown: String): List<WidgetLine> {
    val parsed = ArrayList<Parsed>()
    val table = ArrayList<String>()
    fun flushTable() {
        tableLines(table).forEach { parsed.add(Parsed(0, it)) }
        table.clear()
    }
    var inCode = false
    for (raw in markdown.lines()) {
        val line = raw.trimEnd().let {
            if (it.length > MAX_LINE_CHARS) it.take(MAX_LINE_CHARS - 1) + "…" else it
        }
        if (line.trimStart().startsWith("```")) {
            flushTable()
            inCode = !inCode
            continue
        }
        if (inCode) {
            parsed.add(Parsed(0, line))
            continue
        }
        if (line.trimStart().startsWith("|")) {
            table.add(line.trim())
            continue
        }
        flushTable()
        if (line.isBlank()) continue
        val match = heading.matchEntire(line)
        if (match != null) {
            headingText(match)?.let { parsed.add(Parsed(match.groupValues[1].length, it)) }
        } else {
            styled(line)?.let { parsed.add(Parsed(0, it)) }
        }
    }
    flushTable()

    // Keep a heading only if something is under it before the next heading
    // of its level or above; walked from the end, so a kept subheading
    // counts as something.
    val keep = BooleanArray(parsed.size)
    for (i in parsed.indices.reversed()) {
        val level = parsed[i].level
        if (level == 0) {
            keep[i] = true
            continue
        }
        var j = i + 1
        while (j < parsed.size && (parsed[j].level == 0 || parsed[j].level > level)) {
            if (keep[j]) {
                keep[i] = true
                break
            }
            j++
        }
    }
    return parsed.indices
        .filter { keep[it] }
        .take(MAX_LINES)
        .map { WidgetLine(parsed[it].text, gap = parsed[it].level > 0) }
}

private val tableDivider = Regex("^\\|?[\\s:|-]+\\|?$")

/** A table's rows as "a · b · c"; nothing for a table with no rows. */
private fun tableLines(rows: List<String>): List<CharSequence> {
    val cells = rows
        .filterNot { tableDivider.matches(it) }
        .map { row -> row.trim('|').split('|').map { inline(it) }.filter { it.isNotEmpty() } }
        .filter { it.isNotEmpty() }
    if (cells.size < 2) return emptyList()
    return cells.mapIndexed { index, row ->
        val text = row.joinToString(" · ")
        if (index == 0) bold(text) else text
    }
}

private fun bold(text: String): CharSequence {
    val span = SpannableString(text)
    span.setSpan(StyleSpan(Typeface.BOLD), 0, text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    return span
}

/** A heading in bold, a top-level one larger; null when it has no text. */
private fun headingText(match: MatchResult): CharSequence? {
    val text = inline(match.groupValues[2]).ifEmpty { return null }
    val span = SpannableString(text)
    span.setSpan(StyleSpan(Typeface.BOLD), 0, text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    if (match.groupValues[1].length <= 2) {
        span.setSpan(RelativeSizeSpan(1.1f), 0, text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    return span
}

/** A line other than a heading or table row; null when it has no text. */
private fun styled(line: String): CharSequence? {
    task.matchEntire(line)?.let { match ->
        val text = inline(match.groupValues[3]).ifEmpty { return null }
        val box = if (match.groupValues[2] == " ") "☐" else "☑"
        return indent(match.groupValues[1]) + "$box " + text
    }
    bullet.matchEntire(line)?.let { match ->
        val text = inline(match.groupValues[2]).ifEmpty { return null }
        return indent(match.groupValues[1]) + "• " + text
    }
    quote.matchEntire(line)?.let { match ->
        val text = inline(match.groupValues[1]).ifEmpty { return null }
        return "│ " + text
    }
    return inline(line).ifEmpty { null }
}

private fun indent(spaces: String) = " ".repeat(spaces.replace("\t", "  ").length / 2)

private fun inline(text: String) = text
    .replace(image, "")
    .replace(link, "$1")
    .replace(emphasis, "$2")
    .trim()
