package app.notesgraph.pro.plugin

/**
 * The last stretch of what the mic heard, addressed by position in the whole
 * stream, so a span the VAD marked as speech can be cut again with some of
 * the audio around it.
 *
 * The VAD hands back only the samples it judged to be speech, and it judges
 * late: the first consonant of a phrase and the tail of its last word fall
 * outside. Fed those bare segments, the recognizer heard "Gips making" for
 * "It keeps making" and dropped a phrase's first or last word; with 0.3 s
 * kept before and 0.25 s after, the same recording came out right.
 *
 * The session's first utterance gets a longer lead-in. People start talking
 * the moment the mic opens, and the VAD can miss those first words entirely:
 * on a capture whose recording starts with "read up", the text started after it.
 * Whisper decodes a fixed 30 s window, so the extra audio costs nothing.
 */
internal class SpeechPadding(
    private val sampleRate: Int,
    /** How much audio to keep. Must cover the longest segment and its padding. */
    historySeconds: Float,
    beforeSeconds: Float = BEFORE_S,
    afterSeconds: Float = AFTER_S,
    firstBeforeSeconds: Float = FIRST_BEFORE_S,
    /** A segment this long was cut by the VAD mid-speech, not ended by a pause. */
    private val maxSpeechSeconds: Float,
) {
    private val ring = FloatArray((historySeconds * sampleRate).toInt())
    private val before = (beforeSeconds * sampleRate).toInt()
    private val after = (afterSeconds * sampleRate).toInt()
    private val firstBefore = (firstBeforeSeconds * sampleRate).toInt()

    /** No segment has been cut yet. */
    private var first = true

    /** How far before speech to start, for the utterance now being heard. */
    private val lead get() = if (first) maxOf(before, firstBefore) else before

    /** Samples heard since the session began; the stream position of the next one. */
    var heard = 0L
        private set

    /** Where the last padded segment ended, so the next one doesn't repeat it. */
    private var lastEnd = 0L

    fun add(samples: FloatArray) {
        for (sample in samples) {
            ring[(heard % ring.size).toInt()] = sample
            heard++
        }
    }

    /** The newest audio: the lead-in to speech that has just begun. */
    fun leadIn(): FloatArray = slice(heard - lead, heard)

    /**
     * A VAD segment (`length` samples from stream position `start`) with the
     * audio around it. Falls back to no padding on a side where that would
     * repeat audio: after a segment the VAD cut at its length limit the
     * speaker is still talking, and what follows belongs to the next segment.
     */
    fun padded(start: Long, length: Int): FloatArray {
        val end = start + length
        val cutMidSpeech = length >= ((maxSpeechSeconds - 0.5f) * sampleRate).toInt()
        val from = maxOf(start - lead, lastEnd, 0L)
        val to = if (cutMidSpeech) end else minOf(end + after, heard)
        lastEnd = to
        first = false
        return slice(minOf(from, start), to)
    }

    /** Stream positions [from, to), as far as the history still reaches. */
    private fun slice(from: Long, to: Long): FloatArray {
        val first = maxOf(from, heard - ring.size, 0L)
        val last = minOf(to, heard)
        if (last <= first) return FloatArray(0)
        return FloatArray((last - first).toInt()) { ring[((first + it) % ring.size).toInt()] }
    }

    companion object {
        /** Enough for the consonant the VAD was still deciding about. */
        const val BEFORE_S = 0.3f
        /** Under the pause that ends an utterance, so segments never overlap. */
        const val AFTER_S = 0.25f
        /** Enough for words said as the mic opened, which the VAD may not have counted. */
        const val FIRST_BEFORE_S = 2f
    }
}
