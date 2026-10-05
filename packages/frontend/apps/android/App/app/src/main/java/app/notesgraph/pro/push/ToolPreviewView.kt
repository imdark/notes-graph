package app.notesgraph.pro.push

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp

/** Unchanged lines kept around each change; longer runs fold away. */
private const val CONTEXT = 3

/** The input of a tool an agent wants permission for, laid out to read. */
@Composable
fun ToolPreviewView(preview: ToolPreview) {
    when (preview) {
        is ToolPreview.Edits -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            preview.edits.forEach { FileDiff(it) }
        }
        is ToolPreview.Input -> ToolInputView(preview)
    }
}

@Composable
private fun CodeBox(text: String, modifier: Modifier = Modifier) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = MaterialTheme.shapes.small,
        modifier = modifier.fillMaxWidth(),
    ) {
        Text(
            text,
            fontFamily = FontFamily.Monospace,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(10.dp),
        )
    }
}

@Composable
private fun ToolInputView(preview: ToolPreview.Input) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        preview.description?.let {
            Text(it, style = MaterialTheme.typography.bodyMedium)
        }
        preview.command?.let { command ->
            Surface(
                color = MaterialTheme.colorScheme.inverseSurface,
                shape = MaterialTheme.shapes.small,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    "$ $command",
                    color = MaterialTheme.colorScheme.inverseOnSurface,
                    fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(12.dp),
                )
            }
        }
        preview.fields.forEach { f ->
            if (f.block) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    FieldLabel(f.label)
                    CodeBox(f.value)
                }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FieldLabel(f.label)
                    Text(
                        f.value,
                        fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}

@Composable
private fun FieldLabel(label: String) {
    Text(
        label,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

private sealed interface Block {
    data class Lines(val lines: List<DiffLine>) : Block
    data class Fold(val lines: List<DiffLine>) : Block
}

/** Splits long runs of unchanged lines out so they can be folded. */
private fun foldUnchanged(lines: List<DiffLine>): List<Block> {
    val blocks = mutableListOf<Block>()
    var i = 0
    while (i < lines.size) {
        val same = lines[i].kind == DiffLine.Kind.SAME
        var j = i
        while (j < lines.size && (lines[j].kind == DiffLine.Kind.SAME) == same) j++
        val run = lines.subList(i, j)
        val keepHead = if (i == 0) 0 else CONTEXT
        val keepTail = if (j == lines.size) 0 else CONTEXT
        if (same && run.size > keepHead + keepTail + 1) {
            if (keepHead > 0) blocks.add(Block.Lines(run.take(keepHead)))
            blocks.add(Block.Fold(run.subList(keepHead, run.size - keepTail)))
            if (keepTail > 0) blocks.add(Block.Lines(run.takeLast(keepTail)))
        } else {
            blocks.add(Block.Lines(run))
        }
        i = j
    }
    return blocks
}

private data class DiffColors(
    val removedLine: Color,
    val addedLine: Color,
    val removedWord: Color,
    val addedWord: Color,
    val removedText: Color,
    val addedText: Color,
)

@Composable
private fun diffColors(): DiffColors =
    // Follow the screen's theme (the app's mode), not the system's.
    if (MaterialTheme.colorScheme.surface.luminance() < 0.5f) {
        DiffColors(
            removedLine = Color(0x33F85149), addedLine = Color(0x332EA043),
            removedWord = Color(0x80F85149), addedWord = Color(0x802EA043),
            removedText = Color(0xFFFF7B72), addedText = Color(0xFF56D364),
        )
    } else {
        DiffColors(
            removedLine = Color(0xFFFFEBE9), addedLine = Color(0xFFE6FFEC),
            removedWord = Color(0xFFFFC1BA), addedWord = Color(0xFFABF2BC),
            removedText = Color(0xFFCF222E), addedText = Color(0xFF1A7F37),
        )
    }

@Composable
private fun FileDiff(edit: FileEdit) {
    // A new file has nothing before it; show it as all additions.
    val newFile = edit.before == null
    val lines = remember(edit) { diffLines(edit.before ?: "", edit.after) }
    val blocks = remember(lines) { foldUnchanged(lines) }
    val added = lines.count { it.kind == DiffLine.Kind.ADDED }
    val removed = lines.count { it.kind == DiffLine.Kind.REMOVED }
    val colors = diffColors()

    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = MaterialTheme.shapes.small,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
            ) {
                Text(
                    edit.path.ifEmpty { "file" },
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Medium,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    buildAnnotatedString {
                        if (newFile) append("new file ")
                        withStyle(SpanStyle(color = colors.addedText)) { append("+$added") }
                        if (!newFile) {
                            append(" ")
                            withStyle(SpanStyle(color = colors.removedText)) { append("−$removed") }
                        }
                    },
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            Column(modifier = Modifier.background(MaterialTheme.colorScheme.surface)) {
                blocks.forEach { block ->
                    when (block) {
                        is Block.Lines -> block.lines.forEach { DiffLineRow(it, colors) }
                        is Block.Fold -> Fold(block.lines, colors)
                    }
                }
            }
        }
    }
}

@Composable
private fun Fold(lines: List<DiffLine>, colors: DiffColors) {
    var open by remember { mutableStateOf(false) }
    if (open) {
        lines.forEach { DiffLineRow(it, colors) }
    } else {
        Text(
            "⋯ ${lines.size} unchanged lines",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier
                .fillMaxWidth()
                .clickable { open = true }
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                .padding(horizontal = 10.dp, vertical = 6.dp),
        )
    }
}

@Composable
private fun DiffLineRow(line: DiffLine, colors: DiffColors) {
    val removed = line.kind == DiffLine.Kind.REMOVED
    val same = line.kind == DiffLine.Kind.SAME
    val marker = if (same) " " else if (removed) "−" else "+"
    val lineColor = if (same) Color.Transparent else if (removed) colors.removedLine else colors.addedLine
    val wordColor = if (removed) colors.removedWord else colors.addedWord
    val markerColor = if (same) Color.Unspecified else if (removed) colors.removedText else colors.addedText
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(lineColor)
            .padding(horizontal = 6.dp, vertical = 1.dp),
    ) {
        Text(
            marker,
            color = markerColor,
            fontFamily = FontFamily.Monospace,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.width(14.dp),
        )
        Text(
            spansText(line, wordColor),
            fontFamily = FontFamily.Monospace,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

private fun spansText(line: DiffLine, wordColor: Color): AnnotatedString = buildAnnotatedString {
    // Keep an empty line one line tall.
    if (line.spans.all { it.text.isEmpty() }) {
        append(" ")
        return@buildAnnotatedString
    }
    line.spans.forEach { span ->
        if (line.wordMarks && span.changed && span.text.isNotBlank()) {
            withStyle(SpanStyle(background = wordColor)) { append(span.text) }
        } else {
            append(span.text)
        }
    }
}
