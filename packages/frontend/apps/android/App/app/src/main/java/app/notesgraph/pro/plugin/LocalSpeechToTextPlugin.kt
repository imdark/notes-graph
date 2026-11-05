package app.notesgraph.pro.plugin

import android.Manifest
import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.NoiseSuppressor
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineMoonshineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.SileroVadModelConfig
import com.k2fsa.sherpa.onnx.Vad
import com.k2fsa.sherpa.onnx.VadModelConfig
import okhttp3.OkHttpClient
import okhttp3.Request
import timber.log.Timber
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * Dictation that runs on the phone, for capture: a sharper alternative to the
 * system recognizer (SpeechToTextPlugin). Audio comes from the mic with the
 * platform noise suppressor on; Silero VAD keeps only the stretches that are
 * speech, so background noise never reaches the recognizer; each stretch is
 * transcribed by Moonshine (base, English). While someone is still talking, the
 * speech so far is re-transcribed now and then as the partial text.
 *
 * The models (about 290 MB) aren't in the APK: download() fetches them once
 * into app storage, each file checked against its hash.
 *
 * Events, each tagged with the `session` that start() resolved with:
 *  - `partial` { text }: the utterance in progress
 *  - `segment` { text }: a finished utterance
 *  - `end` { error? }: listening is over
 *  - `progress` { downloaded, total }: model download, in bytes
 */
@CapacitorPlugin(
    name = "LocalSpeechToText",
    permissions = [
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = LocalSpeechToTextPlugin.MICROPHONE),
    ],
)
class LocalSpeechToTextPlugin : Plugin() {

    private val main = Handler(Looper.getMainLooper())

    // Transcription runs here, one stretch of speech at a time, in order. The
    // recognizer is made, used and released on this thread only.
    private val decoder = Executors.newSingleThreadExecutor { Thread(it, "local-stt-decode") }
    private var recognizer: OfflineRecognizer? = null
    private val releaseIdle = Runnable { queue { releaseRecognizer() } }

    private val downloading = AtomicBoolean(false)
    private val waiting = mutableListOf<PluginCall>()

    // Main thread only.
    private var session = 0
    private var recording: Recording? = null

    private val modelDir get() = File(context.filesDir, "speech/$MODEL_NAME")
    private val vadFile get() = File(context.filesDir, "speech/silero_vad.onnx")

    private fun fileFor(file: ModelFile) = if (file.name == VAD_NAME) vadFile else File(modelDir, file.name)

    private fun ready() = FILES.all { fileFor(it).length() == it.size }

    @PluginMethod
    fun status(call: PluginCall) {
        val state = when {
            downloading.get() -> "downloading"
            ready() -> "ready"
            else -> "missing"
        }
        call.resolve(
            JSObject()
                .put("state", state)
                .put("downloaded", FILES.sumOf { minOf(partialLength(it), it.size) })
                .put("total", TOTAL_BYTES),
        )
    }

    private fun partialLength(file: ModelFile): Long {
        val done = fileFor(file)
        return if (done.exists()) done.length() else File(done.path + ".part").length()
    }

    /** Fetch the models. Resolves once all are in place; a cut-off download resumes. */
    @PluginMethod
    fun download(call: PluginCall) {
        // A second caller waits for the download already going.
        synchronized(waiting) { waiting += call }
        if (!downloading.compareAndSet(false, true)) return
        thread(name = "local-stt-download") {
            var error: Exception? = null
            try {
                fetchModels()
            } catch (e: Exception) {
                Timber.w(e, "LocalSpeechToText: download failed")
                error = e
            }
            val calls = synchronized(waiting) {
                downloading.set(false)
                waiting.toList().also { waiting.clear() }
            }
            calls.forEach {
                if (error == null) it.resolve() else it.reject(error.message ?: "Download failed", "failed")
            }
        }
    }

    /** Delete the downloaded models. */
    @PluginMethod
    fun remove(call: PluginCall) {
        main.post {
            if (recording != null || downloading.get()) {
                call.reject("In use", "busy")
                return@post
            }
            queue {
                releaseRecognizer()
                File(context.filesDir, "speech").deleteRecursively()
                call.resolve()
            }
        }
    }

