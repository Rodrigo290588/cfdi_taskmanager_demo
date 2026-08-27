CREATE INDEX IF NOT EXISTS "invoices_issuer_fiscal_entity_rfc_date_idx"
ON "invoices"("issuer_fiscal_entity_id", "issuer_rfc", "issuance_date");

CREATE INDEX IF NOT EXISTS "invoices_issuer_rfc_payment_status_date_idx"
ON "invoices"("issuer_rfc", "payment_method", "sat_status", "issuance_date");

CREATE INDEX IF NOT EXISTS "invoices_issuer_rfc_type_status_date_idx"
ON "invoices"("issuer_rfc", "cfdi_type", "sat_status", "issuance_date");

CREATE INDEX IF NOT EXISTS "invoices_receiver_rfc_type_status_date_idx"
ON "invoices"("receiver_rfc", "cfdi_type", "sat_status", "issuance_date");

CREATE INDEX IF NOT EXISTS "invoice_related_cfdis_related_uuid_idx"
ON "invoice_related_cfdis"("related_uuid");

-- Índices de sat_metadata requieren que la tabla exista. En entornos nuevos la tabla
-- sat_metadata fue agregada posteriormente (schema.prisma) pero el CREATE TABLE puede estar en
-- una migración más nueva. Condicionalmente los índices sólo si la relación existe.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'sat_metadata'
  ) THEN
    CREATE INDEX IF NOT EXISTS "sat_metadata_emisor_date_status_type_idx"
    ON "sat_metadata"("rfc_emisor", "fecha_emision", "estatus", "efecto_comprobante");

    CREATE INDEX IF NOT EXISTS "sat_metadata_receptor_date_status_type_idx"
    ON "sat_metadata"("rfc_receptor", "fecha_emision", "estatus", "efecto_comprobante");
  END IF;
END $$;
