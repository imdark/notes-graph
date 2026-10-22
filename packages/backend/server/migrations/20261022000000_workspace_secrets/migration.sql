-- CreateTable
CREATE TABLE "workspace_secrets" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "name" VARCHAR NOT NULL,
    "description" VARCHAR,
    "encrypted_value" TEXT NOT NULL,
    "created_by" VARCHAR,
    "updated_by" VARCHAR,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workspace_secrets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_secrets_workspace_id_name_key" ON "workspace_secrets"("workspace_id", "name");

-- AddForeignKey
ALTER TABLE "workspace_secrets" ADD CONSTRAINT "workspace_secrets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
