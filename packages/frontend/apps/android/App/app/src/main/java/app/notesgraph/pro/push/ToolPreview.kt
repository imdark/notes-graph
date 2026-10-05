package app.notesgraph.pro.push

import org.json.JSONArray
import org.json.JSONObject

/**
 * Readable form of the tool input a permission question asks about - the
 * phone's copy of the web card's edit-diff.ts and tool-input.ts.
 *
 * The question's `detail` is the tool input as JSON. File edits (Edit /
 * MultiEdit / Write) become before/after lines with the changed words marked;
 * any other tool (Bash above all) is laid out as its description, the command
 * it wants to run and the rest of its input as labelled fields.
 */
sealed interface ToolPreview {
    data class Edits(val tool: String, val edits: List<FileEdit>) : ToolPreview
    data class Input(
        val tool: String,
        /** The tool's own one-line account of what it is doing, if it gave one. */
        val description: String?,
        /** A shell command to run (Bash and the like). */
        val command: String?,
        val fields: List<ToolField>,
    ) : ToolPreview

    companion object {
        /**
         * The preview for a permission question, or null when there is nothing
         * to lay out (no detail, or JSON clipped so it no longer parses) - the
         * caller then shows the raw detail.
         */
        fun parse(text: String, detail: String): ToolPreview? {
            if (detail.isBlank()) return null
            val input = runCatching { JSONObject(detail) }.getOrNull() ?: return null
            return parseEdits(text, input) ?: parseInput(text, input)
        }
    }
}

data class FileEdit(
    val path: String,
    /** null for a new file written from scratch. */
    val before: String?,
    val after: String,
)

/** One labelled input value. `block` values get their own box. */
data class ToolField(val label: String, val value: String, val block: Boolean)

/** A run of text inside one line; `changed` marks the words that differ. */
data class DiffSpan(val text: String, val changed: Boolean)

/** One line of the diff: removed, added or unchanged context. */
data class DiffLine(val kind: Kind, val spans: List<DiffSpan>) {
    enum class Kind { SAME, REMOVED, ADDED }

    /** A whole-line change only needs its line tinted, not every word marked. */
    val wordMarks get() = kind != Kind.SAME && spans.any { !it.changed }
}

private val TOOL_NAME = Regex("""Allow\s+(\S+?)\?""")

private fun toolName(text: String, fallback: String) =
    TOOL_NAME.find(text)?.groupValues?.get(1) ?: fallback

private fun JSONObject.str(key: String): String? =
    if (has(key) && !isNull(key)) (opt(key) as? String) else null

private fun parseEdits(text: String, input: JSONObject): ToolPreview.Edits? {
    val path = input.str("file_path") ?: input.str("notebook_path") ?: ""
    val tool = toolName(text, "Edit")

    // Edit: one replacement.
    val oldString = input.str("old_string")
    val newString = input.str("new_string")
    if (oldString != null && newString != null) {
        return ToolPreview.Edits(tool, listOf(FileEdit(path, oldString, newString)))
    }

    // MultiEdit: several replacements in one file.
    val edits = input.opt("edits") as? JSONArray
    if (edits != null) {
        val list = (0 until edits.length()).mapNotNull { i ->
            val e = edits.optJSONObject(i) ?: return@mapNotNull null
            val before = e.str("old_string")
            val after = e.str("new_string")
            if (before != null && after != null) FileEdit(path, before, after) else null
        }
        return if (list.isEmpty()) null else ToolPreview.Edits(tool, list)
    }

    // Write: a whole file.
    val content = input.str("content")
    if (content != null && path.isNotEmpty()) {
        return ToolPreview.Edits(tool, listOf(FileEdit(path, null, content)))
    }
    return null
}

// Longer one-line values read better in a box than squeezed beside a label.
private const val INLINE_MAX = 60

/** `run_in_background` / `runInBackground` -> "Run in background". */
private fun humanize(key: String): String {
    val words = key
        .replace(Regex("([a-z0-9])([A-Z])"), "$1 $2")
        .replace(Regex("[_-]+"), " ")
        .trim()
        .lowercase()
    return words.replaceFirstChar { it.uppercase() }
}

private fun field(key: String, raw: Any?): ToolField? {
    if (raw == null || raw == JSONObject.NULL || raw == "") return null
    return when (raw) {
        is Boolean -> ToolField(humanize(key), if (raw) "yes" else "no", false)
        is JSONObject -> ToolField(humanize(key), raw.toString(2).replace("\\/", "/"), true)
        is JSONArray -> ToolField(humanize(key), raw.toString(2).replace("\\/", "/"), true)
        else -> {
            val value = raw.toString()
            ToolField(humanize(key), value, value.contains('\n') || value.length > INLINE_MAX)
        }
    }
}

private fun parseInput(text: String, input: JSONObject): ToolPreview.Input {
    val description = input.str("description")?.trim()?.takeIf { it.isNotEmpty() }
    val command = input.str("command")
    val fields = input.keys().asSequence().mapNotNull { key ->
        when {
            key == "description" && description != null -> null
            key == "command" && command != null -> null
            else -> field(key, input.opt(key))
        }
    }.toList()
    return ToolPreview.Input(toolName(text, "tool"), description, command, fields)
}