    /** Resolves `{ session }` once the mic is open. */
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
            if (!ready()) {
                call.reject("The speech model isn't downloaded", "unavailable")
                return@post
            }
            recording?.finish(null)
            session += 1
            main.removeCallbacks(releaseIdle)
            val next = Recording(session)
            if (!next.open()) {
                call.reject("Couldn't open the microphone", "failed")
                return@post
            }
            recording = next
            keepScreenOn(true)
            call.resolve(JSObject().put("session", session))
        }
    }

    /** Stop listening. What was being said still arrives as a segment. */
    @PluginMethod
    fun stop(call: PluginCall) {
        main.post {
            recording?.stop()
            call.resolve()
        }
    }

    override fun handleOnPause() {
        // Leaving the app ends dictation rather than listening in the background.
        main.post { recording?.stop() }
    }

    override fun handleOnDestroy() {
        main.post { recording?.finish(null) }
        queue { releaseRecognizer() }
        decoder.shutdown()
    }

    /** One listening session: the mic, the VAD and the speech heard so far. */
    private inner class Recording(val id: Int) {
        private var audio: AudioRecord? = null
        private var suppressor: NoiseSuppressor? = null
        private var vad: Vad? = null
        @Volatile private var running = false
        /** The read loop is going, and owns the mic and the VAD. */
        private var started = false
        private var ended = false
        private val decodingPartial = AtomicBoolean(false)

        @SuppressLint("MissingPermission") // checked in start()
        fun open(): Boolean {
            return try {
                val minBuffer = AudioRecord.getMinBufferSize(
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                )
                val record = AudioRecord(
                    // Tuned for speech, with the device's own noise handling.
                    MediaRecorder.AudioSource.VOICE_RECOGNITION,
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    maxOf(minBuffer, WINDOW * 2 * 8),
                )
                if (record.state != AudioRecord.STATE_INITIALIZED) {
                    record.release()
                    return false
                }
                audio = record
                if (NoiseSuppressor.isAvailable()) {
                    suppressor = NoiseSuppressor.create(record.audioSessionId)?.apply { enabled = true }
                }
                vad = Vad(
                    config = VadModelConfig(
                        sileroVadModelConfig = SileroVadModelConfig(
                            model = vadFile.absolutePath,
                            threshold = VAD_THRESHOLD,
                            minSilenceDuration = MIN_SILENCE_S,
                            minSpeechDuration = MIN_SPEECH_S,
                            windowSize = WINDOW,
                            maxSpeechDuration = MAX_SPEECH_S,
                        ),
                        sampleRate = SAMPLE_RATE,
                        numThreads = 1,
                    ),
                )
                // Loading the recognizer takes a moment; the mic is already
                // recording, and what it hears waits in the decode queue.
                queue { loadRecognizer() }
                record.startRecording()
                running = true
                started = true
                thread(name = "local-stt-record") { readLoop() }
                true
            } catch (e: Exception) {
                Timber.w(e, "LocalSpeechToText: couldn't start")
                closeAudio()
                safely { vad?.release() }
                false
            }
        }

        private fun readLoop() {
            val record = audio ?: return
            val vad = vad ?: return
            val pcm = ShortArray(WINDOW)
            // The current utterance, for partial text.
            var live = FloatArray(0)
            var sinceLastPartial = 0
            try {
                while (running) {
                    val n = record.read(pcm, 0, pcm.size)
                    if (n <= 0) {
                        if (n < 0) throw IllegalStateException("AudioRecord.read returned $n")
                        continue
                    }
                    val samples = FloatArray(n) { pcm[it] / 32768f }
                    vad.acceptWaveform(samples)
                    if (vad.isSpeechDetected()) {
                        live += samples
                        sinceLastPartial += n
                        if (sinceLastPartial >= PARTIAL_EVERY_SAMPLES && decodingPartial.compareAndSet(false, true)) {
                            sinceLastPartial = 0
                            val snapshot = live
                            queue {
                                try {
                                    transcribe(snapshot)?.let { emit(id, "partial", it) }
                                } finally {
                                    decodingPartial.set(false)
                                }
                            }
                        }
                    }
                    if (drain(vad)) {
                        live = FloatArray(0)
                        sinceLastPartial = 0
                    }
                }
                vad.flush()
                drain(vad)
                queue { main.post { finish(null) } }
            } catch (e: Exception) {
                Timber.w(e, "LocalSpeechToText: recording failed")
                main.post { finish("failed") }
            } finally {
                // This thread is the only one that touches the mic and the VAD
                // once recording, so it alone lets them go.
                closeAudio()
                safely { vad.release() }
            }
        }

        /** Queue each finished stretch of speech for transcription. */
        private fun drain(vad: Vad): Boolean {
            var any = false
            while (!vad.empty()) {
                val segment = vad.front().samples
                vad.pop()
                any = true
                queue {
                    val text = transcribe(segment)
                    // Clear the partial even when the stretch was only noise.
                    emit(id, "partial", "")
                    if (text != null) emit(id, "segment", text)
                }
            }
            return any
        }

        /** Stop listening; queued speech is still transcribed before `end`. */
        fun stop() {
            running = false
        }

        fun finish(error: String?) {
            if (ended) return
            ended = true
            running = false
            if (recording === this) {
                recording = null
                keepScreenOn(false)
                main.postDelayed(releaseIdle, RELEASE_IDLE_MS)
            }
            // The read loop sees `running` drop and closes the mic itself.
            if (!started) closeAudio()
            emitNow(id, "end", JSObject().apply { if (error != null) put("error", error) })
        }

        @Synchronized
        private fun closeAudio() {
            val record = audio
            audio = null
            safely { suppressor?.release() }
            suppressor = null
            safely { record?.stop() }
            safely { record?.release() }
        }
    }

    // Decode thread only, from here to releaseRecognizer().

    private fun loadRecognizer(): OfflineRecognizer? {
        recognizer?.let { return it }
        return try {
            OfflineRecognizer(
                config = OfflineRecognizerConfig(
                    modelConfig = OfflineModelConfig(
                        moonshine = OfflineMoonshineModelConfig(
                            preprocessor = File(modelDir, "preprocess.onnx").absolutePath,
                            encoder = File(modelDir, "encode.int8.onnx").absolutePath,
                            uncachedDecoder = File(modelDir, "uncached_decode.int8.onnx").absolutePath,
                            cachedDecoder = File(modelDir, "cached_decode.int8.onnx").absolutePath,
                        ),
                        tokens = File(modelDir, "tokens.txt").absolutePath,
                        numThreads = DECODE_THREADS,
                    ),
                ),
            ).also { recognizer = it }
        } catch (e: Exception) {
            Timber.w(e, "LocalSpeechToText: couldn't load the model")
            main.post { recording?.finish("failed") }
            null
        }
    }

    /** The words in a stretch of audio, or null if there were none. */
    private fun transcribe(samples: FloatArray): String? {
        if (samples.size < MIN_DECODE_SAMPLES) return null
        val r = loadRecognizer() ?: return null
        return try {
            val stream = r.createStream()
            try {
                stream.acceptWaveform(samples, SAMPLE_RATE)
                r.decode(stream)
                r.getResult(stream).text.trim().takeIf { text -> text.any { it.isLetterOrDigit() } }
            } finally {
                stream.release()
            }
        } catch (e: Exception) {
            Timber.w(e, "LocalSpeechToText: decode failed")
            null
        }
    }

    private fun releaseRecognizer() {
        safely { recognizer?.release() }
        recognizer = null
    }

    private fun fetchModels() {
        val client = OkHttpClient.Builder()
            .readTimeout(60, TimeUnit.SECONDS)
            .build()
        var done = FILES.sumOf { if (fileFor(it).length() == it.size) it.size else 0L }
        var lastReported = -1L
        val report = { bytes: Long ->
            // About every 1%, so the bridge isn't flooded.
            if (bytes - lastReported >= TOTAL_BYTES / 100 || bytes == TOTAL_BYTES) {
                lastReported = bytes
                emitNow(session, "progress", JSObject().put("downloaded", bytes).put("total", TOTAL_BYTES))
            }
        }
        report(done)
        for (file in FILES) {
            val target = fileFor(file)
            if (target.length() == file.size) continue
            target.parentFile?.mkdirs()
            val part = File(target.path + ".part")
            if (part.length() > file.size) part.delete()
            val have = part.length()
            val request = Request.Builder().url(file.url).apply {
                if (have > 0) header("Range", "bytes=$have-")
            }.build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw IllegalStateException("HTTP ${response.code} for ${file.name}")
                val append = have > 0 && response.code == 206
                var written = if (append) have else 0L
                FileOutputStream(part, append).use { out ->
                    val input = response.body.byteStream()
                    val buf = ByteArray(1 shl 16)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        written += n
                        report(done + written)
                    }
                }
            }
            if (part.length() != file.size || sha256(part) != file.sha256) {
                part.delete()
                throw IllegalStateException("${file.name} didn't download intact")
            }
            if (!part.renameTo(target)) throw IllegalStateException("Couldn't save ${file.name}")
            done += file.size
            report(done)
        }
    }

    private fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(1 shl 16)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    /** Run on the decode thread, unless the plugin is already gone. */
    private fun queue(task: () -> Unit) {
        try {
            decoder.execute(task)
        } catch (e: RejectedExecutionException) {
            Timber.d("LocalSpeechToText: dropped work after shutdown")
        }
    }

    private fun emit(id: Int, event: String, text: String) {
        emitNow(id, event, JSObject().put("text", text))
    }

    private fun emitNow(id: Int, event: String, data: JSObject) {
        main.post { safely { notifyListeners(event, data.put("session", id)) } }
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

    private inline fun safely(block: () -> Unit) {
        try {
            block()
        } catch (e: Exception) {
            Timber.w(e, "LocalSpeechToText")
        }
    }

    private class ModelFile(val name: String, val url: String, val size: Long, val sha256: String)

    companion object {
        const val MICROPHONE = "microphone"

        private const val SAMPLE_RATE = 16000
        /** Silero's window: 32 ms of audio. */
        private const val WINDOW = 512
        /**
         * Below Silero's default 0.5: with noise as loud as the speech, 0.5
         * dropped about half the words, 0.3 almost none; noise alone still
         * produced no segments at 0.2.
         */
        private const val VAD_THRESHOLD = 0.3f
        /** A pause this long ends an utterance. */
        private const val MIN_SILENCE_S = 0.6f
        /** Shorter blips (a cough, a click) are dropped as noise. */
        private const val MIN_SPEECH_S = 0.3f
        /** Longer speech is cut here so text keeps appearing. */
        private const val MAX_SPEECH_S = 20f
        private const val MIN_DECODE_SAMPLES = SAMPLE_RATE / 4
        /** Re-transcribe the utterance in progress after this much more speech. */
        private const val PARTIAL_EVERY_SAMPLES = SAMPLE_RATE * 7 / 10
        private const val DECODE_THREADS = 4
        /** The model takes ~300 MB of memory; let it go when dictation stops for a while. */
        private const val RELEASE_IDLE_MS = 120_000L

        private const val MODEL_NAME = "moonshine-base-en-int8"
        private const val VAD_NAME = "silero_vad.onnx"
        private const val HF =
            "https://huggingface.co/csukuangfj/sherpa-onnx-moonshine-base-en-int8/resolve/052b0798ad1bf046a140fdd4efcd9426530fa3f5"

        private val FILES = listOf(
            ModelFile(
                VAD_NAME,
                "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx",
                643_854,
                "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6",
            ),
            ModelFile("tokens.txt", "$HF/tokens.txt", 436_688, "1165c2aeb9f72f457a83be2d459a09054f27490acd9b41bd43794dfd25e296ea"),
            ModelFile("preprocess.onnx", "$HF/preprocess.onnx", 14_077_290, "ffa630d395c5ccf76f5d4954be5b882df76aaf6491519ec01fd82ea7a3819fb2"),
            ModelFile("encode.int8.onnx", "$HF/encode.int8.onnx", 50_311_494, "7e38770f776f2e5583a53b052936005df2ba5c833d7e09c2a5fd796b94bf73e2"),
            ModelFile(
                "uncached_decode.int8.onnx",
                "$HF/uncached_decode.int8.onnx",
                122_120_451,
                "c01f4b35093bcac20d352d23a75a539e772964579f9d024a90e5e6f09cae9987",
            ),
            ModelFile(
                "cached_decode.int8.onnx",
                "$HF/cached_decode.int8.onnx",
                99_983_837,
                "2db74e51cedf64a8b1be3c8192e0bb5e4923af0e90bd9e87f8e8771873f8ea03",
            ),
        )
        private val TOTAL_BYTES = FILES.sumOf { it.size }
    }
}
