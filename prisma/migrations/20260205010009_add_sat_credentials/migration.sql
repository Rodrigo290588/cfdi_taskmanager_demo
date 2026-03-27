-- CreateTable
CREATE TABLE "sat_credentials" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "rfc" TEXT NOT NULL,
    "encrypted_private_key" TEXT NOT NULL,
    "encrypted_password" TEXT NOT NULL,
    "certificate" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sat_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sat_credentials_organization_id_rfc_key" ON "sat_credentials"("organization_id", "rfc");

-- AddForeignKey
ALTER TABLE "sat_credentials" ADD CONSTRAINT "sat_credentials_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
