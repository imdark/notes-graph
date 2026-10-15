-- AlterTable
ALTER TABLE "registry_jobs" ADD COLUMN "cost_usd" DOUBLE PRECISION,
ADD COLUMN "tokens" INTEGER,
ADD COLUMN "max_cost_usd" DOUBLE PRECISION,
ADD COLUMN "access" VARCHAR;

-- CreateTable
CREATE TABLE "registry_agent_budgets" (
    "workspace_id" VARCHAR NOT NULL,
    "monthly_usd" DOUBLE PRECISION NOT NULL,
    "updated_by" VARCHAR,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "registry_agent_budgets_pkey" PRIMARY KEY ("workspace_id")
);

-- AddForeignKey
ALTER TABLE "registry_agent_budgets" ADD CONSTRAINT "registry_agent_budgets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
