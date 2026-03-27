-- First, add the column as nullable without default
ALTER TABLE "users" ADD COLUMN "system_role" TEXT;

-- Create SystemRole enum if it doesn't exist
DO $$ BEGIN
  CREATE TYPE "SystemRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'COMPANY_ADMIN', 'USER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Update existing rows to have the default value
UPDATE "users" SET "system_role" = 'USER' WHERE "system_role" IS NULL;

-- Now alter the column to use the enum type and make it non-null
ALTER TABLE "users" ALTER COLUMN "system_role" TYPE "SystemRole" USING "system_role"::"SystemRole";
ALTER TABLE "users" ALTER COLUMN "system_role" SET NOT NULL;
ALTER TABLE "users" ALTER COLUMN "system_role" SET DEFAULT 'USER';