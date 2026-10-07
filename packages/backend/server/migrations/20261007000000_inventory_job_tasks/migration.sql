-- AlterTable
ALTER TABLE "inventory_jobs" ADD COLUMN "task_ids" VARCHAR[] DEFAULT ARRAY[]::VARCHAR[],
ADD COLUMN "started_task_ids" VARCHAR[] DEFAULT ARRAY[]::VARCHAR[];
