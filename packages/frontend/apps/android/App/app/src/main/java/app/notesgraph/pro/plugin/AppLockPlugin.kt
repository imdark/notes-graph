package app.notesgraph.pro.plugin

import android.os.Build
import app.notesgraph.pro.AppLock
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/** The settings switch for [AppLock]. The lock itself lives in MainActivity. */
@CapacitorPlugin(name = "AppLock")
class AppLockPlugin : Plugin() {

    @PluginMethod
    fun getState(call: PluginCall) {
        call.resolve(state())
    }

    /**
     * Turning it on asks for an unlock first: that proves the user can get
     * back in before anything is locked behind it. Turning it off does not -
     * whoever can reach this switch is already past the lock.
     */
    @PluginMethod
    fun setEnabled(call: PluginCall) {
        val enabled = call.getBoolean("enabled") ?: return call.reject("enabled is required")
        if (!enabled) {
            AppLock.setEnabled(context, false)
            applyRecentsPrivacy(false)
            return call.resolve(state())
        }
        if (!AppLock.isAvailable(context)) return call.resolve(state())

        activity.runOnUiThread {
            AppLock.authenticate(activity) { ok ->
                if (ok) {
                    AppLock.setEnabled(context, true)
                    applyRecentsPrivacy(true)
                }
                call.resolve(state())
            }
        }
    }

    private fun state() = JSObject()
        .put("available", AppLock.isAvailable(context))
        .put("enabled", AppLock.isEnabled(context))

    private fun applyRecentsPrivacy(enabled: Boolean) {
        // Keep notes out of the recent-apps thumbnail while locked. Only an
        // API 33+ switch exists for this short of FLAG_SECURE, which would
        // also block the user's own screenshots.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.runOnUiThread { activity.setRecentsScreenshotEnabled(!enabled) }
        }
    }
}
