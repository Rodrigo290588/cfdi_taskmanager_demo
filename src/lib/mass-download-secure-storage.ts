import crypto from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  statfs,
  unlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import unzipper from 'unzipper'

const DESTINATION_ID_REGEX = /^[a-z][a-z0-9_-]{0,63}$/
const SAFE_RELATIVE_COMPONENT_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/
const SAFE_ARCHIVE_EXTENSION_SET = new Set(['.xml', '.txt'])
const ENCRYPTED_FILE_MAGIC = Buffer.from('CFDISTORE1', 'utf8')
const AES_GCM_IV_BYTES = 12

const DEFAULT_MAX_ZIP_BYTES = 200 * 1024 * 1024
const DEFAULT_MAX_ZIP_ENTRIES = 10_000
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024
const DEFAULT_MAX_COMPRESSION_RATIO = 100
const DEFAULT_RETENTION_DAYS = 90

export class SecureStorageError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = 'SecureStorageError'
  }
}

interface StorageDestination {
  readonly id: string
  readonly label: string
  readonly rootPath: string
  readonly quotaBytes: number
  readonly retentionDays: number
}

export interface RoutineStorageOptions {
  readonly enabled: boolean
  readonly extractionDestinationId?: string
  readonly zipBackupDestinationId?: string
  readonly extractionRelativePath?: string
  readonly zipBackupRelativePath?: string
}

export interface StoredRoutineArtifacts {
  readonly zipBackupStored: boolean
  readonly extractedFilesStored: number
  readonly extractionDestinationId?: string
  readonly zipBackupDestinationId?: string
}

interface ZipEntryDescriptor {
  readonly entry: {
    readonly path: string
    readonly type?: string
    readonly compressedSize?: number
    readonly uncompressedSize?: number
    readonly externalFileAttributes?: number
    buffer(): Promise<Buffer>
  }
  readonly extension: string
}

export function parseRoutineStorageOptions(value: unknown): RoutineStorageOptions {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return { enabled: false }
  }
  const raw = value as Record<string, unknown>
  return {
    enabled: raw.enabled === true,
    extractionDestinationId: readDestinationId(raw.extractionDestinationId),
    zipBackupDestinationId: readDestinationId(raw.zipBackupDestinationId),
    extractionRelativePath: readRelativePath(raw.extractionRelativePath),
    zipBackupRelativePath: readRelativePath(raw.zipBackupRelativePath),
  }
}

export async function validateRoutineStorageOptions(value: unknown): Promise<void> {
  const options = parseRoutineStorageOptions(value)
  if (!options.enabled) return

  const destinationIds = new Set(
    [options.extractionDestinationId, options.zipBackupDestinationId].filter(
      (destinationId): destinationId is string => Boolean(destinationId),
    ),
  )
  if (destinationIds.size === 0) {
    throw new SecureStorageError('Selecciona al menos un destino de almacenamiento', 'DESTINATION_REQUIRED')
  }

  for (const destinationId of destinationIds) {
    const destination = getConfiguredDestination(destinationId)
    await getVerifiedDestinationRoot(destination)
  }
}

export function listConfiguredStorageDestinations(): ReadonlyArray<{
  readonly id: string
  readonly label: string
  readonly retentionDays: number
}> {
  return getConfiguredDestinations().map(({ id, label, retentionDays }) => ({ id, label, retentionDays }))
}

