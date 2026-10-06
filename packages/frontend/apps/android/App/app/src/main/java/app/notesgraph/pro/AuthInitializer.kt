package app.notesgraph.pro

import android.webkit.WebView
import app.notesgraph.pro.utils.getCurrentServerBaseUrl
import app.notesgraph.pro.utils.logger.FileTree
import com.getcapacitor.Bridge
import com.getcapacitor.WebViewListener
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch
import okhttp3.HttpUrl.Companion.toHttpUrl
import timber.log.Timber

object AuthInitializer {

    fun initialize(bridge: Bridge) {
        bridge.addWebViewListener(object : WebViewListener() {
            private var done = false

            override fun onPageLoaded(webView: WebView?) {
                if (done) return
                done = true
                // Capacitor is iterating its listener list right now; removing
                // in place skips or crashes the next listener, so remove after.
                val listener = this
                MainScope().launch { bridge.removeWebViewListener(listener) }
                MainScope().launch(Dispatchers.IO) {
                    try {
                        FileTree.get()?.checkAndUploadOldLogs(
                            bridge.getCurrentServerBaseUrl().toHttpUrl()
                        )
                    } catch (e: Exception) {
                        Timber.w(e, "[init] auth initializer fail.")
                    }
                }
            }
        })
    }

}
