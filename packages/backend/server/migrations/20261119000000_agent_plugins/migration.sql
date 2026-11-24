-- CreateTable
CREATE TABLE "agent_plugins" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "plugin_id" VARCHAR NOT NULL,
    "token" VARCHAR NOT NULL,
    "version" VARCHAR NOT NULL,
    "manifest" JSON NOT NULL,
    "code" TEXT NOT NULL,
    "created_by" VARCHAR,
    "updated_by" VARCHAR,
    "agent" VARCHAR,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agent_plugins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_plugins_token_key" ON "agent_plugins"("token");

-- CreateIndex
CREATE UNIQUE INDEX "agent_plugins_workspace_id_plugin_id_key" ON "agent_plugins"("workspace_id", "plugin_id");

-- AddForeignKey
ALTER TABLE "agent_plugins" ADD CONSTRAINT "agent_plugins_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
