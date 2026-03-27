-- DDL SQL para la migración de Prisma (PostgreSQL) 
-- PASO 1: ALTERAR LA TABLA PRINCIPAL public.invoices 

-- 1.1. Renombrar campos existentes a inglés 
ALTER TABLE public.invoices RENAME COLUMN fiscal_entity_id TO issuer_fiscal_entity_id; 
ALTER TABLE public.invoices RENAME COLUMN iva_trasladado TO iva_transferred; 
ALTER TABLE public.invoices RENAME COLUMN iva_retenido TO iva_withheld; 
ALTER TABLE public.invoices RENAME COLUMN isr_retenido TO isr_withheld; 
ALTER TABLE public.invoices RENAME COLUMN ieps_retenido TO ieps_withheld; 
ALTER TABLE public.invoices RENAME COLUMN usage_cfdi TO cfdi_usage; 
ALTER TABLE public.invoices RENAME COLUMN expedition_place TO place_of_expedition; 

-- 1.2. Añadir campos requeridos/útiles por CFDI 4.0 
ALTER TABLE public.invoices 
    ADD COLUMN export_key TEXT DEFAULT '01' NOT NULL, 
    ADD COLUMN object_tax_comprobante TEXT NULL, 
    ADD COLUMN payment_conditions TEXT NULL; 

-- 1.3. Actualizar la clave foránea 
ALTER TABLE public.invoices 
    DROP CONSTRAINT invoices_fiscal_entity_id_fkey, 
    ADD CONSTRAINT invoices_issuer_fiscal_entity_id_fkey FOREIGN KEY (issuer_fiscal_entity_id) REFERENCES public.fiscal_entities(id) ON DELETE CASCADE ON UPDATE CASCADE; 

-- PASO 2: CREACIÓN DE TABLAS AUXILIARES 

-- 2.1. Tabla para Conceptos (public.invoice_concepts) 
CREATE TABLE public.invoice_concepts ( 
    id                      SERIAL PRIMARY KEY, 
    invoice_id              TEXT NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE ON UPDATE CASCADE, 
    product_service_key     TEXT NOT NULL, 
    identification_number   TEXT NULL, 
    unit_quantity           NUMERIC(18, 6) NOT NULL, 
    unit_key                TEXT NOT NULL, 
    unit_description        TEXT NULL, 
    description             TEXT NOT NULL, 
    unit_value              NUMERIC(18, 6) NOT NULL, 
    amount                  NUMERIC(18, 6) NOT NULL, 
    discount                NUMERIC(15, 2) DEFAULT 0 NOT NULL, 
    object_of_tax           TEXT NOT NULL, 
    transferred_taxes_json  JSONB NULL, 
    withheld_taxes_json     JSONB NULL, 
    created_at              TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at              TIMESTAMP(3) NOT NULL 
); 

-- 2.2. Tabla para CFDI Relacionados (public.invoice_related_cfdis) 
CREATE TABLE public.invoice_related_cfdis ( 
    id                      SERIAL PRIMARY KEY, 
    invoice_id              TEXT NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE ON UPDATE CASCADE, 
    relation_type           TEXT NOT NULL, 
    related_uuid            TEXT NOT NULL, 
    created_at              TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL 
); 

-- PASO 3: CREACIÓN DE ÍNDICES NUEVOS 

-- 3.1. Índice actualizado 
DROP INDEX public.invoices_fiscal_entity_id_idx; 
CREATE INDEX invoices_issuer_fiscal_entity_id_idx ON public.invoices USING btree (issuer_fiscal_entity_id); 

-- 3.2. Índices para tablas auxiliares 
CREATE INDEX invoice_concepts_invoice_id_idx ON public.invoice_concepts USING btree (invoice_id); 
CREATE INDEX invoice_related_cfdis_invoice_id_idx ON public.invoice_related_cfdis USING btree (invoice_id);
