package app.notesgraph.pro.utils.logger

import android.util.Log
import android.webkit.ConsoleMessage
import com.getcapacitor.Bridge
import com.getcapacitor.BridgeWebChromeClient
import timber.log.Timber

/**
 * Sends the web app's console output to Timber instead of Capacitor's own
 * logcat logger, so it shows up next to the native logs.
 */
class ConsoleTimberChromeClient(bridge: Bridge) : BridgeWebChromeClient(bridge) {

    override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
        val message = consoleMessage.message() ?: return true
        // Capacitor's own bridge-call tracing; the bare "undefined" is a
        // native call's empty result
        if (!isValidMsg(message) || message == "undefined") return true
        val priority = when (consoleMessage.messageLevel()) {
            ConsoleMessage.MessageLevel.ERROR -> Log.ERROR
            ConsoleMessage.MessageLevel.WARNING -> Log.WARN
            ConsoleMessage.MessageLevel.DEBUG, ConsoleMessage.MessageLevel.TIP -> Log.DEBUG
            else -> Log.INFO
        }
        val source = consoleMessage.sourceId()?.substringAfterLast('/')
        Timber.tag("Console").log(
            priority,
            if (source.isNullOrEmpty()) message
            else "$message ($source:${consoleMessage.lineNumber()})"
        )
        return true
    }
}
