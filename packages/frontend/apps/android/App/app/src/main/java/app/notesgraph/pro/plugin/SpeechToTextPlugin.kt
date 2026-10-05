package app.notesgraph.pro.plugin

import android.Manifest
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.view.WindowManager
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import timber.log.Timber
import java.util.Locale

/**
 * Dictation for the web layer, which has no speech recognition of its own in
 * the Android WebView. Android's recognizer hears one utterance at a time, so
 * each is reported as a segment and listening restarts until stop() - that's
 * what turns the speaker's pauses into separate tasks.
 *
 * A session can run for many minutes, i.e. hundreds of utterances, so each
 * utterance gets a fresh SpeechRecognizer (reusing one that long wears some
 * recognizers out), restarts are posted rather than made from inside the
 * recognizer's callbacks, error loops back off, and nothing the recognizer
 * throws is allowed to take the app down. The screen is kept on meanwhile:
 * nobody touches it while dictating, and the screen timing out would end it.
 *
 * Events, each tagged with the `session` that start() resolved with:
 *  - `partial` { text }: the utterance in progress
 *  - `segment` { text }: a finished utterance
 *  - `end` { error? }: listening is over
 */
@CapacitorPlugin(
    name = "SpeechToText",
    permissions = [
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = SpeechToTextPlugin.MICROPHONE),
    ],
)
class SpeechToTextPlugin : Plugin() {

    // Everything below is touched on the main thread only: SpeechRecognizer
    // must be created and driven there, and its callbacks arrive there.
    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var active = false
    private var session = 0
    private var stopping = false
    private var lang = ""
    // Errors in a row with no utterance heard; drives the backoff and gives up
    // on a recognizer that keeps failing.
    private var failures = 0
    private val restart = Runnable { listen() }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        call.resolve(JSObject().put("available", SpeechRecognizer.isRecognitionAvailable(context)))
    }

    /** `{ lang }` - a BCP 47 tag. Resolves `{ session }` once listening. */
    @PluginMethod
    fun start(call: PluginCall) {
        if (getPermissionState(MICROPHONE) != PermissionState.GRANTED) {
            requestPermissionForAlias(MICROPHONE, call, "onMicrophonePermission")
            return
        }
        startNow(call)
    }

    @PermissionCallback
    private fun onMicrophonePermission(call: PluginCall) {
        if (getPermissionState(MICROPHONE) == PermissionState.GRANTED) {
            startNow(call)
        } else {
            call.reject("Microphone permission denied", "permission-denied")
        }
    }

    private fun startNow(call: PluginCall) {
        main.post {
            if (!SpeechRecognizer.isRecognitionAvailable(context)) {
                call.reject("No speech recognizer on this device", "unavailable")
                return@post
            }
            // One session at a time; a new start ends the old one.
            finish(null)
            session += 1
            active = true
            stopping = false
            failures = 0
            lang = call.getString("lang") ?: Locale.getDefault().toLanguageTag()
            keepScreenOn(true)
            listen()
            call.resolve(JSObject().put("session", session))
        }
    }

    /** Stop listening. The utterance in progress still arrives as a segment. */
    @PluginMethod
    fun stop(call: PluginCall) {
        main.post {
            if (active && !stopping) {
                stopping = true
                main.removeCallbacks(restart)
                val r = recognizer
                if (r == null) {
                    // Between utterances: nothing in progress to wait for.
                    finish(null)
                } else {
                    safely { r.stopListening() }
                    // Recognizers normally answer a stop with a result or an
                    // error; don't leave the mic open if one never does.
                    val id = session
                    main.postDelayed({ if (id == session) finish(null) }, STOP_TIMEOUT_MS)
                }
            }
            call.resolve()
        }
    }

    override fun handleOnPause() {
        // Leaving the app ends dictation rather than listening in the background.
        main.post { finish(null) }
    }

    override fun handleOnDestroy() {
        main.post { finish(null) }
    }

    /** Listen for the next utterance on a recognizer of its own. */
    private fun listen() {
        if (!active || stopping) return
        release()
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
        }
        try {
            val r = SpeechRecognizer.createSpeechRecognizer(context)
            recognizer = r
            r.setRecognitionListener(Listener(r))
            r.startListening(intent)
        } catch (e: Exception) {
            Timber.w(e, "SpeechToText: couldn't start listening")
            retry()
        }
    }

    /** Listen again after a pause that grows while errors keep coming. */
    private fun retry() {
        failures += 1
        if (failures > MAX_FAILURES) {
            finish("failed")
            return
        }
        val delay = (RESTART_DELAY_MS shl minOf(failures, 5)).coerceAtMost(MAX_RESTART_DELAY_MS)
        restartAfter(delay)
    }

    private fun restartAfter(delayMs: Long) {
        release()
        main.removeCallbacks(restart)
        main.postDelayed(restart, delayMs)
    }

    private fun release() {
        val r = recognizer ?: return
        // Detached now, so its late callbacks are ignored; destroyed once the
        // callback we may be inside of has returned.
        recognizer = null
        main.post {
            safely { r.cancel() }
            safely { r.destroy() }
        }
    }

    private fun finish(error: String?) {
        if (!active) return
        active = false
        stopping = false
        main.removeCallbacks(restart)
        release()
        keepScreenOn(false)
        emit("end", JSObject().apply { if (error != null) put("error", error) })
    }

    private fun keepScreenOn(on: Boolean) {
        safely {
            val window = activity?.window ?: return@safely
            if (on) {
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
    }

    private fun emit(event: String, data: JSObject) {
        safely { notifyListeners(event, data.put("session", session)) }
    }

    private inline fun safely(block: () -> Unit) {
        try {
            block()
        } catch (e: Exception) {
            Timber.w(e, "SpeechToText")
        }
    }

    private inner class Listener(private val owner: SpeechRecognizer) : RecognitionListener {
        // Only the recognizer listening right now speaks for the session.
        private val current get() = active && recognizer === owner

        override fun onBeginningOfSpeech() {
            if (current) failures = 0
        }

        override fun onPartialResults(partialResults: Bundle?) {
            if (!current) return
            emit("partial", JSObject().put("text", firstResult(partialResults)))
        }

        override fun onResults(results: Bundle?) {
            if (!current) return
            val text = firstResult(results)
            if (text.isNotBlank()) {
                failures = 0
                emit("segment", JSObject().put("text", text))
            }
            if (stopping) finish(null) else restartAfter(RESTART_DELAY_MS)
        }

        override fun onError(error: Int) {
            if (!current) return
            when {
                stopping -> finish(null)
                error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> finish("permission-denied")
                // Silence, or nothing it could make out: the usual end of a
                // turn with no utterance, so just listen again.
                error == SpeechRecognizer.ERROR_NO_MATCH ||
                    error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> restartAfter(RESTART_DELAY_MS)
                // Busy, client/server hiccups, network: try again on a fresh
                // recognizer, backing off, and give up if it never recovers.
                else -> retry()
            }
        }

        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    private fun firstResult(bundle: Bundle?): String =
        bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()

    companion object {
        const val MICROPHONE = "microphone"
        private const val STOP_TIMEOUT_MS = 3000L
        private const val RESTART_DELAY_MS = 100L
        private const val MAX_RESTART_DELAY_MS = 3000L
        private const val MAX_FAILURES = 8
    }
}
