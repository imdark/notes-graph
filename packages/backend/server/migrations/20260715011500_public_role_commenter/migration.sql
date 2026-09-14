-- Allow the 'commenter' public role: share links can grant read + comment.
-- Written drop-then-add so re-running the script is safe.
ALTER TABLE "doc_access_policies" DROP CONSTRAINT IF EXISTS "doc_access_policies_public_role_check";
ALTER TABLE "doc_access_policies" ADD CONSTRAINT "doc_access_policies_public_role_check"
  CHECK ("public_role" IS NULL OR "public_role" IN ('external', 'commenter'));
