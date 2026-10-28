package app.notesgraph.pro.push

import android.os.Bundle
import org.json.JSONArray

/**
 * What an agent run is waiting on, as pushed by the server
 * (plugins/registry/push.ts `questionPushData`). `text` and `detail` may be
 * clipped to fit a push; [AgentQuestionActivity] reads the whole question
 * back before anything is allowed from it.
 */
data class AgentQuestion(
    val server: String,
    val workspaceId: String,
    val jobId: String,
    val docId: String,
    /** The block the run started from; empty when it has none. */
    val blockId: String,
    val questionId: String,
    /** "question" wants text back; "permission" wants allow or deny. */
    val kind: String,
    val agentName: String,
    /** What the run is on: its block's text, or the agent's name for it; may be empty. */
    val title: String,
    val text: String,
    val detail: String,
    val options: List<String>,
) {
    val isPermission get() = kind == "permission"

    /** Which task is asking: the run's title, else (an older server) the agent. */
    val heading get() = title.ifEmpty { agentName }

    fun toBundle() = Bundle().apply {
        putString("server", server)
        putString("workspaceId", workspaceId)
        putString("jobId", jobId)
        putString("docId", docId)
        putString("blockId", blockId)
        putString("questionId", questionId)
        putString("kind", kind)
        putString("agentName", agentName)
        putString("title", title)
        putString("text", text)
        putString("detail", detail)
        putStringArrayList("options", ArrayList(options))
    }

    companion object {
        fun fromPush(data: Map<String, String>): AgentQuestion? {
            val options = runCatching {
                val array = JSONArray(data["options"] ?: "[]")
                List(array.length()) { array.getString(it) }
            }.getOrDefault(emptyList())
            return build(
                data["server"], data["workspaceId"], data["jobId"], data["docId"],
                data["blockId"], data["questionId"], data["kind"], data["agentName"], data["title"],
                data["text"], data["detail"], options,
            )
        }

        fun fromBundle(bundle: Bundle?): AgentQuestion? = bundle?.let {
            build(
                it.getString("server"), it.getString("workspaceId"), it.getString("jobId"),
                it.getString("docId"), it.getString("blockId"), it.getString("questionId"), it.getString("kind"),
                it.getString("agentName"), it.getString("title"), it.getString("text"),
                it.getString("detail"),
                it.getStringArrayList("options") ?: emptyList(),
            )
        }

        private fun build(
            server: String?, workspaceId: String?, jobId: String?, docId: String?,
            blockId: String?, questionId: String?, kind: String?, agentName: String?, title: String?,
            text: String?, detail: String?, options: List<String>,
        ): AgentQuestion? {
            if (server.isNullOrEmpty() || workspaceId.isNullOrEmpty() ||
                jobId.isNullOrEmpty() || questionId.isNullOrEmpty()
            ) return null
            return AgentQuestion(
                server = server,
                workspaceId = workspaceId,
                jobId = jobId,
                docId = docId.orEmpty(),
                blockId = blockId.orEmpty(),
                questionId = questionId,
                kind = if (kind == "permission") "permission" else "question",
                agentName = agentName?.takeIf { it.isNotEmpty() } ?: "Agent",
                title = title.orEmpty().trim(),
                text = text.orEmpty(),
                detail = detail.orEmpty(),
                options = options,
            )
        }
    }
}
