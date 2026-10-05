package app.notesgraph.pro.plugin

import android.Manifest
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.util.Locale

/**
 * Dictation for the web layer, which has no speech recognition of its own in
 * the Android WebView. Android's recognizer hears one utterance at a time, so
 * each is reported as a segment and listening restarts until stop() - that's
 * what turns the speaker's pauses into separate tasks.
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
    private var session = 0
    private var stopping = false
    private var lang = ""

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
            stopping = false
            lang = call.getString("lang") ?: Locale.getDefault().toLanguageTag()
            recognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
                setRecognitionListener(Listener(session))
            }
            listen()
            call.resolve(JSObject().put("session", session))
        }
    }

    /** Stop listening. The utterance in progress still arrives as a segment. */
    @PluginMethod
    fun stop(call: PluginCall) {
        main.post {
            val r = recognizer
            if (r != null && !stopping) {
                stopping = true
                r.stopListening()
                // Recognizers normally answer a stop with a result or an
                // error; don't leave the mic open if one never does.
                val id = session
                main.postDelayed({ if (id == session) finish(null) }, STOP_TIMEOUT_MS)
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

    private fun listen() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
        }
        recognizer?.startListening(intent)
    }

    private fun finish(error: String?) {
        val r = recognizer ?: return
        recognizer = null
        stopping = false
        r.destroy()
        emit("end", JSObject().apply { if (error != null) put("error", error) })
    }

    private fun emit(event: String, data: JSObject) {
        notifyListeners(event, data.put("session", session))
    }

    private inner class Listener(private val id: Int) : RecognitionListener {
        private val current get() = id == session && recognizer != null

        override fun onPartialResults(partialResults: Bundle?) {
            if (!current) return
            emit("partial", JSObject().put("text", firstResult(partialResults)))
        }

        override fun onResults(results: Bundle?) {
            if (!current) return
            val text = firstResult(results)
            if (text.isNotBlank()) emit("segment", JSObject().put("text", text))
            if (stopping) finish(null) else listen()
        }

        override fun onError(error: Int) {
            if (!current) return
            when {
                stopping -> finish(null)
                // Silence, or nothing it could make out: keep listening.
                error == SpeechRecognizer.ERROR_NO_MATCH ||
                    error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> listen()
                // Restarting straight after a result can catch it still busy.
                error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ->
                    main.postDelayed({ if (current) listen() }, BUSY_RETRY_MS)
                error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> finish("permission-denied")
                else -> finish("failed")
            }
        }

        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
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
        private const val BUSY_RETRY_MS = 300L
    }
}
