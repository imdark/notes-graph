-- CreateTable
CREATE TABLE "registry_job_shares" (
    "token" VARCHAR NOT NULL,
    "job_id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "title" VARCHAR,
    "status" VARCHAR NOT NULL,
    "log" TEXT NOT NULL DEFAULT '',
    "result" TEXT,
    "error" TEXT,
    "questions" JSONB NOT NULL DEFAULT '[]',
    "created_by" VARCHAR,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "registry_job_shares_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE UNIQUE INDEX "registry_job_shares_job_id_key" ON "registry_job_shares"("job_id");

-- CreateIndex
CREATE INDEX "registry_job_shares_workspace_id_idx" ON "registry_job_shares"("workspace_id");

-- AddForeignKey
ALTER TABLE "registry_job_shares" ADD CONSTRAINT "registry_job_shares_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "registry_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
