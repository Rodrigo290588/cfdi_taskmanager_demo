-- Add tenant ownership and onboarding state
ALTER TABLE "organizations" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "organizations" ADD COLUMN "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organizations" ADD COLUMN "setupRequirements" JSONB NOT NULL DEFAULT '{"minUsers": 2, "minCompanies": 1}';
ALTER TABLE "organizations" ADD COLUMN "operationalAccessEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Add unique constraint for owner per organization
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_ownerId_key" UNIQUE ("ownerId");

-- Add foreign key constraint for owner
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_ownerId_fkey" 
  FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE;

-- Add onboarding tracking fields to users
ALTER TABLE "users" ADD COLUMN "onboardingStep" TEXT DEFAULT 'initial';
ALTER TABLE "users" ADD COLUMN "onboardingData" JSONB DEFAULT '{}';

-- Add approval workflow fields to members
ALTER TABLE "members" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "members" ADD COLUMN "approvedBy" TEXT;
ALTER TABLE "members" ADD COLUMN "approvedAt" TIMESTAMP;
ALTER TABLE "members" ADD COLUMN "invitationToken" TEXT;
ALTER TABLE "members" ADD COLUMN "invitationExpiresAt" TIMESTAMP;

-- Create index for member status
CREATE INDEX "members_status_idx" ON "members"("status");
CREATE INDEX "members_invitationToken_idx" ON "members"("invitationToken");

-- Create index for organization onboarding
CREATE INDEX "organizations_onboardingCompleted_idx" ON "organizations"("onboardingCompleted");
CREATE INDEX "organizations_operationalAccessEnabled_idx" ON "organizations"("operationalAccessEnabled");