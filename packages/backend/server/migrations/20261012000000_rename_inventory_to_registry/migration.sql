ALTER TABLE "inventory_devices" RENAME TO "registry_devices";
ALTER TABLE "inventory_jobs" RENAME TO "registry_jobs";
ALTER TABLE "inventory_job_questions" RENAME TO "registry_job_questions";
ALTER INDEX "inventory_devices_workspace_id_agent_target_idx" RENAME TO "registry_devices_workspace_id_agent_target_idx";
ALTER INDEX "inventory_devices_workspace_id_kind_idx" RENAME TO "registry_devices_workspace_id_kind_idx";
ALTER INDEX "inventory_job_questions_job_id_created_at_idx" RENAME TO "registry_job_questions_job_id_created_at_idx";
ALTER INDEX "inventory_jobs_workspace_id_device_key_status_idx" RENAME TO "registry_jobs_workspace_id_device_key_status_idx";
ALTER INDEX "inventory_jobs_workspace_id_status_created_at_idx" RENAME TO "registry_jobs_workspace_id_status_created_at_idx";
ALTER INDEX "inventory_devices_workspace_id_key_key" RENAME TO "registry_devices_workspace_id_key_key";
ALTER INDEX "inventory_devices_pkey" RENAME TO "registry_devices_pkey";
ALTER INDEX "inventory_jobs_pkey" RENAME TO "registry_jobs_pkey";
ALTER INDEX "inventory_job_questions_pkey" RENAME TO "registry_job_questions_pkey";
ALTER TABLE "registry_devices" RENAME CONSTRAINT "inventory_devices_workspace_id_fkey" TO "registry_devices_workspace_id_fkey";
ALTER TABLE "registry_job_questions" RENAME CONSTRAINT "inventory_job_questions_job_id_fkey" TO "registry_job_questions_job_id_fkey";
ALTER TABLE "registry_jobs" RENAME CONSTRAINT "inventory_jobs_workspace_id_fkey" TO "registry_jobs_workspace_id_fkey";

-- Admin-set config rows are keyed by module name.
UPDATE "app_configs" SET "id" = replace("id", 'inventory.', 'registry.') WHERE "id" LIKE 'inventory.%';
