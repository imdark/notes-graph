package app.notesgraph.pro.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import app.notesgraph.pro.AppLock
import app.notesgraph.pro.MainActivity
import app.notesgraph.pro.R
import app.notesgraph.pro.push.AgentApi
import app.notesgraph.pro.theme.NotesGraphTheme
import app.notesgraph.pro.theme.ThemeMode
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Choose what a note widget shows: today's journal, or a note found by its
 * title. Opened by the launcher when the widget is added, and again from
 * the widget's settings to change it.
 */
class NoteWidgetConfigActivity : FragmentActivity() {

    private var dark = false
    private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID

    // In the app's own colour mode, as AgentQuestionActivity is.
    override fun attachBaseContext(newBase: Context) {
        val systemDark = (newBase.resources.configuration.uiMode and
            Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        dark = AppLock.isDark(newBase, systemDark)
        super.attachBaseContext(newBase)
        applyOverrideConfiguration(Configuration().apply {
            uiMode = if (dark) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO
        })
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val bars = if (dark) {
            SystemBarStyle.dark(Color.TRANSPARENT)
        } else {
            SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
        }
        enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
        super.onCreate(savedInstanceState)
        window.setBackgroundDrawableResource(
            if (dark) R.color.layer_background_primary_dark else R.color.layer_background_primary
        )
        widgetId = intent.getIntExtra(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID,
        )
        // Backing out leaves a newly added widget off the home screen.
        setResult(RESULT_CANCELED, result())
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            setRecentsScreenshotEnabled(!AppLock.isEnabled(this))
        }
        // The note list is the user's notes, so the app lock guards it too.
        if (AppLock.needsUnlock(this)) {
            AppLock.authenticate(this) { ok -> if (ok) show() else finish() }
        } else {
            show()
        }
    }

    private fun result() =
        Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)

    private fun show() {
        setContent {
            NotesGraphTheme(mode = if (dark) ThemeMode.Dark else ThemeMode.Light) {
                Surface(modifier = Modifier.fillMaxSize()) {
                    ChooseScreen(
                        widgetId = widgetId,
                        onChoose = ::choose,
                        onOpenApp = {
                            startActivity(
                                Intent(this, MainActivity::class.java)
                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            )
                            finish()
                        },
                    )
                }
            }
        }
    }

    private fun choose(config: NoteWidgets.Config) {
        lifecycleScope.launch {
            NoteWidgets.setConfig(applicationContext, widgetId, config)
            // A new look on the same note redraws the copy it has at once.
            NoteWidgetViews.render(
                applicationContext, widgetId, config, NoteWidgets.content(applicationContext, widgetId),
            )
            NoteWidgetWorker.schedule(applicationContext)
            NoteWidgetWorker.refresh(applicationContext)
            setResult(RESULT_OK, result())
            finish()
        }
    }
}

