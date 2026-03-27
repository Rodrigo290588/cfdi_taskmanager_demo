-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('ADMIN', 'AUDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "CfdiType" AS ENUM ('INGRESO', 'EGRESO', 'TRASLADO', 'NOMINA', 'PAGO');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'PENDING');

-- CreateEnum
CREATE TYPE "SatStatus" AS ENUM ('VIGENTE', 'CANCELADO', 'NO_ENCONTRADO');

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "session_token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "email_verified" TIMESTAMP(3),
    "image" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verificationtokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "members" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'VIEWER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_entities" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "rfc" TEXT NOT NULL,
    "business_name" TEXT NOT NULL,
    "tax_regime" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "fiscal_entity_id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "cfdi_type" "CfdiType" NOT NULL,
    "series" TEXT,
    "folio" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "exchange_rate" DOUBLE PRECISION,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ACTIVE',
    "sat_status" "SatStatus" NOT NULL DEFAULT 'VIGENTE',
    "issuer_rfc" TEXT NOT NULL,
    "issuer_name" TEXT NOT NULL,
    "receiver_rfc" TEXT NOT NULL,
    "receiver_name" TEXT NOT NULL,
    "subtotal" DECIMAL(15,2) NOT NULL,
    "discount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(15,2) NOT NULL,
    "iva_trasladado" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "iva_retenido" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "isr_retenido" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "ieps_retenido" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "xml_content" TEXT NOT NULL,
    "pdf_url" TEXT,
    "issuance_date" TIMESTAMP(3) NOT NULL,
    "certification_date" TIMESTAMP(3) NOT NULL,
    "certification_pac" TEXT NOT NULL,
    "payment_method" TEXT NOT NULL,
    "payment_form" TEXT NOT NULL,
    "usage_cfdi" TEXT NOT NULL,
    "expedition_place" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "permissions" TEXT[] DEFAULT ARRAY['read']::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_provider_account_id_key" ON "accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_session_token_key" ON "sessions"("session_token");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "verificationtokens_token_key" ON "verificationtokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verificationtokens_identifier_token_key" ON "verificationtokens"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "members_user_id_organization_id_key" ON "members"("user_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_entities_rfc_key" ON "fiscal_entities"("rfc");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_uuid_key" ON "invoices"("uuid");

-- CreateIndex
CREATE INDEX "invoices_fiscal_entity_id_idx" ON "invoices"("fiscal_entity_id");

-- CreateIndex
CREATE INDEX "invoices_issuer_rfc_idx" ON "invoices"("issuer_rfc");

-- CreateIndex
CREATE INDEX "invoices_receiver_rfc_idx" ON "invoices"("receiver_rfc");

-- CreateIndex
CREATE INDEX "invoices_issuance_date_idx" ON "invoices"("issuance_date");

-- CreateIndex
CREATE INDEX "invoices_total_idx" ON "invoices"("total");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_key" ON "api_keys"("key");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_entities" ADD CONSTRAINT "fiscal_entities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_fiscal_entity_id_fkey" FOREIGN KEY ("fiscal_entity_id") REFERENCES "fiscal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
