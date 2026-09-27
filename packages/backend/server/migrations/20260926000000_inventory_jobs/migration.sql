-- CreateTable
CREATE TABLE "inventory_jobs" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "device_key" VARCHAR NOT NULL,
    "agent_id" VARCHAR NOT NULL,
    "agent_name" VARCHAR NOT NULL,
    "instructions" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "model" VARCHAR,
    "tools" JSONB NOT NULL DEFAULT '[]',
    "max_steps" INTEGER NOT NULL DEFAULT 8,
    "target_kind" VARCHAR,
    "doc_id" VARCHAR,
    "block_id" VARCHAR,
    "status" VARCHAR NOT NULL DEFAULT 'queued',
    "result" TEXT,
    "error" TEXT,
    "steps" INTEGER NOT NULL DEFAULT 0,
    "claimed_by" VARCHAR,
    "lease_expires_at" TIMESTAMPTZ(3),
    "created_by" VARCHAR,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_jobs_workspace_id_device_key_status_idx" ON "inventory_jobs"("workspace_id", "device_key", "status");

-- CreateIndex
CREATE INDEX "inventory_jobs_workspace_id_status_created_at_idx" ON "inventory_jobs"("workspace_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "inventory_jobs" ADD CONSTRAINT "inventory_jobs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
