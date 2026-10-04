-- AlterTable
ALTER TABLE "inventory_job_questions" ADD COLUMN "options" TEXT[] DEFAULT ARRAY[]::TEXT[];
