-- DropForeignKey
ALTER TABLE "company_access" DROP CONSTRAINT "company_access_company_id_fkey";

-- DropForeignKey
ALTER TABLE "company_access" DROP CONSTRAINT "company_access_member_id_fkey";

-- DropForeignKey
ALTER TABLE "company_access" DROP CONSTRAINT "company_access_organization_id_fkey";

-- AlterTable
ALTER TABLE "company_access" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "company_access" ADD CONSTRAINT "company_access_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_access" ADD CONSTRAINT "company_access_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_access" ADD CONSTRAINT "company_access_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "company_access_member_company_unique" RENAME TO "company_access_member_id_company_id_key";