export async function validateMassDownloadZip(zipBuffer: Buffer): Promise<ReadonlyArray<ZipEntryDescriptor>> {
  const limits = getStorageLimits()
  if (zipBuffer.length > limits.maxZipBytes) {
    throw new SecureStorageError('El ZIP excede el tamaño máximo permitido', 'ZIP_SIZE_LIMIT')
  }

  let directory: Awaited<ReturnType<typeof unzipper.Open.buffer>>
  try {
    directory = await unzipper.Open.buffer(zipBuffer)
  } catch {
    throw new SecureStorageError('El paquete ZIP no es válido', 'ZIP_INVALID')
  }

  if (directory.files.length > limits.maxZipEntries) {
    throw new SecureStorageError('El ZIP contiene demasiadas entradas', 'ZIP_ENTRY_LIMIT')
  }

  let totalUncompressedBytes = 0
  const validFiles: ZipEntryDescriptor[] = []
  for (const entry of directory.files) {
    const result = validateZipEntry(entry, limits.maxCompressionRatio)
    totalUncompressedBytes += result.uncompressedSize
    if (totalUncompressedBytes > limits.maxUncompressedBytes) {
      throw new SecureStorageError('El ZIP excede el tamaño descomprimido permitido', 'ZIP_UNCOMPRESSED_LIMIT')
    }
    if (result.descriptor) validFiles.push(result.descriptor)
  }
  return validFiles
}

function validateZipEntry(
  entry: ZipEntryDescriptor['entry'],
  maxCompressionRatio: number,
): { readonly descriptor: ZipEntryDescriptor | null; readonly uncompressedSize: number } {
  const isDirectory = entry.type === 'Directory'
  const entryPath = isDirectory ? trimTrailingSlashes(entry.path) : entry.path
  if (!entryPath && isDirectory) return { descriptor: null, uncompressedSize: 0 }

  const normalizedPath = validateArchiveEntryPath(entryPath)
  const compressedSize = normalizeZipSize(entry.compressedSize)
  const uncompressedSize = normalizeZipSize(entry.uncompressedSize)
  if (isSymlinkArchiveEntry(entry.externalFileAttributes)) {
    throw new SecureStorageError('El ZIP contiene enlaces no permitidos', 'ZIP_LINK_ENTRY')
  }
  const compressionRatio = compressedSize === 0 ? uncompressedSize : uncompressedSize / compressedSize
  if (compressionRatio > maxCompressionRatio) {
    throw new SecureStorageError('El ZIP excede el ratio de expansión permitido', 'ZIP_COMPRESSION_RATIO')
  }
  if (isDirectory) return { descriptor: null, uncompressedSize }

  return {
    descriptor: { entry, extension: path.posix.extname(normalizedPath).toLowerCase() },
    uncompressedSize,
  }
}

function trimTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end -= 1
  return value.slice(0, end)
}

export async function storeRoutineDownloadArtifacts(input: {
  readonly zipBuffer: Buffer
  readonly packageId: string
  readonly storageOptions: unknown
}): Promise<StoredRoutineArtifacts> {
  const options = parseRoutineStorageOptions(input.storageOptions)
  if (!options.enabled) {
    return { zipBackupStored: false, extractedFilesStored: 0 }
  }

  validateMassDownloadPackageId(input.packageId)
  const validEntries = await validateMassDownloadZip(input.zipBuffer)
  await validateRoutineStorageOptions(input.storageOptions)

  let zipBackupStored = false
  let extractedFilesStored = 0
  if (options.zipBackupDestinationId) {
    const destination = getConfiguredDestination(options.zipBackupDestinationId)
    const targetDirectory = await getVerifiedDestinationDirectory(destination, options.zipBackupRelativePath)
    await writeArtifact(targetDirectory, '.zip', input.zipBuffer, destination)
    zipBackupStored = true
  }
  if (options.extractionDestinationId) {
    const destination = getConfiguredDestination(options.extractionDestinationId)
    const targetDirectory = await getVerifiedDestinationDirectory(destination, options.extractionRelativePath)
    for (const descriptor of validEntries) {
      if (!SAFE_ARCHIVE_EXTENSION_SET.has(descriptor.extension)) continue
      const content = await descriptor.entry.buffer()
      await writeArtifact(targetDirectory, descriptor.extension, content, destination)
      extractedFilesStored += 1
    }
  }

  return {
    zipBackupStored,
    extractedFilesStored,
    extractionDestinationId: options.extractionDestinationId,
    zipBackupDestinationId: options.zipBackupDestinationId,
  }
}

