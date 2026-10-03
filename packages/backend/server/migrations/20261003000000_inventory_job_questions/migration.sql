-- CreateTable
CREATE TABLE "inventory_job_questions" (
    "id" VARCHAR NOT NULL,
    "job_id" VARCHAR NOT NULL,
    "kind" VARCHAR NOT NULL DEFAULT 'question',
    "text" TEXT NOT NULL,
    "detail" TEXT,
    "answer" TEXT,
    "allowed" BOOLEAN,
    "answered_by" VARCHAR,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answered_at" TIMESTAMPTZ(3),

    CONSTRAINT "inventory_job_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_job_questions_job_id_created_at_idx" ON "inventory_job_questions"("job_id", "created_at");

-- AddForeignKey
ALTER TABLE "inventory_job_questions" ADD CONSTRAINT "inventory_job_questions_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "inventory_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
