-- CreateTable
CREATE TABLE "sat_invoices" (
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

    CONSTRAINT "sat_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sat_invoices_uuid_key" ON "sat_invoices"("uuid");

-- CreateIndex
CREATE INDEX "sat_invoices_fiscal_entity_id_idx" ON "sat_invoices"("fiscal_entity_id");

-- CreateIndex
CREATE INDEX "sat_invoices_issuer_rfc_idx" ON "sat_invoices"("issuer_rfc");

-- CreateIndex
CREATE INDEX "sat_invoices_receiver_rfc_idx" ON "sat_invoices"("receiver_rfc");

-- CreateIndex
CREATE INDEX "sat_invoices_issuance_date_idx" ON "sat_invoices"("issuance_date");

-- CreateIndex
CREATE INDEX "sat_invoices_total_idx" ON "sat_invoices"("total");

-- AddForeignKey
ALTER TABLE "sat_invoices" ADD CONSTRAINT "sat_invoices_fiscal_entity_id_fkey" FOREIGN KEY ("fiscal_entity_id") REFERENCES "fiscal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sat_invoices" ADD CONSTRAINT "sat_invoices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
