-- AlterTable
ALTER TABLE "registry_jobs" ADD COLUMN     "kind" VARCHAR NOT NULL DEFAULT 'agent',
ADD COLUMN     "payload" JSONB;

-- CreateTable
CREATE TABLE "automations" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "created_by" VARCHAR NOT NULL,
    "name" VARCHAR NOT NULL,
    "doc_id" VARCHAR,
    "block_id" VARCHAR,
    "runtime" VARCHAR NOT NULL DEFAULT 'node',
    "triggers" JSONB NOT NULL DEFAULT '[]',
    "secrets" VARCHAR[] DEFAULT ARRAY[]::VARCHAR[],
    "timeout_seconds" INTEGER NOT NULL DEFAULT 60,
    "max_retries" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "webhook_token_hash" VARCHAR,
    "next_run_at" TIMESTAMPTZ(3),
    "last_run_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_versions" (
    "id" VARCHAR NOT NULL,
    "automation_id" VARCHAR NOT NULL,
    "number" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "hash" VARCHAR NOT NULL,
    "created_by" VARCHAR NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_deployments" (
    "id" VARCHAR NOT NULL,
    "automation_id" VARCHAR NOT NULL,
    "target" VARCHAR NOT NULL,
    "version_id" VARCHAR NOT NULL,
    "deployed_by" VARCHAR NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "automation_deployments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" VARCHAR NOT NULL,
    "automation_id" VARCHAR NOT NULL,
    "version_id" VARCHAR NOT NULL,
    "target" VARCHAR NOT NULL,
    "trigger" JSONB NOT NULL,
    "input" JSONB,
    "status" VARCHAR NOT NULL DEFAULT 'queued',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "output" JSONB,
    "error" TEXT,
    "logs" TEXT NOT NULL DEFAULT '',
    "job_id" VARCHAR,
    "spawned_job_ids" VARCHAR[] DEFAULT ARRAY[]::VARCHAR[],
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "automations_webhook_token_hash_key" ON "automations"("webhook_token_hash");

-- CreateIndex
CREATE INDEX "automations_enabled_next_run_at_idx" ON "automations"("enabled", "next_run_at");

-- CreateIndex
CREATE INDEX "automations_workspace_id_idx" ON "automations"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_versions_automation_id_number_key" ON "automation_versions"("automation_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "automation_deployments_automation_id_target_key" ON "automation_deployments"("automation_id", "target");

-- CreateIndex
CREATE UNIQUE INDEX "automation_runs_job_id_key" ON "automation_runs"("job_id");

-- CreateIndex
CREATE INDEX "automation_runs_automation_id_created_at_idx" ON "automation_runs"("automation_id", "created_at");

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_versions" ADD CONSTRAINT "automation_versions_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_deployments" ADD CONSTRAINT "automation_deployments_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_deployments" ADD CONSTRAINT "automation_deployments_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "automation_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "automation_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
