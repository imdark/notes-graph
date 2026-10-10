-- CreateTable
CREATE TABLE "monitoring_log_catalogs" (
    "workspace_id" VARCHAR NOT NULL,
    "device_key" VARCHAR NOT NULL,
    "patterns" JSONB NOT NULL DEFAULT '[]',
    "scans" INTEGER NOT NULL DEFAULT 0,
    "scanned_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "monitoring_log_catalogs_pkey" PRIMARY KEY ("workspace_id","device_key")
);

-- AddForeignKey
ALTER TABLE "monitoring_log_catalogs" ADD CONSTRAINT "monitoring_log_catalogs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
