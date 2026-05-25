-- CreateTable
CREATE TABLE "machine_clients" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "client_secret_hash" TEXT NOT NULL,
  "description" TEXT,
  "scopes" TEXT[] DEFAULT ARRAY['users:create']::TEXT[],
  "allowed_ips" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "expires_at" TIMESTAMP(3),
  "last_used_at" TIMESTAMP(3),
  "last_used_ip" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_user_id" TEXT,

  CONSTRAINT "machine_clients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "machine_clients_client_id_key" ON "machine_clients"("client_id");

-- CreateIndex
CREATE INDEX "machine_clients_organization_id_idx" ON "machine_clients"("organization_id");

-- CreateIndex
CREATE INDEX "machine_clients_is_active_idx" ON "machine_clients"("is_active");

-- CreateIndex
CREATE INDEX "machine_clients_expires_at_idx" ON "machine_clients"("expires_at");

-- AddForeignKey
ALTER TABLE "machine_clients"
ADD CONSTRAINT "machine_clients_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
