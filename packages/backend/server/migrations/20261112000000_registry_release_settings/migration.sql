-- AlterTable
ALTER TABLE "registry_deploy_repos" ADD COLUMN "workflow_file" VARCHAR NOT NULL DEFAULT 'deploy-prod.yml',
ADD COLUMN "synced_run_id" BIGINT,
ADD COLUMN "synced_merged_at" TIMESTAMPTZ(3);