async function writeArtifact(
  directory: string,
  extension: string,
  content: Buffer,
  destination: StorageDestination,
): Promise<void> {
  await enforceCapacity(destination, directory, content.length)
  await applyRetention(directory, destination.retentionDays)

  const isEncrypted = getStorageEncryptionMode() === 'encrypted'
  const storedContent = isEncrypted ? encryptContent(content) : content
  const fileSuffix = isEncrypted ? `${extension}.enc` : extension
  const fileName = `${new Date().toISOString().slice(0, 10)}_${crypto.randomUUID()}${fileSuffix}`
  const finalPath = path.join(directory, fileName)
  const temporaryPath = path.join(directory, `.${crypto.randomUUID()}.tmp`)
  assertContainedPath(directory, finalPath)

  try {
    await writeFile(temporaryPath, storedContent, { mode: 0o600, flag: 'wx' })
    await chmod(temporaryPath, 0o600)
    await rename(temporaryPath, finalPath)
    await chmod(finalPath, 0o600)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

function getStorageEncryptionMode(): 'encrypted' | 'plaintext' {
  const mode = process.env.MASS_DOWNLOAD_STORAGE_ENCRYPTION_MODE?.trim().toLowerCase()
  if (!mode || mode === 'encrypted') return 'encrypted'
  if (mode === 'plaintext') return 'plaintext'
  throw new SecureStorageError(
    'El modo de cifrado del almacenamiento no es válido',
    'ENCRYPTION_MODE_INVALID',
  )
}

function encryptContent(content: Buffer): Buffer {
  const key = getStorageEncryptionKey()
  const iv = crypto.randomBytes(AES_GCM_IV_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(content), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([ENCRYPTED_FILE_MAGIC, iv, authTag, encrypted])
}

function getStorageEncryptionKey(): Buffer {
  const rawKey = process.env.MASS_DOWNLOAD_STORAGE_ENCRYPTION_KEY
  if (!rawKey || !/^[a-f0-9]{64}$/i.test(rawKey)) {
    throw new SecureStorageError('La clave de cifrado del almacenamiento no está configurada', 'ENCRYPTION_KEY_INVALID')
  }
  return Buffer.from(rawKey, 'hex')
}

function getConfiguredDestinations(): StorageDestination[] {
  const rawConfig = process.env.MASS_DOWNLOAD_STORAGE_DESTINATIONS_JSON
  if (!rawConfig) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(rawConfig)
  } catch {
    throw new SecureStorageError('La configuración de destinos de almacenamiento es inválida', 'DESTINATION_CONFIG_INVALID')
  }
  if (!Array.isArray(parsed)) {
    throw new SecureStorageError('La configuración de destinos de almacenamiento es inválida', 'DESTINATION_CONFIG_INVALID')
  }

  const destinations = parsed.map(parseDestination)
  const ids = new Set(destinations.map((destination) => destination.id))
  if (ids.size !== destinations.length) {
    throw new SecureStorageError('Los destinos de almacenamiento están duplicados', 'DESTINATION_DUPLICATE')
  }
  return destinations
}

function parseDestination(value: unknown): StorageDestination {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SecureStorageError('La configuración de un destino es inválida', 'DESTINATION_CONFIG_INVALID')
  }
  const raw = value as Record<string, unknown>
  const id = typeof raw.id === 'string' ? raw.id : ''
  const label = typeof raw.label === 'string' ? raw.label.trim() : ''
  const rootPath = typeof raw.rootPath === 'string' ? raw.rootPath.trim() : ''
  const quotaBytes = typeof raw.quotaBytes === 'number' ? raw.quotaBytes : 0
  const retentionDays = typeof raw.retentionDays === 'number' ? raw.retentionDays : DEFAULT_RETENTION_DAYS

  if (!DESTINATION_ID_REGEX.test(id) || !label || label.length > 120 || !rootPath || !path.isAbsolute(rootPath) || isNetworkPath(rootPath)) {
    throw new SecureStorageError('La configuración de un destino es inválida', 'DESTINATION_CONFIG_INVALID')
  }
  if (!Number.isSafeInteger(quotaBytes) || quotaBytes <= 0 || !Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new SecureStorageError('Los límites del destino son inválidos', 'DESTINATION_CONFIG_INVALID')
  }
  return { id, label, rootPath, quotaBytes, retentionDays }
}

function getConfiguredDestination(destinationId: string): StorageDestination {
  const destination = getConfiguredDestinations().find(({ id }) => id === destinationId)
  if (!destination) {
    throw new SecureStorageError('El destino de almacenamiento seleccionado no está disponible', 'DESTINATION_NOT_FOUND')
  }
  return destination
}

async function getVerifiedDestinationRoot(destination: StorageDestination): Promise<string> {
  const configuredRoot = path.resolve(destination.rootPath)
  const stats = await lstat(configuredRoot).catch(() => {
    throw new SecureStorageError('El destino de almacenamiento no está disponible', 'DESTINATION_UNAVAILABLE')
  })
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new SecureStorageError('El destino de almacenamiento no cumple los requisitos de seguridad', 'DESTINATION_UNSAFE')
  }
  const resolvedRoot = await realpath(configuredRoot)
  const publicDirectory = path.resolve(process.cwd(), 'public')
  assertNotPublicDirectory(publicDirectory, resolvedRoot)
  return resolvedRoot
}

