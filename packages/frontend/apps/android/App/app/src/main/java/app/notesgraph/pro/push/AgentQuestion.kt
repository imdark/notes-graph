package app.notesgraph.pro.push

import android.os.Bundle
import org.json.JSONArray

/**
 * What an agent run is waiting on, as pushed by the server
 * (plugins/inventory/push.ts `questionPushData`). `text` and `detail` may be
 * clipped to fit a push; [AgentQuestionActivity] reads the whole question
 * back before anything is allowed from it.
 */
data class AgentQuestion(
    val server: String,
    val workspaceId: String,
    val jobId: String,
    val docId: String,
    val questionId: String,
    /** "question" wants text back; "permission" wants allow or deny. */
    val kind: String,
    val agentName: String,
    val text: String,
    val detail: String,
    val options: List<String>,
) {
    val isPermission get() = kind == "permission"

    fun toBundle() = Bundle().apply {
        putString("server", server)
        putString("workspaceId", workspaceId)
        putString("jobId", jobId)
        putString("docId", docId)
        putString("questionId", questionId)
        putString("kind", kind)
        putString("agentName", agentName)
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
                data["questionId"], data["kind"], data["agentName"], data["text"],
                data["detail"], options,
            )
        }

        fun fromBundle(bundle: Bundle?): AgentQuestion? = bundle?.let {
            build(
                it.getString("server"), it.getString("workspaceId"), it.getString("jobId"),
                it.getString("docId"), it.getString("questionId"), it.getString("kind"),
                it.getString("agentName"), it.getString("text"), it.getString("detail"),
                it.getStringArrayList("options") ?: emptyList(),
            )
        }

        private fun build(
            server: String?, workspaceId: String?, jobId: String?, docId: String?,
            questionId: String?, kind: String?, agentName: String?, text: String?,
            detail: String?, options: List<String>,
        ): AgentQuestion? {
            if (server.isNullOrEmpty() || workspaceId.isNullOrEmpty() ||
                jobId.isNullOrEmpty() || questionId.isNullOrEmpty()
            ) return null
            return AgentQuestion(
                server = server,
                workspaceId = workspaceId,
                jobId = jobId,
                docId = docId.orEmpty(),
                questionId = questionId,
                kind = if (kind == "permission") "permission" else "question",
                agentName = agentName?.takeIf { it.isNotEmpty() } ?: "Agent",
                text = text.orEmpty(),
                detail = detail.orEmpty(),
                options = options,
            )
        }
    }
}
