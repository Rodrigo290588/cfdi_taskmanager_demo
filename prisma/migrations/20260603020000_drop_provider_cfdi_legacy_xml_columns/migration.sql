ALTER TABLE "provider_uploaded_cfdis"
DROP COLUMN IF EXISTS "xml_ciphertext",
DROP COLUMN IF EXISTS "xml_iv",
DROP COLUMN IF EXISTS "xml_auth_tag",
DROP COLUMN IF EXISTS "xml_encryption_alg",
DROP COLUMN IF EXISTS "xml_key_version";