async function getVerifiedDestinationDirectory(destination: StorageDestination, relativePath: string | undefined): Promise<string> {
  const root = await getVerifiedDestinationRoot(destination)
  const segments = splitRelativePath(relativePath)
  let currentDirectory = root
  for (const segment of segments) {
    const candidate = path.join(currentDirectory, segment)
    assertContainedPath(root, candidate)
    try {
      const stats = await lstat(candidate)
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new SecureStorageError('El destino de almacenamiento no cumple los requisitos de seguridad', 'DESTINATION_UNSAFE')
      }
    } catch (error) {
      if (error instanceof SecureStorageError) throw error
      await mkdir(candidate, { mode: 0o700 })
    }
    currentDirectory = await realpath(candidate)
    assertContainedPath(root, currentDirectory)
  }
  return currentDirectory
}

async function enforceCapacity(destination: StorageDestination, directory: string, incomingSize: number): Promise<void> {
  const filesystem = await statfs(directory)
  const availableBytes = Number(filesystem.bavail) * Number(filesystem.bsize)
  if (availableBytes < incomingSize * 2) {
    throw new SecureStorageError('El destino no tiene espacio disponible', 'DESTINATION_SPACE_LOW')
  }

  const usedBytes = await calculateDirectoryUsage(directory, destination.quotaBytes)
  if (usedBytes + incomingSize > destination.quotaBytes) {
    throw new SecureStorageError('El destino alcanzó su cuota de almacenamiento', 'DESTINATION_QUOTA_EXCEEDED')
  }
}

async function calculateDirectoryUsage(directory: string, maximumBytes: number): Promise<number> {
  let total = 0
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new SecureStorageError('El destino contiene un enlace no permitido', 'DESTINATION_UNSAFE')
    }
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      total += await calculateDirectoryUsage(entryPath, maximumBytes - total)
    } else if (entry.isFile()) {
      total += (await lstat(entryPath)).size
    }
    if (total > maximumBytes) return total
  }
  return total
}

async function applyRetention(directory: string, retentionDays: number): Promise<void> {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new SecureStorageError('El destino contiene un enlace no permitido', 'DESTINATION_UNSAFE')
    }
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await applyRetention(entryPath, retentionDays)
    } else if (entry.isFile()) {
      const stats = await lstat(entryPath)
      if (stats.mtimeMs < cutoff) await rm(entryPath, { force: true })
    }
  }
}

