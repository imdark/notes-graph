package app.notesgraph.pro.push

import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import app.notesgraph.pro.AppLock
import app.notesgraph.pro.MainActivity
import app.notesgraph.pro.theme.NotesGraphTheme
import app.notesgraph.pro.theme.ThemeMode
import app.notesgraph.pro.theme.notesgraphDarkScheme
import app.notesgraph.pro.theme.notesgraphLightScheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * One agent question, in full, answered from the phone: the whole tool
 * input before Allow / Allow all / Deny, with an optional note; or the
 * question with its choices and a reply box.
 *
 * Opened from the notification. The push carries a clipped copy, so the
 * question is read back from the server first - which also tells us if it
 * was answered elsewhere in the meantime.
 */
class AgentQuestionActivity : FragmentActivity() {

    /** The app's own colour mode (it can differ from the system's). */
    private var dark = false

    override fun onCreate(savedInstanceState: Bundle?) {
        val systemDark = (resources.configuration.uiMode and
            Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        dark = AppLock.isDark(this, systemDark)
        val bars = if (dark) {
            SystemBarStyle.dark(Color.TRANSPARENT)
        } else {
            SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
        }
        enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
        super.onCreate(savedInstanceState)
        // Behind the unlock prompt, before the content is set.
        window.decorView.setBackgroundColor(
            (if (dark) notesgraphDarkScheme else notesgraphLightScheme).backgroundPrimary.toArgb()
        )
        val pushed = AgentQuestion.fromBundle(intent.extras)
        if (pushed == null) {
            finish()
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            setRecentsScreenshotEnabled(!AppLock.isEnabled(this))
        }
        // This screen can allow a tool on someone's machine, so the app lock
        // guards it as it does the notes. Nothing shows until unlocked.
        if (AppLock.needsUnlock(this)) {
            AppLock.authenticate(this) { ok ->
                if (ok) show(pushed) else finish()
            }
        } else {
            show(pushed)
        }
    }

    private fun show(pushed: AgentQuestion) {
        setContent {
            NotesGraphTheme(mode = if (dark) ThemeMode.Dark else ThemeMode.Light) {
                Surface(modifier = Modifier.fillMaxSize()) {
                    QuestionScreen(
                        pushed = pushed,
                        onDone = { finish() },
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
}

private sealed interface LoadState {
    data object Loading : LoadState
    data class Open(val question: AgentQuestion) : LoadState
    data class Closed(val message: String) : LoadState
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun QuestionScreen(
    pushed: AgentQuestion,
    onDone: () -> Unit,
    onOpenApp: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var state by remember { mutableStateOf<LoadState>(LoadState.Loading) }
    var note by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(pushed.questionId) {
        state = try {
            val reply = AgentApi.question(pushed.server, pushed.workspaceId, pushed.jobId, pushed.questionId)
            val q = reply.getJSONObject("question")
            val jobStatus = reply.optString("jobStatus")
            when {
                !q.isNull("answeredAt") -> LoadState.Closed("Already answered.")
                jobStatus != "running" -> LoadState.Closed("This run is $jobStatus; it's no longer waiting.")
                else -> {
                    val options = q.optJSONArray("options")
                    LoadState.Open(
                        pushed.copy(
                            text = q.optString("text", pushed.text),
                            detail = if (q.isNull("detail")) "" else q.optString("detail"),
                            options = options?.let { a -> List(a.length()) { a.getString(it) } }
                                ?: pushed.options,
                        )
                    )
                }
            }
        } catch (e: AgentApi.HttpError) {
            if (e.status == 404) LoadState.Closed("This run is gone.")
            // Can't reach it: work from what the push carried.
            else LoadState.Open(pushed).also { error = e.message }
        } catch (e: Exception) {
            error = "Offline - showing what the notification carried."
            LoadState.Open(pushed)
        }
        if (state is LoadState.Closed) AgentNotifications.cancel(context, pushed.questionId)
    }

    fun send(body: JSONObject, summary: String) {
        val question = (state as? LoadState.Open)?.question ?: return
        sending = true
        error = null
        scope.launch {
            val failed = AgentAnswerReceiver.answer(context.applicationContext, question, body, summary)
            sending = false
            if (failed == null) {
                state = LoadState.Closed("$summary. It carries on from here.")
                delay(900)
                onDone()
            } else {
                error = failed
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(pushed.agentName, style = MaterialTheme.typography.titleLarge)
        when (val s = state) {
            LoadState.Loading -> Text("Loading…")
            is LoadState.Closed -> {
                Text(s.message)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = onOpenApp) { Text("Open NotesGraph") }
                    TextButton(onClick = onDone) { Text("Close") }
                }
            }
            is LoadState.Open -> {
                val q = s.question
                Text(
                    if (q.isPermission) "Wants permission" else "Asks you",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                )
                Text(q.text, style = MaterialTheme.typography.bodyLarge)
                // File edits get a diff; Bash and other tools their command
                // and fields - as on the web card - instead of raw JSON.
                val preview = remember(q.text, q.detail) {
                    if (q.isPermission) ToolPreview.parse(q.text, q.detail) else null
                }
                if (preview != null) {
                    ToolPreviewView(preview)
                } else if (q.detail.isNotEmpty()) {
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        shape = MaterialTheme.shapes.small,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            prettyJson(q.detail),
                            fontFamily = FontFamily.Monospace,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(12.dp),
                        )
                    }
                }
                if (!q.isPermission && q.options.isNotEmpty()) {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        q.options.forEach { option ->
                            OutlinedButton(
                                enabled = !sending,
                                onClick = { send(JSONObject().put("answer", option), "Answered: $option") },
                            ) { Text(option) }
                        }
                    }
                }
                OutlinedTextField(
                    value = note,
                    onValueChange = { note = it },
                    enabled = !sending,
                    modifier = Modifier.fillMaxWidth(),
                    label = {
                        Text(
                            when {
                                q.isPermission -> "Add a note (optional)"
                                q.options.isNotEmpty() -> "Or type your own answer"
                                else -> "Your answer"
                            }
                        )
                    },
                    minLines = if (q.isPermission) 1 else 2,
                )
                val trimmed = note.trim()
                fun withNote(body: JSONObject) =
                    if (trimmed.isEmpty()) body else body.put("answer", trimmed)
                if (q.isPermission) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            enabled = !sending,
                            onClick = { send(withNote(JSONObject().put("allowed", true)), "Allowed") },
                        ) { Text("Allow") }
                        OutlinedButton(
                            enabled = !sending,
                            onClick = {
                                send(
                                    withNote(JSONObject().put("allowed", true).put("allowAll", true)),
                                    "Allowed for the rest of this run",
                                )
                            },
                        ) { Text("Allow all") }
                        OutlinedButton(
                            enabled = !sending,
                            onClick = { send(withNote(JSONObject().put("allowed", false)), "Denied") },
                        ) { Text("Deny") }
                    }
                } else {
                    Button(
                        enabled = !sending && trimmed.isNotEmpty(),
                        onClick = { send(JSONObject().put("answer", trimmed), "Answered") },
                    ) { Text("Send") }
                    Text(
                        "The agent saves what you tell it to your notes, so it won't ask again.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
}

/** Detail that didn't parse into a preview, indented if it is JSON at all. */
private fun prettyJson(detail: String): String =
    runCatching { JSONObject(detail).toString(2).replace("\\/", "/") }.getOrDefault(detail)