@Composable
private fun ChooseScreen(
    widgetId: Int,
    onChoose: (NoteWidgets.Config) -> Unit,
    onOpenApp: () -> Unit,
) {
    val context = LocalContext.current
    var loaded by remember { mutableStateOf(false) }
    var workspace by remember { mutableStateOf<NoteWidgets.Workspace?>(null) }
    // Set when changing a widget already on the home screen.
    var existing by remember { mutableStateOf<NoteWidgets.Config?>(null) }
    var style by remember { mutableStateOf(NoteWidgets.Style()) }
    LaunchedEffect(Unit) {
        workspace = NoteWidgets.workspace(context.applicationContext)
        existing = NoteWidgets.config(context.applicationContext, widgetId)
        existing?.let { style = it.style }
        loaded = true
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .imePadding()
            .padding(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        val current = workspace
        val shown = existing
        if (loaded && (current != null || shown != null)) {
            LookSettings(style) { style = it }
            if (shown != null) {
                val what = if (shown.journal) {
                    stringResource(R.string.note_widget_config_journal)
                } else {
                    shown.title.ifBlank { stringResource(R.string.note_widget_untitled) }
                }
                Button(
                    onClick = { onChoose(shown.copy(style = style)) },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                ) {
                    Text(
                        stringResource(R.string.note_widget_config_keep, what),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            HorizontalDivider()
        }
        Text(
            stringResource(R.string.note_widget_config_title),
            style = MaterialTheme.typography.titleLarge,
        )
        when {
            !loaded -> Unit
            current == null -> {
                Text(stringResource(R.string.note_widget_config_no_workspace))
                Button(onClick = onOpenApp, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.note_widget_config_open_app))
                }
            }
            else -> {
                fun config(docId: String?, title: String) = NoteWidgets.Config(
                    current.server, current.workspaceId, docId, title, style,
                )
                Button(
                    onClick = { onChoose(config(null, "")) },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                ) {
                    Text(stringResource(R.string.note_widget_config_journal))
                }
                Text(
                    stringResource(R.string.note_widget_config_journal_hint),
                    style = MaterialTheme.typography.bodySmall,
                )
                NoteSearch(current) { docId, title -> onChoose(config(docId, title)) }
            }
        }
    }
}

/** Text size, line spacing and colours, each a row of segmented buttons. */
@Composable
private fun LookSettings(style: NoteWidgets.Style, onChange: (NoteWidgets.Style) -> Unit) {
    Text(
        stringResource(R.string.note_widget_config_look),
        style = MaterialTheme.typography.titleLarge,
    )
    Choice(
        label = stringResource(R.string.note_widget_config_text_size),
        options = NoteWidgets.TextSize.entries,
        selected = style.textSize,
        name = {
            stringResource(
                when (it) {
                    NoteWidgets.TextSize.Small -> R.string.note_widget_config_small
                    NoteWidgets.TextSize.Medium -> R.string.note_widget_config_medium
                    NoteWidgets.TextSize.Large -> R.string.note_widget_config_large
                }
            )
        },
        onSelect = { onChange(style.copy(textSize = it)) },
    )
    Choice(
        label = stringResource(R.string.note_widget_config_spacing),
        options = NoteWidgets.Spacing.entries,
        selected = style.spacing,
        name = {
            stringResource(
                when (it) {
                    NoteWidgets.Spacing.Compact -> R.string.note_widget_config_compact
                    NoteWidgets.Spacing.Normal -> R.string.note_widget_config_normal
                    NoteWidgets.Spacing.Roomy -> R.string.note_widget_config_roomy
                }
            )
        },
        onSelect = { onChange(style.copy(spacing = it)) },
    )
    Choice(
        label = stringResource(R.string.note_widget_config_theme),
        options = NoteWidgets.Theme.entries,
        selected = style.theme,
        name = {
            stringResource(
                when (it) {
                    NoteWidgets.Theme.System -> R.string.note_widget_config_system
                    NoteWidgets.Theme.Light -> R.string.note_widget_config_light
                    NoteWidgets.Theme.Dark -> R.string.note_widget_config_dark
                }
            )
        },
        onSelect = { onChange(style.copy(theme = it)) },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun <T> Choice(
    label: String,
    options: List<T>,
    selected: T,
    name: @Composable (T) -> String,
    onSelect: (T) -> Unit,
) {
    Text(label, style = MaterialTheme.typography.labelLarge)
    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
        options.forEachIndexed { index, option ->
            SegmentedButton(
                selected = option == selected,
                onClick = { onSelect(option) },
                shape = SegmentedButtonDefaults.itemShape(index = index, count = options.size),
            ) {
                Text(name(option), maxLines = 1)
            }
        }
    }
}

@Composable
private fun NoteSearch(
    workspace: NoteWidgets.Workspace,
    onPick: (String, String) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<Pair<String, String>>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var searching by remember { mutableStateOf(false) }

    LaunchedEffect(query) {
        if (query.isBlank()) {
            results = null
            error = null
            return@LaunchedEffect
        }
        delay(300)
        searching = true
        try {
            results = NoteWidgets.search(workspace, query.trim())
            error = null
        } catch (e: Exception) {
            error = (e as? AgentApi.HttpError)?.message ?: e.message ?: e.javaClass.simpleName
        } finally {
            searching = false
        }
    }

    OutlinedTextField(
        value = query,
        onValueChange = { query = it },
        label = { Text(stringResource(R.string.note_widget_config_search)) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
    val found = results
    when {
        error != null -> Text(stringResource(R.string.note_widget_config_search_failed, error!!))
        searching && found == null -> Text(stringResource(R.string.note_widget_config_searching))
        found != null && found.isEmpty() -> Text(stringResource(R.string.note_widget_config_no_results))
        found != null -> {
            val untitled = stringResource(R.string.note_widget_untitled)
            LazyColumn(modifier = Modifier.fillMaxWidth()) {
                items(found, key = { it.first }) { (docId, title) ->
                    Text(
                        title.ifBlank { untitled },
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp)
                            .clickable { onPick(docId, title) }
                            .padding(vertical = 12.dp),
                    )
                    HorizontalDivider()
                }
            }
        }
    }
}
