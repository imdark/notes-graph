package app.notesgraph.pro

import android.content.Context
import android.os.SystemClock
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import timber.log.Timber

/**
 * Optional lock on opening the app: fingerprint, face, or the device's own
 * PIN/pattern/password - whatever the phone's screen lock is.
 *
 * It guards the UI, not the session. The auth token is not bound to the
 * unlock (that would stop background sync and every request while locked);
 * it stays in the Keystore-encrypted store either way (see AuthPlugin).
 *
 * Locks on a cold start, and on returning after more than [GRACE_MS] in the
 * background. The background clock is the whole process (ProcessLifecycleOwner),
 * not one activity, so moving between our own screens - or a rotation - never
 * counts as leaving.
 */
object AppLock {
    private const val GRACE_MS = 60_000L
    private const val PREFS = "app_lock"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_DARK = "dark"

    // BIOMETRIC_WEAK rather than STRONG: this gates a screen, it does not
    // unwrap a key, and WEAK | DEVICE_CREDENTIAL is the one combination
    // supported all the way down to our minSdk 23.
    private const val AUTHENTICATORS = BIOMETRIC_WEAK or DEVICE_CREDENTIAL

    @Volatile
    private var unlockedThisProcess = false

    @Volatile
    private var backgroundedAt: Long? = null

    /**
     * True while a prompt is up. The PIN/pattern screen is the system's own
     * activity, so showing it sends this app to the background - which must
     * not count as leaving, or every unlock would re-lock on return.
     */
    @Volatile
    var prompting = false
        private set

    fun install() {
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) {
                if (!prompting) backgroundedAt = SystemClock.elapsedRealtime()
            }
        })
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun isEnabled(context: Context) = prefs(context).getBoolean(KEY_ENABLED, false)

    fun setEnabled(context: Context, enabled: Boolean) {
        prefs(context).edit { putBoolean(KEY_ENABLED, enabled) }
    }

    /**
     * The app's own colour mode, which can differ from the system's. Kept so
     * the cover matches it on a cold start, before the web layer has said.
     */
    fun isDark(context: Context, systemDark: Boolean) =
        prefs(context).getBoolean(KEY_DARK, systemDark)

    fun setDark(context: Context, dark: Boolean) {
        prefs(context).edit { putBoolean(KEY_DARK, dark) }
    }

    /** Whether the phone has a screen lock (or biometric) we can prompt for. */
    fun isAvailable(context: Context) =
        BiometricManager.from(context).canAuthenticate(AUTHENTICATORS) ==
            BiometricManager.BIOMETRIC_SUCCESS

    /**
     * Enabled, and the phone can still prompt. If the user has since removed
     * their screen lock there is nothing to prompt with, so do not lock rather
     * than lock them out of their notes.
     */
    fun needsUnlock(context: Context): Boolean {
        if (!isEnabled(context) || !isAvailable(context)) return false
        if (!unlockedThisProcess) return true
        val since = backgroundedAt ?: return false
        return SystemClock.elapsedRealtime() - since >= GRACE_MS
    }

    fun authenticate(activity: FragmentActivity, onResult: (Boolean) -> Unit) {
        if (prompting) return
        prompting = true
        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(
                    result: BiometricPrompt.AuthenticationResult
                ) {
                    prompting = false
                    unlockedThisProcess = true
                    backgroundedAt = null
                    onResult(true)
                }

                // Cancelled, too many attempts, no hardware... Failed single
                // attempts (a smudged finger) go to onAuthenticationFailed and
                // keep the prompt up, so they need no handling here.
                override fun onAuthenticationError(code: Int, message: CharSequence) {
                    Timber.i("App lock prompt ended: $code $message")
                    prompting = false
                    onResult(false)
                }
            }
        )
        // No negative button: with DEVICE_CREDENTIAL allowed, the system
        // supplies "Use PIN" itself and rejects a custom one.
        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle(activity.getString(R.string.app_lock_prompt_title))
                .setSubtitle(activity.getString(R.string.app_lock_prompt_subtitle))
                .setAllowedAuthenticators(AUTHENTICATORS)
                .build()
        )
    }
}
