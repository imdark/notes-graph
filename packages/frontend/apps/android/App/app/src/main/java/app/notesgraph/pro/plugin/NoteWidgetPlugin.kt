package app.notesgraph.pro.plugin

import app.notesgraph.pro.widget.NoteWidgetWorker
import app.notesgraph.pro.widget.NoteWidgets
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.Dispatchers

/**
 * The workspace the app has open, kept for the home-screen note widgets:
 * a new widget offers that workspace's notes. Widgets already placed keep
 * the workspace they were set up with.
 */
@CapacitorPlugin(name = "NoteWidget")
class NoteWidgetPlugin : Plugin() {

    /** `{ server: string | null, workspaceId: string | null }` */
    @PluginMethod
    fun setWorkspace(call: PluginCall) {
        val server = call.getString("server").orEmpty()
        val workspaceId = call.getString("workspaceId").orEmpty()
        launch(Dispatchers.IO) {
            NoteWidgets.setWorkspace(
                context,
                if (server.isEmpty() || workspaceId.isEmpty()) null
                else NoteWidgets.Workspace(server, workspaceId),
            )
            if (NoteWidgets.widgetIds(context).isNotEmpty()) NoteWidgetWorker.refresh(context)
            call.resolve(JSObject().put("ok", true))
        }
    }
}
