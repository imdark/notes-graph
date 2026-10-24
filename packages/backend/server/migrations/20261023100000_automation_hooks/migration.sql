-- AlterTable
ALTER TABLE "automation_runs" ADD COLUMN     "hook" VARCHAR,
ADD COLUMN     "hook_job_id" VARCHAR;

-- CreateIndex
CREATE INDEX "automation_runs_hook_job_id_idx" ON "automation_runs"("hook_job_id");
