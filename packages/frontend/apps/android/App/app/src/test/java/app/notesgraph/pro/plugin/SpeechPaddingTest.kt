package app.notesgraph.pro.plugin

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The audio is a ramp: each sample's value is its position in the stream, so
 * a slice says exactly which stretch it is.
 */
class SpeechPaddingTest {
    private val rate = 1000

    /** `firstBefore` 0: the first segment is padded like the rest, unless a test says otherwise. */
    private fun padding(history: Float = 30f, firstBefore: Float = 0f) = SpeechPadding(
        sampleRate = rate,
        historySeconds = history,
        beforeSeconds = 0.3f,
        afterSeconds = 0.25f,
        firstBeforeSeconds = firstBefore,
        maxSpeechSeconds = 20f,
    )

    /** Feed stream positions [from, to) in windows, as the mic does. */
    private fun SpeechPadding.hear(to: Int, window: Int = 32) {
        var at = heard.toInt()
        while (at < to) {
            val n = minOf(window, to - at)
            add(FloatArray(n) { (at + it).toFloat() })
            at += n
        }
    }

    private fun FloatArray.span() = if (isEmpty()) "empty" else "${first().toInt()}..${last().toInt()}"

    @Test
    fun aSegmentComesBackWithTheAudioAroundIt() {
        val p = padding()
        p.hear(5000)
        // speech at 2000..2999; 300 before, 250 after
        assertEquals("1700..3249", p.padded(2000, 1000).span())
    }

    @Test
    fun atTheStartOfTheStreamThereIsNothingBefore() {
        val p = padding()
        p.hear(2000)
        assertEquals("0..1249", p.padded(100, 900).span())
    }

    @Test
    fun whenListeningStopsMidSilenceTheTailIsWhatWasHeard() {
        val p = padding()
        p.hear(3100)
        // the stream ended 100 samples after the speech did
        assertEquals("1700..3099", p.padded(2000, 1000).span())
    }

    @Test
    fun segmentsCloseTogetherDoNotRepeatAudio() {
        val p = padding()
        p.hear(6000)
        assertEquals("700..2249", p.padded(1000, 1000).span())
        // the next speech starts 400 after the last ended: its lead-in would
        // reach back into the tail already sent
        assertEquals("2250..3649", p.padded(2400, 1000).span())
    }

    @Test
    fun aSegmentCutAtTheLengthLimitGetsNoTailAndTheNextNoLeadIn() {
        val p = padding()
        // 20 s of unbroken speech, cut by the VAD as it reaches the limit...
        p.hear(21000)
        assertEquals("700..20999", p.padded(1000, 20000).span())
        // ...then the rest of it, ended by a pause
        p.hear(25000)
        assertEquals("21000..24249", p.padded(21000, 3000).span())
    }

    @Test
    fun theLeadInIsTheNewestAudio() {
        val p = padding()
        p.hear(1000)
        assertEquals("700..999", p.leadIn().span())
    }

    @Test
    fun theLeadInBeforeAnythingMuchWasHeardIsWhatThereIs() {
        val p = padding()
        p.hear(120)
        assertEquals("0..119", p.leadIn().span())
    }

    @Test
    fun theFirstSegmentReachesFurtherBack() {
        val p = padding(firstBefore = 2f)
        p.hear(9000)
        // words before 3000 the VAD didn't count as speech are still in
        assertEquals("1000..4249", p.padded(3000, 1000).span())
        // later segments get the usual lead-in
        assertEquals("5700..7249", p.padded(6000, 1000).span())
    }

    @Test
    fun theFirstSegmentReachesBackNoFurtherThanTheStart() {
        val p = padding(firstBefore = 2f)
        p.hear(3000)
        assertEquals("0..1749", p.padded(500, 1000).span())
    }

    @Test
    fun theFirstLeadInMatchesTheFirstSegment() {
        val p = padding(firstBefore = 2f)
        p.hear(3000)
        assertEquals("1000..2999", p.leadIn().span())
        p.padded(2000, 500)
        p.hear(5000)
        assertEquals("4700..4999", p.leadIn().span())
    }

    @Test
    fun audioOlderThanTheHistoryIsGoneButTheRestIsRight() {
        val p = padding(history = 2f)
        p.hear(10000)
        // asks for 7000..8999 with padding; only 8000 on is still held
        assertEquals("8000..9249", p.padded(7300, 1700).span())
        assertEquals(10000L, p.heard)
    }

    @Test
    fun theRingWrapsWithoutScramblingOrder() {
        val p = padding(history = 2f)
        p.hear(9500, window = 37)
        val slice = p.padded(8800, 400)
        assertEquals("8500..9449", slice.span())
        for (i in 1 until slice.size) assertEquals(slice[i - 1] + 1f, slice[i], 0f)
    }
}
