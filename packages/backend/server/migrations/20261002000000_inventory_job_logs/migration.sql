-- AlterTable
ALTER TABLE "inventory_jobs" ADD COLUMN     "log" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "log_dropped" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tmux_session" VARCHAR;
