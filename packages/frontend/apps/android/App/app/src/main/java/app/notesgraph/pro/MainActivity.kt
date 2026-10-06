package app.notesgraph.pro

import android.content.Intent
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.annotation.RequiresApi
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
import app.notesgraph.pro.plugin.AgentPushPlugin
import app.notesgraph.pro.plugin.AppLockPlugin
import app.notesgraph.pro.plugin.NotesGraphThemePlugin
import app.notesgraph.pro.plugin.AuthPlugin
import app.notesgraph.pro.plugin.HashCashPlugin
import app.notesgraph.pro.plugin.NbStorePlugin
import app.notesgraph.pro.plugin.PreviewPlugin
import app.notesgraph.pro.plugin.SpeechToTextPlugin
import app.notesgraph.pro.service.GraphQLService
import app.notesgraph.pro.service.SSEService
import app.notesgraph.pro.service.WebService
import app.notesgraph.pro.utils.px2dp
import app.notesgraph.pro.utils.dp2px
import com.getcapacitor.BridgeActivity
import com.getcapacitor.WebViewListener
import com.google.android.material.floatingactionbutton.FloatingActionButton
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import org.json.JSONObject
import timber.log.Timber
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
                AgentPushPlugin::class.java,
                AppLockPlugin::class.java,
                AuthPlugin::class.java,
                HashCashPlugin::class.java,
                NbStorePlugin::class.java,
                PreviewPlugin::class.java,
                SpeechToTextPlugin::class.java,
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            setRecentsScreenshotEnabled(!AppLock.isEnabled(this))
        }
        // While locked, back leaves the app rather than navigating the
        // WebView history behind the cover.
        onBackPressedDispatcher.addCallback(this, lockBackCallback)
    }

    // ------ app lock (see AppLock) ------

    private val lockBackCallback = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() {
            moveTaskToBack(true)
        }
    }

    /**
     * Prompt automatically once per lock, not on every resume: dismissing the
     * PIN screen resumes this activity, and re-prompting then would trap the
     * user in a loop. After that, the Unlock button asks again.
     */
    private var promptedThisLock = false

    private val lockLabel: TextView by lazy {
        TextView(this).apply {
            setText(R.string.app_lock_locked)
            textSize = 18f
            gravity = Gravity.CENTER
        }
    }

    private val lockCover: View by lazy {
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            // swallow touches so nothing reaches the notes underneath
            isClickable = true
            isFocusable = true
            addView(lockLabel)
            addView(Button(this@MainActivity).apply {
                setText(R.string.app_lock_unlock)
                setOnClickListener { promptUnlock() }
            }, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp2px(16) })
        }
    }

    /**
     * The app's colour mode, not the system's - they can differ. On a first
     * cold start nothing is saved yet, so this is re-applied when the web layer
     * reports its theme, which can arrive while the cover is already up.
     */
    private fun applyLockCoverColors() {
        val systemDark = (resources.configuration.uiMode and
            Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        val dark = AppLock.isDark(this, systemDark)
        lockCover.setBackgroundColor(
            ContextCompat.getColor(
                this,
                if (dark) R.color.layer_background_primary_dark
                else R.color.layer_background_primary
            )
        )
        lockLabel.setTextColor(if (dark) Color.WHITE else Color.BLACK)
    }

    private fun showLockCover() {
        applyLockCoverColors()
        if (lockCover.parent == null) {
            (window.decorView as ViewGroup).addView(
                lockCover,
                ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            )
        }
        lockCover.bringToFront()
        lockBackCallback.isEnabled = true
    }

    private fun hideLockCover() {
        (lockCover.parent as? ViewGroup)?.removeView(lockCover)
        lockBackCallback.isEnabled = false
    }

    private fun promptUnlock() {
        AppLock.authenticate(this) { ok ->
            if (ok) hideLockCover()
        }
    }

    override fun onResume() {
        super.onResume()
        if (!AppLock.needsUnlock(this)) {
            hideLockCover()
            return
        }
        showLockCover()
        if (!promptedThisLock && !AppLock.prompting) {
            promptedThisLock = true
            promptUnlock()
        }
    }

    override fun onStop() {
        super.onStop()
        // Cover on the way out, so the notes are not the first frame shown on
        // return before onResume decides whether to lock; a return within the
        // grace period lifts it again at once.
        if (AppLock.isEnabled(this) && !AppLock.prompting) {
            showLockCover()
            promptedThisLock = false
        }
    }

    override fun load() {
        super.load()
        AuthInitializer.initialize(bridge)
        configureEditorWebView()
        bridge.addWebViewListener(renderProcessGoneListener)
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

    /**
     * When the WebView's renderer dies (most often killed for memory while
     * typing in a big note), Capacitor reports it unhandled and Android then
     * kills the whole app. Handle it instead: drop the dead WebView and
     * recreate the activity, which reloads the notes. Edits are already saved
     * to local storage as they are typed, so at most the last keystrokes go.
     * A second death right after a recovery closes the activity rather than
     * looping.
     */
    private val renderProcessGoneListener = object : WebViewListener() {
        // only ever called on API 26+, where WebView reports renderer death
        @RequiresApi(Build.VERSION_CODES.O)
        override fun onRenderProcessGone(
            webView: WebView,
            detail: RenderProcessGoneDetail?
        ): Boolean {
            val crashed = detail?.didCrash()
            val priority = detail?.rendererPriorityAtExit()
            Timber.e("[webview] renderer gone (crashed=$crashed, priority=$priority)")
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.destroy()
            val now = SystemClock.elapsedRealtime()
            if (now - lastRendererRecovery < RENDERER_RECOVERY_WINDOW_MS) {
                finish()
            } else {
                lastRendererRecovery = now
                recreate()
            }
            return true
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
        AppLock.setDark(this, darkMode)
        lifecycleScope.launch {
            if (lockCover.parent != null) applyLockCoverColors()
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

    private companion object {
        const val RENDERER_RECOVERY_WINDOW_MS = 10_000L

        // Outlives recreate(), so a renderer that dies again at once is seen.
        var lastRendererRecovery = 0L
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