// Past this many cells the LCS table costs more than a prompt is worth; such
// edits fall back to "everything before removed, everything after added".
private const val MAX_CELLS = 400_000L

private enum class Op { SAME, DEL, INS }

private data class Step<T>(val op: Op, val value: T)

/** Longest-common-subsequence edit script between two sequences. */
private fun <T> diffSeq(a: List<T>, b: List<T>): List<Step<T>> {
    // Trim the shared head and tail first: most edits touch a few lines of a
    // long block, and it keeps the table small.
    var start = 0
    while (start < a.size && start < b.size && a[start] == b[start]) start++
    var endA = a.size
    var endB = b.size
    while (endA > start && endB > start && a[endA - 1] == b[endB - 1]) {
        endA--
        endB--
    }

    val steps = ArrayList<Step<T>>()
    for (k in 0 until start) steps.add(Step(Op.SAME, a[k]))
    val midA = a.subList(start, endA)
    val midB = b.subList(start, endB)
    val n = midA.size
    val m = midB.size

    if ((n + 1).toLong() * (m + 1) > MAX_CELLS) {
        midA.forEach { steps.add(Step(Op.DEL, it)) }
        midB.forEach { steps.add(Step(Op.INS, it)) }
    } else {
        // lcs[i][j] = LCS length of midA[i..] and midB[j..].
        val lcs = Array(n + 1) { IntArray(m + 1) }
        for (i in n - 1 downTo 0) {
            for (j in m - 1 downTo 0) {
                lcs[i][j] = if (midA[i] == midB[j]) lcs[i + 1][j + 1] + 1
                else maxOf(lcs[i + 1][j], lcs[i][j + 1])
            }
        }
        var i = 0
        var j = 0
        while (i < n && j < m) {
            when {
                midA[i] == midB[j] -> {
                    steps.add(Step(Op.SAME, midA[i])); i++; j++
                }
                lcs[i + 1][j] >= lcs[i][j + 1] -> steps.add(Step(Op.DEL, midA[i++]))
                else -> steps.add(Step(Op.INS, midB[j++]))
            }
        }
        while (i < n) steps.add(Step(Op.DEL, midA[i++]))
        while (j < m) steps.add(Step(Op.INS, midB[j++]))
    }
    for (k in endA until a.size) steps.add(Step(Op.SAME, a[k]))
    return steps
}

/** Words and the whitespace/punctuation between them, so joins are exact. */
private val TOKEN = Regex("""\w+|\s+|[^\w\s]""")

private fun MutableList<DiffSpan>.push(text: String, changed: Boolean) {
    val last = lastOrNull()
    if (last != null && last.changed == changed) set(size - 1, last.copy(text = last.text + text))
    else add(DiffSpan(text, changed))
}

/** Marks the words that differ between a removed line and its replacement. */
private fun diffWords(before: String, after: String): Pair<List<DiffSpan>, List<DiffSpan>> {
    val left = mutableListOf<DiffSpan>()
    val right = mutableListOf<DiffSpan>()
    val steps = diffSeq(
        TOKEN.findAll(before).map { it.value }.toList(),
        TOKEN.findAll(after).map { it.value }.toList(),
    )
    for (step in steps) {
        when (step.op) {
            Op.SAME -> {
                left.push(step.value, false); right.push(step.value, false)
            }
            Op.DEL -> left.push(step.value, true)
            Op.INS -> right.push(step.value, true)
        }
    }
    return left to right
}

/**
 * Unified diff lines - a phone is too narrow for the web card's two columns.
 * A run of removed lines followed by added lines is listed removed-then-added,
 * pairs of them with the changed words marked.
 */
fun diffLines(before: String, after: String): List<DiffLine> {
    val lines = ArrayList<DiffLine>()
    var removed = mutableListOf<String>()
    var added = mutableListOf<String>()

    fun flush() {
        val paired = minOf(removed.size, added.size)
        val words = (0 until paired).map { diffWords(removed[it], added[it]) }
        removed.forEachIndexed { k, line ->
            lines.add(
                DiffLine(
                    DiffLine.Kind.REMOVED,
                    if (k < paired) words[k].first else listOf(DiffSpan(line, true)),
                )
            )
        }
        added.forEachIndexed { k, line ->
            lines.add(
                DiffLine(
                    DiffLine.Kind.ADDED,
                    if (k < paired) words[k].second else listOf(DiffSpan(line, true)),
                )
            )
        }
        removed = mutableListOf()
        added = mutableListOf()
    }

    for (step in diffSeq(before.split('\n'), after.split('\n'))) {
        when (step.op) {
            Op.DEL -> removed.add(step.value)
            Op.INS -> added.add(step.value)
            Op.SAME -> {
                flush()
                lines.add(DiffLine(DiffLine.Kind.SAME, listOf(DiffSpan(step.value, false))))
            }
        }
    }
    flush()
    return lines
}
