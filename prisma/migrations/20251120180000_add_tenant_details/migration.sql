-- Add detailed tenant information fields to organizations table
ALTER TABLE "organizations" 
ADD COLUMN IF NOT EXISTS "address" TEXT,
ADD COLUMN IF NOT EXISTS "city" TEXT,
ADD COLUMN IF NOT EXISTS "state" TEXT,
ADD COLUMN IF NOT EXISTS "postal_code" TEXT,
ADD COLUMN IF NOT EXISTS "country" TEXT DEFAULT 'México',
ADD COLUMN IF NOT EXISTS "phone" TEXT,
ADD COLUMN IF NOT EXISTS "contact_email" TEXT,
ADD COLUMN IF NOT EXISTS "business_description" TEXT,
ADD COLUMN IF NOT EXISTS "website" TEXT,
ADD COLUMN IF NOT EXISTS "industry" TEXT,
ADD COLUMN IF NOT EXISTS "company_size" TEXT,
ADD COLUMN IF NOT EXISTS "founded_year" INTEGER,
ADD COLUMN IF NOT EXISTS "tax_id" TEXT,
ADD COLUMN IF NOT EXISTS "business_type" TEXT;