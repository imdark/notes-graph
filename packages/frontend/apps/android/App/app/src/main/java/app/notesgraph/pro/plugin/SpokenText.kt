package app.notesgraph.pro.plugin

/** Whisper's notes on what it heard besides words: "(static)", "[BLANK_AUDIO]", "♪". */
private val NON_SPEECH = Regex("""\([^)]*\)|\[[^\]]*]|\*[^*]*\*|[♪♫]""")
private val SPACES = Regex("""\s+""")

/**
 * The words in a recognizer's transcript, or null if there were none. Whisper
 * describes sounds it can't make words of in brackets; those aren't dictation.
 */
internal fun spokenText(transcript: String): String? =
    transcript.replace(NON_SPEECH, " ")
        .replace(SPACES, " ")
        .trim()
        .takeIf { text -> text.any { it.isLetterOrDigit() } }
