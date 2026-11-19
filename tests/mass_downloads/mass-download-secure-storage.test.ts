import { describe, expect, it } from '@jest/globals'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import {
  listConfiguredStorageDestinations,
  storeRoutineDownloadArtifacts,
  validateMassDownloadZip,
  validateRoutineStorageOptions,
} from '@/lib/mass-download-secure-storage'

const STORAGE_ENVIRONMENT_KEYS = [
  'MASS_DOWNLOAD_STORAGE_DESTINATIONS_JSON',
  'MASS_DOWNLOAD_STORAGE_ENCRYPTION_KEY',
  'MASS_DOWNLOAD_STORAGE_ENCRYPTION_MODE',
  'MASS_DOWNLOAD_STORAGE_MAX_COMPRESSION_RATIO',
]

describe('Descargas masivas · almacenamiento opcional seguro', () => {
  it('mantiene el comportamiento predeterminado cuando la rutina no activa almacenamiento', async () => {
    const result = await storeRoutineDownloadArtifacts({
      zipBuffer: Buffer.from('no-es-necesario-validar-en-la-ruta-predeterminada'),
      packageId: 'SAT-1',
      storageOptions: { enabled: false },
    })

    expect(result).toEqual({ zipBackupStored: false, extractedFilesStored: 0 })
  })

  it('guarda respaldos y archivos extraídos cifrados sin revelar la ruta física', async () => {
    await withStorageEnvironment(async (root) => {
      const zip = new JSZip()
      zip.file('nested/cfdi.xml', '<cfdi>contenido confidencial</cfdi>')
      zip.file('metadata.txt', 'contenido de metadata')
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

      const result = await storeRoutineDownloadArtifacts({
        zipBuffer,
        packageId: 'SAT_20261109_01',
        storageOptions: {
          enabled: true,
          extractionDestinationId: 'seguro',
          extractionRelativePath: 'empresa-a/noviembre',
          zipBackupDestinationId: 'seguro',
          zipBackupRelativePath: 'empresa-a/respaldo',
        },
      })

      const extractionDirectory = path.join(root, 'empresa-a', 'noviembre')
      const backupDirectory = path.join(root, 'empresa-a', 'respaldo')
      const extractionFiles = await readdir(extractionDirectory)
      const backupFiles = await readdir(backupDirectory)
      const firstExtractedFile = await readFile(path.join(extractionDirectory, extractionFiles[0]))

      expect(result).toMatchObject({
        zipBackupStored: true,
        extractedFilesStored: 2,
        extractionDestinationId: 'seguro',
        zipBackupDestinationId: 'seguro',
      })
      expect(extractionFiles.every((fileName) => fileName.endsWith('.enc'))).toBe(true)
      expect(backupFiles).toHaveLength(1)
      expect(firstExtractedFile.subarray(0, 10).toString('utf8')).toBe('CFDISTORE1')
      expect(firstExtractedFile.toString('utf8')).not.toContain('contenido confidencial')

      const destinations = listConfiguredStorageDestinations()
      expect(destinations).toEqual([{ id: 'seguro', label: 'Archivo SAT seguro', retentionDays: 30 }])
      expect(JSON.stringify(destinations)).not.toContain(root)
    })
  })

  it('rechaza rutas relativas que intentan salir del destino autorizado', async () => {
    await withStorageEnvironment(async () => {
      await expect(validateRoutineStorageOptions({
        enabled: true,
        extractionDestinationId: 'seguro',
        extractionRelativePath: '../escape',
      })).rejects.toMatchObject({
        code: 'RELATIVE_PATH_INVALID',
      })
    })
  })

  it('guarda archivos legibles cuando el modo plaintext está habilitado', async () => {
    await withStorageEnvironment(async (root) => {
      process.env.MASS_DOWNLOAD_STORAGE_ENCRYPTION_MODE = 'plaintext'
      const zip = new JSZip()
      zip.file('cfdi.xml', '<cfdi>contenido legible</cfdi>')
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })

      await storeRoutineDownloadArtifacts({
        zipBuffer,
        packageId: 'SAT-PLAINTEXT-01',
        storageOptions: {
          enabled: true,
          extractionDestinationId: 'seguro',
        },
      })

      const extractionFiles = await readdir(root)
      const extractedContent = await readFile(path.join(root, extractionFiles[0]), 'utf8')
      expect(extractionFiles[0]).toMatch(/\.xml$/)
      expect(extractedContent).toContain('contenido legible')
    })
  })

  it('rechaza un ZIP con traversal y un ZIP con ratio de expansión excesivo', async () => {
    const traversalZip = new JSZip()
    traversalZip.file('../escape.xml', '<xml/>')
    const traversalBuffer = await traversalZip.generateAsync({ type: 'nodebuffer' })

    await expect(validateMassDownloadZip(traversalBuffer)).rejects.toMatchObject({
      code: 'ZIP_PATH_INVALID',
    })

    const previousRatio = process.env.MASS_DOWNLOAD_STORAGE_MAX_COMPRESSION_RATIO
    process.env.MASS_DOWNLOAD_STORAGE_MAX_COMPRESSION_RATIO = '1'
    try {
      const denseZip = new JSZip()
      denseZip.file('dense.xml', 'A'.repeat(20_000))
      const denseBuffer = await denseZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

      await expect(validateMassDownloadZip(denseBuffer)).rejects.toMatchObject({
        code: 'ZIP_COMPRESSION_RATIO',
      })
    } finally {
      restoreEnvironmentValue('MASS_DOWNLOAD_STORAGE_MAX_COMPRESSION_RATIO', previousRatio)
    }
  })
})

async function withStorageEnvironment(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'cfdi-secure-storage-'))
  const previousValues = new Map(STORAGE_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]))
  process.env.MASS_DOWNLOAD_STORAGE_DESTINATIONS_JSON = JSON.stringify([
    {
      id: 'seguro',
      label: 'Archivo SAT seguro',
      rootPath: root,
      quotaBytes: 20 * 1024 * 1024,
      retentionDays: 30,
    },
  ])
  process.env.MASS_DOWNLOAD_STORAGE_ENCRYPTION_KEY = 'a'.repeat(64)
  delete process.env.MASS_DOWNLOAD_STORAGE_ENCRYPTION_MODE
  delete process.env.MASS_DOWNLOAD_STORAGE_MAX_COMPRESSION_RATIO

  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
    for (const [key, value] of previousValues) {
      restoreEnvironmentValue(key, value)
    }
  }
}

function restoreEnvironmentValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
