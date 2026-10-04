-- CreateTable
CREATE TABLE "user_push_tokens" (
    "id" VARCHAR NOT NULL,
    "user_id" VARCHAR NOT NULL,
    "token" TEXT NOT NULL,
    "platform" VARCHAR NOT NULL DEFAULT 'android',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_push_tokens_token_key" ON "user_push_tokens"("token");

-- CreateIndex
CREATE INDEX "user_push_tokens_user_id_idx" ON "user_push_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "user_push_tokens" ADD CONSTRAINT "user_push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
