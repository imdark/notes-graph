-- CreateTable
CREATE TABLE "directory_accounts" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "connected_by_user_id" VARCHAR NOT NULL,
    "provider" VARCHAR NOT NULL DEFAULT 'google',
    "domain" VARCHAR NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "expires_at" TIMESTAMPTZ(3),
    "scope" TEXT,
    "status" VARCHAR NOT NULL DEFAULT 'active',
    "last_error" TEXT,
    "last_sync_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "directory_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "directory_sync_scopes" (
    "id" VARCHAR NOT NULL,
    "directory_account_id" VARCHAR NOT NULL,
    "project_id" VARCHAR NOT NULL,
    "scope_type" VARCHAR NOT NULL,
    "external_id" VARCHAR NOT NULL,
    "label" VARCHAR,
    "status" VARCHAR NOT NULL DEFAULT 'active',
    "last_error" TEXT,
    "last_sync_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "directory_sync_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "directory_synced_users" (
    "id" VARCHAR NOT NULL,
    "scope_id" VARCHAR NOT NULL,
    "external_user_id" VARCHAR NOT NULL,
    "email" VARCHAR NOT NULL,
    "workspace_user_id" VARCHAR,
    "status" VARCHAR NOT NULL DEFAULT 'active',
    "missed_sync_count" INTEGER NOT NULL DEFAULT 0,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "directory_synced_users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "directory_accounts_workspace_id_provider_key" ON "directory_accounts"("workspace_id", "provider");

-- CreateIndex
CREATE INDEX "directory_accounts_workspace_id_idx" ON "directory_accounts"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "directory_sync_scopes_directory_account_id_scope_type_ext_key" ON "directory_sync_scopes"("directory_account_id", "scope_type", "external_id");

-- CreateIndex
CREATE INDEX "directory_sync_scopes_directory_account_id_idx" ON "directory_sync_scopes"("directory_account_id");

-- CreateIndex
CREATE INDEX "directory_sync_scopes_project_id_idx" ON "directory_sync_scopes"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "directory_synced_users_scope_id_external_user_id_key" ON "directory_synced_users"("scope_id", "external_user_id");

-- CreateIndex
CREATE INDEX "directory_synced_users_scope_id_status_idx" ON "directory_synced_users"("scope_id", "status");

-- CreateIndex
CREATE INDEX "directory_synced_users_workspace_user_id_idx" ON "directory_synced_users"("workspace_user_id");

-- AddForeignKey
ALTER TABLE "directory_accounts" ADD CONSTRAINT "directory_accounts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directory_accounts" ADD CONSTRAINT "directory_accounts_connected_by_user_id_fkey" FOREIGN KEY ("connected_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directory_sync_scopes" ADD CONSTRAINT "directory_sync_scopes_directory_account_id_fkey" FOREIGN KEY ("directory_account_id") REFERENCES "directory_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directory_sync_scopes" ADD CONSTRAINT "directory_sync_scopes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directory_synced_users" ADD CONSTRAINT "directory_synced_users_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "directory_sync_scopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
