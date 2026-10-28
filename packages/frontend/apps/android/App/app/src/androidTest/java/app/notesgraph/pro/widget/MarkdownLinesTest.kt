package app.notesgraph.pro.widget

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MarkdownLinesTest {

    private fun lines(markdown: String) = markdownLines(markdown).map { it.text.toString() }

    @Test
    fun journalScaffoldingIsLeftOut() {
        // A journal page as the server renders it: a section per project, each
        // with an empty task and an empty todos table, blank lines between blocks.
        val markdown = """

## Work

- [ ]

### todos:
|Status|Deadline|Scheduled|
|---|---|---|

## notes graph

- [ ] the phone widget:

    - [ ] it doesnt display the calander events

### todos:
|Status|Deadline|Scheduled|
|---|---|---|

## Inbox

- [ ]
""".trimIndent()
        assertEquals(
            // Indents are em spaces, which the launcher doesn't trim.
            listOf("notes graph", "☐ the phone widget:", "  ☐ it doesnt display the calander events"),
            lines(markdown),
        )
    }

    @Test
    fun headingsAreMarkedForAGap() {
        val result = markdownLines("# Title\n\ntext\n\n## Part\n\nmore")
        assertEquals(listOf(true, false, true, false), result.map { it.gap })
    }

    @Test
    fun tableWithRowsShowsItsCells() {
        val markdown = "|Status|Deadline|\n|---|---|\n|open|Friday|"
        assertEquals(listOf("Status · Deadline", "open · Friday"), lines(markdown))
    }

    @Test
    fun subheadingWithContentKeepsItsParent() {
        assertEquals(listOf("A", "B", "x"), lines("# A\n\n## B\n\nx\n\n# C"))
    }

    @Test
    fun codeIsKeptAsIs() {
        assertEquals(listOf("", "  - [ ]"), lines("```\n\n  - [ ] \n```"))
    }
}
