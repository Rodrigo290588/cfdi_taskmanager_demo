-- Create enum for company access role
DO $$ BEGIN
  CREATE TYPE "CompanyAccessRole" AS ENUM ('ADMIN', 'AUDITOR', 'VIEWER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create table company_access
CREATE TABLE IF NOT EXISTS "company_access" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "role" "CompanyAccessRole" NOT NULL DEFAULT 'VIEWER',
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Unique constraint per member/company
CREATE UNIQUE INDEX IF NOT EXISTS "company_access_member_company_unique" ON "company_access" ("member_id", "company_id");

-- Foreign keys
ALTER TABLE "company_access"
  ADD CONSTRAINT "company_access_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "company_access_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "company_access_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE;

-- Trigger to update updated_at on row changes
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updated_at" = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS company_access_set_updated_at ON "company_access";
CREATE TRIGGER company_access_set_updated_at
BEFORE UPDATE ON "company_access"
FOR EACH ROW
EXECUTE PROCEDURE update_updated_at_column();
