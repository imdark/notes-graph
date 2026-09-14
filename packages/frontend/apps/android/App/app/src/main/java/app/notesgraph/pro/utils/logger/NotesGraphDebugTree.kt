package app.notesgraph.pro.utils.logger

import timber.log.Timber

class NotesGraphDebugTree : Timber.DebugTree() {

    override fun createStackElementTag(element: StackTraceElement): String {
        return "NotesGraph:${super.createStackElementTag(element)}:${element.lineNumber}"
    }
}