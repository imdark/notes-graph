-- AlterTable
ALTER TABLE "registry_job_questions" ADD COLUMN "attachments" VARCHAR[] DEFAULT ARRAY[]::VARCHAR[];

-- CreateTable
CREATE TABLE "registry_job_artifacts" (
    "id" VARCHAR NOT NULL,
    "job_id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "key" VARCHAR NOT NULL,
    "name" VARCHAR NOT NULL,
    "mime" VARCHAR NOT NULL,
    "size" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registry_job_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "registry_job_artifacts_workspace_id_key_key" ON "registry_job_artifacts"("workspace_id", "key");

-- CreateIndex
CREATE INDEX "registry_job_artifacts_job_id_created_at_idx" ON "registry_job_artifacts"("job_id", "created_at");

-- AddForeignKey
ALTER TABLE "registry_job_artifacts" ADD CONSTRAINT "registry_job_artifacts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "registry_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
