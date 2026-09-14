package app.notesgraph.pro

import android.content.Intent
import android.content.res.ColorStateList
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.View
import android.webkit.WebSettings
import androidx.coordinatorlayout.widget.CoordinatorLayout
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.DrawableCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updateMargins
import androidx.lifecycle.lifecycleScope
import androidx.vectordrawable.graphics.drawable.VectorDrawableCompat
import app.notesgraph.pro.ai.AIActivity
import app.notesgraph.pro.plugin.AIButtonPlugin
import app.notesgraph.pro.plugin.NotesGraphThemePlugin
import app.notesgraph.pro.plugin.AuthPlugin
import app.notesgraph.pro.plugin.HashCashPlugin
import app.notesgraph.pro.plugin.NbStorePlugin
import app.notesgraph.pro.plugin.PreviewPlugin
import app.notesgraph.pro.service.GraphQLService
import app.notesgraph.pro.service.SSEService
import app.notesgraph.pro.service.WebService
import app.notesgraph.pro.utils.px2dp
import app.notesgraph.pro.utils.dp2px
import com.getcapacitor.BridgeActivity
import com.google.android.material.floatingactionbutton.FloatingActionButton
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import org.json.JSONObject
import javax.inject.Inject


@AndroidEntryPoint
class MainActivity : BridgeActivity(), AIButtonPlugin.Callback, NotesGraphThemePlugin.Callback,
    View.OnClickListener {

    @Inject
    lateinit var webService: WebService

    @Inject
    lateinit var sseService: SSEService

    @Inject
    lateinit var graphQLService: GraphQLService

    init {
        registerPlugins(
            listOf(
                NotesGraphThemePlugin::class.java,
                AIButtonPlugin::class.java,
                AuthPlugin::class.java,
                HashCashPlugin::class.java,
                NbStorePlugin::class.java,
                PreviewPlugin::class.java,
            )
        )
    }

    private val fab: FloatingActionButton by lazy {
        FloatingActionButton(this).apply {
            visibility = View.GONE
            layoutParams = CoordinatorLayout.LayoutParams(dp2px(52), dp2px(52)).apply {
                gravity = Gravity.END or Gravity.BOTTOM
                updateMargins(0, 0, dp2px(24), dp2px(86))
            }
            customSize = dp2px(52)
            setImageResource(R.drawable.ic_ai)
            setImageDrawable(
                VectorDrawableCompat.create(resources, R.drawable.ic_ai, theme)?.apply {
                    DrawableCompat.setTint(
                        this,
                        ContextCompat.getColor(context, R.color.notesgraph_primary)
                    )
                })
            setOnClickListener(this@MainActivity)
            val parent = bridge.webView.parent as CoordinatorLayout
            parent.addView(this)
        }
    }

    private var navHeight = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { v, insets ->
            navHeight = px2dp(insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom)
            ViewCompat.onApplyWindowInsets(v, insets)
        }
    }

    override fun load() {
        super.load()
        AuthInitializer.initialize(bridge)
        configureEditorWebView()
        handleShareIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleShareIntent(intent)
    }

    /**
     * "Share to NotesGraph": when another app shares text/a URL to us, hand it
     * to the web layer (window.notesgraphReceiveShare) which turns it into a
     * note. Guarded so a config change doesn't re-process the same share.
     */
    private fun handleShareIntent(intent: Intent?) {
        Log.i("NGShare", "handleShareIntent action=${intent?.action} type=${intent?.type}")
        if (intent?.action != Intent.ACTION_SEND) return
        if (intent.type?.startsWith("text/") != true) return
        if (intent.getBooleanExtra("ng_share_handled", false)) return
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim()
        if (text.isNullOrEmpty()) return
        // Google Feed / Chrome / news apps put the article title in
        // EXTRA_SUBJECT (some use EXTRA_TITLE) and only the URL in EXTRA_TEXT.
        val title = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.trim()
            ?.ifEmpty { null }
            ?: intent.getStringExtra(Intent.EXTRA_TITLE)?.trim()?.ifEmpty { null }
        intent.putExtra("ng_share_handled", true)
        Log.i("NGShare", "delivering shared text len=${text.length} title=${title != null}")
        deliverShareText(text, title, 0)
    }

    // The web handler is registered only after the bundle boots, so poll until
    // it exists (cold start via the share sheet) before delivering.
    private fun deliverShareText(text: String, title: String?, attempt: Int) {
        val payload = JSONObject().put("text", text)
            .apply { if (title != null) put("title", title) }
            .toString()
        val js =
            "(function(){if(window.notesgraphReceiveShare){" +
                "window.notesgraphReceiveShare($payload);return true;}return false;})()"
        bridge.webView.post {
            bridge.webView.evaluateJavascript(js) { result ->
                if (result != "true" && attempt < 60) {
                    if (attempt % 5 == 0) {
                        Log.i("NGShare", "poll attempt=$attempt result=$result")
                    }
                    bridge.webView.postDelayed(
                        { deliverShareText(text, title, attempt + 1) },
                        500
                    )
                } else {
                    Log.i("NGShare", "deliver done attempt=$attempt result=$result")
                }
            }
        }
    }

    private fun configureEditorWebView() {
        bridge.webView.apply {
            overScrollMode = View.OVER_SCROLL_NEVER
            isHorizontalScrollBarEnabled = false
            isVerticalScrollBarEnabled = false
            settings.apply {
                // Debug builds may point CAP_SERVER_URL at an HTTP dev server; release builds
                // should keep mixed content blocked.
                mixedContentMode = if (BuildConfig.DEBUG) {
                    WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                } else {
                    WebSettings.MIXED_CONTENT_NEVER_ALLOW
                }
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
            }
        }
    }

    override fun present() {
        lifecycleScope.launch {
            fab.show()
        }
    }

    override fun dismiss() {
        lifecycleScope.launch {
            fab.hide()
        }
    }

    override fun onThemeChanged(darkMode: Boolean) {
        lifecycleScope.launch {
            fab.backgroundTintList = ColorStateList.valueOf(
                ContextCompat.getColor(
                    this@MainActivity,
                    if (darkMode) {
                        R.color.layer_background_primary_dark
                    } else {
                        R.color.layer_background_primary
                    }
                )
            )
        }
    }

    override fun getSystemNavBarHeight(): Int {
        return navHeight
    }

    override fun onClick(v: View) {
        lifecycleScope.launch {
            webService.update(bridge)
            sseService.updateServer(bridge)
            graphQLService.updateServer(bridge)
            AIActivity.open(this@MainActivity)
        }
    }

}
