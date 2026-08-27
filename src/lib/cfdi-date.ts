export function parseCfdiDateTime(value: string | null | undefined, fallback?: Date): Date {
  const normalized = String(value || '').trim()
  if (!normalized) {
    return fallback || new Date()
  }

  const localDateTimeMatch = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/
  )

  if (localDateTimeMatch) {
    const [, year, month, day, hour, minute, second = '00', millisecond = '0'] = localDateTimeMatch

    return new Date(Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      Number(millisecond.padEnd(3, '0'))
    ))
  }

  const parsed = new Date(normalized)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed
  }

  return fallback || new Date()
}
