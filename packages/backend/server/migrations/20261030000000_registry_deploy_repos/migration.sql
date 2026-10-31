-- CreateTable
CREATE TABLE "registry_deploy_repos" (
    "workspace_id" VARCHAR NOT NULL,
    "repo" VARCHAR NOT NULL,
    "base_branch" VARCHAR NOT NULL,
    "deploy_branch" VARCHAR NOT NULL,
    "updated_by" VARCHAR,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "registry_deploy_repos_pkey" PRIMARY KEY ("workspace_id","repo")
);

-- AddForeignKey
ALTER TABLE "registry_deploy_repos" ADD CONSTRAINT "registry_deploy_repos_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
