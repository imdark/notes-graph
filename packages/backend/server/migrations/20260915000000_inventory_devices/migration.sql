-- CreateTable
CREATE TABLE "inventory_devices" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "key" VARCHAR NOT NULL,
    "name" VARCHAR NOT NULL,
    "kind" VARCHAR NOT NULL DEFAULT 'machine',
    "host" VARCHAR NOT NULL DEFAULT '',
    "user" VARCHAR NOT NULL DEFAULT '',
    "port" INTEGER NOT NULL DEFAULT 22,
    "parent_key" VARCHAR,
    "path" TEXT,
    "recipe" VARCHAR NOT NULL DEFAULT 'generic',
    "repo" TEXT,
    "branch" VARCHAR NOT NULL DEFAULT 'main',
    "channel" VARCHAR NOT NULL DEFAULT 'stable',
    "pin" VARCHAR,
    "agent_target" BOOLEAN NOT NULL DEFAULT false,
    "labels" JSONB NOT NULL DEFAULT '{}',
    "state" VARCHAR NOT NULL DEFAULT 'unknown',
    "status_detail" TEXT,
    "version" VARCHAR,
    "checked_at" TIMESTAMPTZ(3),
    "checks" JSONB NOT NULL DEFAULT '[]',
    "registered_by" VARCHAR,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_devices_workspace_id_key_key" ON "inventory_devices"("workspace_id", "key");

-- CreateIndex
CREATE INDEX "inventory_devices_workspace_id_kind_idx" ON "inventory_devices"("workspace_id", "kind");

-- CreateIndex
CREATE INDEX "inventory_devices_workspace_id_agent_target_idx" ON "inventory_devices"("workspace_id", "agent_target");

-- AddForeignKey
ALTER TABLE "inventory_devices" ADD CONSTRAINT "inventory_devices_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
