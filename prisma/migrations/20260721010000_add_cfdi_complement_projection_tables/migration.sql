CREATE TABLE IF NOT EXISTS "invoice_complement_index" (
  "id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "has_pagos" BOOLEAN NOT NULL DEFAULT false,
  "pagos_version" TEXT,
  "has_nomina" BOOLEAN NOT NULL DEFAULT false,
  "nomina_version" TEXT,
  "has_carta_porte" BOOLEAN NOT NULL DEFAULT false,
  "carta_porte_version" TEXT,
  "has_comercio_exterior" BOOLEAN NOT NULL DEFAULT false,
  "comercio_exterior_version" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "invoice_complement_index_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "invoice_complement_index_invoice_id_key"
ON "invoice_complement_index"("invoice_id");

CREATE INDEX IF NOT EXISTS "invoice_complement_index_has_pagos_idx"
ON "invoice_complement_index"("has_pagos");

CREATE INDEX IF NOT EXISTS "invoice_complement_index_has_nomina_idx"
ON "invoice_complement_index"("has_nomina");

CREATE INDEX IF NOT EXISTS "invoice_complement_index_has_carta_porte_idx"
ON "invoice_complement_index"("has_carta_porte");

CREATE INDEX IF NOT EXISTS "invoice_complement_index_has_comercio_exterior_idx"
ON "invoice_complement_index"("has_comercio_exterior");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'invoice_complement_index_invoice_id_fkey'
      AND table_name = 'invoice_complement_index'
  ) THEN
    ALTER TABLE "invoice_complement_index"
    ADD CONSTRAINT "invoice_complement_index_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "invoice_complement_attributes" (
  "id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "complement_type" TEXT NOT NULL,
  "attribute_key" TEXT NOT NULL,
  "value_text" TEXT,
  "value_number" DECIMAL(18, 6),
  "value_date" TIMESTAMP(3),
  "value_boolean" BOOLEAN,
  "value_search" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "invoice_complement_attributes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "invoice_complement_attributes_invoice_id_idx"
ON "invoice_complement_attributes"("invoice_id");

CREATE INDEX IF NOT EXISTS "invoice_complement_attributes_type_key_idx"
ON "invoice_complement_attributes"("complement_type", "attribute_key");

CREATE INDEX IF NOT EXISTS "invoice_complement_attributes_key_search_idx"
ON "invoice_complement_attributes"("attribute_key", "value_search");

CREATE INDEX IF NOT EXISTS "invoice_complement_attributes_key_number_idx"
ON "invoice_complement_attributes"("attribute_key", "value_number");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'invoice_complement_attributes_invoice_id_fkey'
      AND table_name = 'invoice_complement_attributes'
  ) THEN
    ALTER TABLE "invoice_complement_attributes"
    ADD CONSTRAINT "invoice_complement_attributes_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "provider_uploaded_cfdi_complement_index" (
  "id" TEXT NOT NULL,
  "provider_uploaded_cfdi_id" TEXT NOT NULL,
  "has_pagos" BOOLEAN NOT NULL DEFAULT false,
  "pagos_version" TEXT,
  "has_nomina" BOOLEAN NOT NULL DEFAULT false,
  "nomina_version" TEXT,
  "has_carta_porte" BOOLEAN NOT NULL DEFAULT false,
  "carta_porte_version" TEXT,
  "has_comercio_exterior" BOOLEAN NOT NULL DEFAULT false,
  "comercio_exterior_version" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "provider_uploaded_cfdi_complement_index_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "provider_uploaded_cfdi_complement_index_cfdi_id_key"
ON "provider_uploaded_cfdi_complement_index"("provider_uploaded_cfdi_id");

CREATE INDEX IF NOT EXISTS "provider_uploaded_cfdi_complement_index_has_pagos_idx"
ON "provider_uploaded_cfdi_complement_index"("has_pagos");

CREATE INDEX IF NOT EXISTS "provider_uploaded_cfdi_complement_index_has_nomina_idx"
ON "provider_uploaded_cfdi_complement_index"("has_nomina");

CREATE INDEX IF NOT EXISTS "provider_uploaded_cfdi_complement_index_has_carta_porte_idx"
ON "provider_uploaded_cfdi_complement_index"("has_carta_porte");

CREATE INDEX IF NOT EXISTS "provider_uploaded_cfdi_complement_idx_has_com_ext"
ON "provider_uploaded_cfdi_complement_index"("has_comercio_exterior");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'provider_uploaded_cfdi_complement_index_cfdi_id_fkey'
      AND table_name = 'provider_uploaded_cfdi_complement_index'
  ) THEN
    ALTER TABLE "provider_uploaded_cfdi_complement_index"
    ADD CONSTRAINT "provider_uploaded_cfdi_complement_index_cfdi_id_fkey"
    FOREIGN KEY ("provider_uploaded_cfdi_id") REFERENCES "provider_uploaded_cfdis"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "provider_uploaded_cfdi_complement_attributes" (
  "id" TEXT NOT NULL,
  "provider_uploaded_cfdi_id" TEXT NOT NULL,
  "complement_type" TEXT NOT NULL,
  "attribute_key" TEXT NOT NULL,
  "value_text" TEXT,
  "value_number" DECIMAL(18, 6),
  "value_date" TIMESTAMP(3),
  "value_boolean" BOOLEAN,
  "value_search" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "provider_uploaded_cfdi_complement_attributes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "provider_uploaded_cfdi_complement_attributes_cfdi_id_idx"
ON "provider_uploaded_cfdi_complement_attributes"("provider_uploaded_cfdi_id");

CREATE INDEX IF NOT EXISTS "provider_uploaded_cfdi_complement_attributes_type_key_idx"
ON "provider_uploaded_cfdi_complement_attributes"("complement_type", "attribute_key");

CREATE INDEX IF NOT EXISTS "provider_uploaded_cfdi_complement_attributes_key_search_idx"
ON "provider_uploaded_cfdi_complement_attributes"("attribute_key", "value_search");

CREATE INDEX IF NOT EXISTS "provider_uploaded_cfdi_complement_attributes_key_number_idx"
ON "provider_uploaded_cfdi_complement_attributes"("attribute_key", "value_number");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'provider_uploaded_cfdi_complement_attributes_cfdi_id_fkey'
      AND table_name = 'provider_uploaded_cfdi_complement_attributes'
  ) THEN
    ALTER TABLE "provider_uploaded_cfdi_complement_attributes"
    ADD CONSTRAINT "provider_uploaded_cfdi_complement_attributes_cfdi_id_fkey"
    FOREIGN KEY ("provider_uploaded_cfdi_id") REFERENCES "provider_uploaded_cfdis"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;