function getStorageLimits() {
  return {
    maxZipBytes: readPositiveIntegerEnvironment('MASS_DOWNLOAD_STORAGE_MAX_ZIP_BYTES', DEFAULT_MAX_ZIP_BYTES),
    maxZipEntries: readPositiveIntegerEnvironment('MASS_DOWNLOAD_STORAGE_MAX_ZIP_ENTRIES', DEFAULT_MAX_ZIP_ENTRIES),
    maxUncompressedBytes: readPositiveIntegerEnvironment('MASS_DOWNLOAD_STORAGE_MAX_UNCOMPRESSED_BYTES', DEFAULT_MAX_UNCOMPRESSED_BYTES),
    maxCompressionRatio: readPositiveIntegerEnvironment('MASS_DOWNLOAD_STORAGE_MAX_COMPRESSION_RATIO', DEFAULT_MAX_COMPRESSION_RATIO),
  }
}

function readPositiveIntegerEnvironment(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new SecureStorageError('Los límites de almacenamiento están configurados de forma inválida', 'STORAGE_LIMIT_INVALID')
  }
  return parsed
}

function validateArchiveEntryPath(value: string): string {
  if (!value || value.includes('\0') || value.includes('\\') || path.posix.isAbsolute(value)) {
    throw new SecureStorageError('El ZIP contiene una ruta no permitida', 'ZIP_PATH_INVALID')
  }
  const segments = value.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new SecureStorageError('El ZIP contiene una ruta no permitida', 'ZIP_PATH_INVALID')
  }
  return value
}

function isSymlinkArchiveEntry(externalFileAttributes: number | undefined): boolean {
  if (!externalFileAttributes) return false
  const unixMode = externalFileAttributes >>> 16
  return (unixMode & 0o170000) === 0o120000
}

function normalizeZipSize(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new SecureStorageError('El ZIP contiene tamaños inválidos', 'ZIP_SIZE_INVALID')
  }
  return value
}

function readDestinationId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || !DESTINATION_ID_REGEX.test(value)) {
    throw new SecureStorageError('El destino de almacenamiento seleccionado no es válido', 'DESTINATION_INVALID')
  }
  return value
}

function readRelativePath(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') {
    throw new SecureStorageError('La ruta relativa seleccionada no es válida', 'RELATIVE_PATH_INVALID')
  }
  splitRelativePath(value)
  return value
}

function splitRelativePath(value: string | undefined): string[] {
  if (!value) return []
  if (value.includes('\\') || path.isAbsolute(value) || value.length > 240) {
    throw new SecureStorageError('La ruta relativa seleccionada no es válida', 'RELATIVE_PATH_INVALID')
  }
  const segments = value.split('/')
  if (segments.some((segment) => !SAFE_RELATIVE_COMPONENT_REGEX.test(segment) || segment === '.' || segment === '..')) {
    throw new SecureStorageError('La ruta relativa seleccionada no es válida', 'RELATIVE_PATH_INVALID')
  }
  return segments
}

function assertContainedPath(root: string, candidate: string): void {
  const relative = path.relative(root, candidate)
  if (relative && (relative.startsWith('..') || path.isAbsolute(relative))) {
    throw new SecureStorageError('La ruta sale del destino autorizado', 'PATH_ESCAPE')
  }
}

function assertNotPublicDirectory(publicDirectory: string, candidate: string): void {
  const relative = path.relative(publicDirectory, candidate)
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new SecureStorageError('El destino no puede ubicarse dentro del directorio público', 'DESTINATION_PUBLIC')
  }
}

export function validateMassDownloadPackageId(packageId: string): void {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(packageId)) {
    throw new SecureStorageError('El identificador de paquete no es válido', 'PACKAGE_ID_INVALID')
  }
}

function isNetworkPath(value: string): boolean {
  return value.startsWith('\\\\') || value.startsWith('//')
}
