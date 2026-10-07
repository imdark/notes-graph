-- CreateTable
CREATE TABLE "monitoring_agents" (
    "workspace_id" VARCHAR NOT NULL,
    "mode" VARCHAR NOT NULL DEFAULT 'training',
    "sensitivity" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "interval_minutes" INTEGER NOT NULL DEFAULT 60,
    "auto_triage" BOOLEAN NOT NULL DEFAULT false,
    "alerts" JSONB NOT NULL DEFAULT '{}',
    "updated_by" VARCHAR NOT NULL,
    "next_run_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_run_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "monitoring_agents_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "monitoring_baselines" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "device_key" VARCHAR NOT NULL,
    "metric" VARCHAR NOT NULL,
    "mean" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "variance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "samples" INTEGER NOT NULL DEFAULT 0,
    "last_value" DOUBLE PRECISION,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "monitoring_baselines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitoring_decisions" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "device_key" VARCHAR NOT NULL,
    "metric" VARCHAR NOT NULL,
    "kind" VARCHAR NOT NULL,
    "severity" VARCHAR NOT NULL,
    "value" DOUBLE PRECISION,
    "baseline" DOUBLE PRECISION,
    "score" DOUBLE PRECISION,
    "summary" TEXT NOT NULL,
    "action" VARCHAR NOT NULL,
    "verdict" VARCHAR,
    "triage_job_id" VARCHAR,
    "triage" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "monitoring_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "monitoring_agents_next_run_at_idx" ON "monitoring_agents"("next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "monitoring_baselines_workspace_id_device_key_metric_key" ON "monitoring_baselines"("workspace_id", "device_key", "metric");

-- CreateIndex
CREATE INDEX "monitoring_decisions_workspace_id_created_at_idx" ON "monitoring_decisions"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "monitoring_decisions_workspace_id_device_key_metric_created_at_idx" ON "monitoring_decisions"("workspace_id", "device_key", "metric", "created_at");

-- CreateIndex
CREATE INDEX "monitoring_decisions_triage_job_id_idx" ON "monitoring_decisions"("triage_job_id");

-- AddForeignKey
ALTER TABLE "monitoring_agents" ADD CONSTRAINT "monitoring_agents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitoring_baselines" ADD CONSTRAINT "monitoring_baselines_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitoring_decisions" ADD CONSTRAINT "monitoring_decisions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
