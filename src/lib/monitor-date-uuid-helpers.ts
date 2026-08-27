import { z } from 'zod'

export type DateFilterBound = 'start' | 'end'

// MON-010 · Validación calendario real NO regex loose.
// Evita fechas como 2025-13-45 (mes 13 inválido, día 45 inválido, febrero sin bisiesto día 29).
// Usa Zod .refine para garantizar round-trip: si new Date recrea otro y/m/d = input válido real.
export function parseDateFilterStrict(
  raw: string | null | undefined,
  bound: DateFilterBound,
): Date | undefined {
  if (!raw || typeof raw !== 'string') return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined
  const schema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato YYYY-MM-DD')
    .refine((candidate) => {
      const [y, m, d] = candidate.split('-').map(Number)
      if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false
      if (y < 1900 || y > 2200) return false
      if (m < 1 || m > 12) return false
      if (d < 1 || d > 31) return false
      const dt = new Date(Date.UTC(y, m - 1, d))
      if (Number.isNaN(dt.getTime())) return false
      return (
        dt.getUTCFullYear() === y &&
        dt.getUTCMonth() === m - 1 &&
        dt.getUTCDate() === d
      )
    }, 'Fecha calendario inválida (mes 1-12, día dentro del mes, incluyendo años bisiestos)')

  const parsed = schema.parse(raw)
  const [y, m, d] = parsed.split('-').map(Number)
  return bound === 'start'
    ? new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0))
    : new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999))
}

// MON-006 · UUID RFC 4122 versión 4 (variante RFC 4122, 89ab) case-insensitive.
// Source: OWASP Validation Regex Repository · UUID v4 canonical.
export const UUID_RFC4122_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const zUuidV4 = (label: string) =>
  z
    .string({ message: `${label} es requerido` })
    .trim()
    .regex(UUID_RFC4122_V4, {
      message: `${label} debe ser un UUID v4 válido (formato RFC 4122)`,
    })

export const ORG_ID_FORMAT = /^[A-Za-z0-9_-]{10,64}$/
export const zOrgIdSafe = () =>
  z
    .string()
    .trim()
    .regex(ORG_ID_FORMAT, {
      message: 'orgId no cumple el formato esperado (10-64 alfanuméricos _ -)',
    })
    .optional()
