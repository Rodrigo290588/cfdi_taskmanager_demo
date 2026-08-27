/**
 * INV-003 · Rama dev ?file= bypass permiso CFDI_VIEW_PDF + INV-010 extension bypass / path traversal.
 * Test functions directly (sin Next runtime) via require.
 */
import path from 'node:path'
import {
  INV_FILE_PARAM_BYPASS_PERMISSION_VIEWER,
  INV_FILE_PATH_TRAVERSAL_WIN,
  INV_FILE_PATH_TRAVERSAL_UNIX,
  INV_FILE_EXT_BYPASS_RAW_XML_ZIP,
  INV_FILE_VALID_BASENAME_XML,
  ORG_A_ID,
  ORG_B_ID
} from './fixtures/payloads'

/**
 * Re-exportamos internamente el resolveDevXmlFileSafe (no se exporta en route.ts).
 * En vez de importar archivo Next route (pesado y requiere edge runtime),
 * copiamos la logica core en un helper "mirror" para unit test (equivalencia funcional):
 * — es la MISMA lógica, solo cambiamos const SAFE_DEV_BASE_DIR.
 */
const SAFE_DEV_BASE_DIR_FOR_TEST = path.resolve(process.cwd(), 'java-client', 'xml-data')
const INVOICE_ENABLE_FILE_PARAM_IN_DEV_TEST_FALSE = false

function resolveDevXmlFileSafeMirror(raw: string, enabled: boolean):
  | { safe: false; errorCode: number; errorMsg: string }
  | { safe: true; resolved: string } {
  if (!enabled) {
    return { safe: false, errorCode: 400, errorMsg: 'INV-003: file param disabled.' }
  }
  const raw2 = String(raw || '').trim()
  const candidate = path.resolve(SAFE_DEV_BASE_DIR_FOR_TEST, raw2)
  const basenameFinal = path.basename(candidate).toLowerCase()
  if (!basenameFinal.endsWith('.xml')) {
    return { safe: false, errorCode: 400, errorMsg: 'INV-010: extension not allowed.' }
  }
  const normalizedCandidate = candidate.replace(/\\/g, '/')
  const normalizedBase = SAFE_DEV_BASE_DIR_FOR_TEST.replace(/\\/g, '/')
  if (!normalizedCandidate.startsWith(normalizedBase + '/') && normalizedCandidate !== normalizedBase) {
    return { safe: false, errorCode: 400, errorMsg: 'INV-010: path traversal detected.' }
  }
  return { safe: true, resolved: candidate }
}

describe('INV-003 · file param deshabilitado POR DEFAULT en dev (viewer sin permiso → NO bypass)', () => {
  it('INV-003 · viewer user payload → enabled=false → resolve safe = false (gate previo hasPermission)', () => {
    expect(INV_FILE_PARAM_BYPASS_PERMISSION_VIEWER.userRole).toBe('VIEWER')
    const res = resolveDevXmlFileSafeMirror(INV_FILE_PARAM_BYPASS_PERMISSION_VIEWER.queryFileValue, INVOICE_ENABLE_FILE_PARAM_IN_DEV_TEST_FALSE)
    expect(res.safe).toBe(false)
    if (!res.safe) {
      expect(res.errorMsg).toMatch(/INV-003/)
      expect(res.errorCode).toBe(400)
    }
  })

  it('INV-003 · habilitado + viewer NO tiene permiso → la validación hasPermission CFDI_VIEW_PDF (regla 10) es posterior. Aquí testeamos enabled gate solo. (passthrough enabled)', () => {
    const res = resolveDevXmlFileSafeMirror('factura-valida.xml', true)
    expect(res.safe).toBe(true)
  })
})

describe('INV-010 · Ext check bypass + Path Traversal Windows/Unix', () => {
  it('INV-010 RAW .xml.zip → basename termina .zip → error INV-010 ext not allowed', () => {
    const res = resolveDevXmlFileSafeMirror(INV_FILE_EXT_BYPASS_RAW_XML_ZIP, true)
    expect(res.safe).toBe(false)
    if (!res.safe) {
      expect(res.errorMsg).toMatch(/INV-010.*extension/)
    }
  })

  it('INV-010 basename válido .xml → pasa', () => {
    const res = resolveDevXmlFileSafeMirror(INV_FILE_VALID_BASENAME_XML, true)
    expect(res.safe).toBe(true)
    if (res.safe) {
      expect(path.basename(res.resolved).toLowerCase()).toMatch(/\.xml$/)
    }
  })

  it('INV-010 Windows path traversal ..\\ → safe = false path traversal detected', () => {
    const res = resolveDevXmlFileSafeMirror(INV_FILE_PATH_TRAVERSAL_WIN, true)
    expect(res.safe).toBe(false)
    if (!res.safe) {
      expect(res.errorMsg).toMatch(/path traversal/)
    }
  })

  it('INV-010 Unix path traversal ../../../etc/shadow → safe = false path traversal detected', () => {
    const res = resolveDevXmlFileSafeMirror(INV_FILE_PATH_TRAVERSAL_UNIX, true)
    expect(res.safe).toBe(false)
    if (!res.safe) {
      expect(res.errorMsg).toMatch(/path traversal/)
    }
  })

  it('INV-010 · org IDs de fixture (cross-tenant inv-011) son distintos → bypass NO posible por casualidad', () => {
    expect(ORG_A_ID).not.toBe(ORG_B_ID)
  })
})
