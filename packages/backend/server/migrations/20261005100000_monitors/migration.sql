-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'MonitorAlert';

-- CreateTable
CREATE TABLE "monitors" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "created_by" VARCHAR NOT NULL,
    "name" VARCHAR NOT NULL,
    "doc_id" VARCHAR NOT NULL,
    "block_id" VARCHAR NOT NULL,
    "kind" VARCHAR NOT NULL,
    "source" VARCHAR,
    "device_key" VARCHAR,
    "spec" JSONB NOT NULL DEFAULT '{}',
    "interval_minutes" INTEGER NOT NULL,
    "condition" JSONB NOT NULL DEFAULT '{"type":"change"}',
    "alerts" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_run_at" TIMESTAMPTZ(3),
    "last_value" TEXT,
    "last_error" TEXT,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "pending_job_id" VARCHAR,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "monitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_readings" (
    "id" VARCHAR NOT NULL,
    "monitor_id" VARCHAR NOT NULL,
    "value" TEXT,
    "error" TEXT,
    "changed" BOOLEAN NOT NULL DEFAULT false,
    "alerted" BOOLEAN NOT NULL DEFAULT false,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitor_readings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "monitors_enabled_next_run_at_idx" ON "monitors"("enabled", "next_run_at");

-- CreateIndex
CREATE INDEX "monitors_workspace_id_created_by_idx" ON "monitors"("workspace_id", "created_by");

-- CreateIndex
CREATE INDEX "monitors_pending_job_id_idx" ON "monitors"("pending_job_id");

-- CreateIndex
CREATE INDEX "monitor_readings_monitor_id_at_idx" ON "monitor_readings"("monitor_id", "at");

-- AddForeignKey
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_readings" ADD CONSTRAINT "monitor_readings_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
