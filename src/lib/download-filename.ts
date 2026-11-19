const SAFE_FILENAME_REGEX = /[^A-Za-z0-9_-]/g

export function sanitizeDownloadFilename(
  unsafeName: string,
  fallback = 'download',
  ext?: string,
): string {
  const base = (unsafeName || '')
    .toString()
    .replace(SAFE_FILENAME_REGEX, '_')
    .slice(0, 120)
    .replace(/^_|_$/g, '')
  const clean = (base || fallback).replace(/\s+/g, '_')

  if (!ext) {
    return clean
  }

  const extension = ext.startsWith('.') ? ext : `.${ext}`
  return clean + extension
}
