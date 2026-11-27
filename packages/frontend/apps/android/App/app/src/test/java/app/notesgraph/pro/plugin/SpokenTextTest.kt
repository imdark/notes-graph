package app.notesgraph.pro.plugin

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SpokenTextTest {
    @Test
    fun keepsTheWords() {
        assertEquals("Cancel that. Undo that last line.", spokenText(" Cancel that. Undo that last line. "))
    }

    @Test
    fun dropsWhatWhisperHeardBesidesWords() {
        // Transcripts Whisper gave for real captures.
        assertEquals("Undo the last line.", spokenText("Undo the last line. (heavy breathing)"))
        assertEquals("Undo their last line.", spokenText("Undo their last line. (static)"))
        assertEquals("I'll do that last line.", spokenText("I'll do that last line. (upbeat music)"))
        assertEquals("so it goes", spokenText("[BLANK_AUDIO] so ♪ it goes *coughs*"))
    }

    @Test
    fun nothingButSoundsIsNoText() {
        assertNull(spokenText("[BLANK_AUDIO]"))
        assertNull(spokenText(" (music) ♪ "))
        assertNull(spokenText("."))
        assertNull(spokenText(""))
    }
}
