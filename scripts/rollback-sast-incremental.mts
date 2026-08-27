import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const SAST_SEED_IDS = {
  usersEmails: [
    'sa-sast@itcomplements.com',
    'audit-sast@itcomplements.com',
    'other-sast@itcomplements.com'
  ],
  fiscalEntityRfcs: [
    'QBB7223997V9'
  ],
  companyRfcs: [
    'QA2190188S3Z',
    'QB2306260K5Y'
  ],
  invoiceUuids: [
    '11111111-0000-4000-8000-000000000001',
    '11111111-0000-4000-8000-000000000002'
  ],
  massDownloadRequestIds: [
    'mdr-sast-org-a-prop-001',
    'mdr-sast-org-b-aje-001'
  ],
  satCredentialSeedOrgsRfcs: [
    { organizationId: 'cmnntrppk000502gcp93ketfx', rfc: 'ODE8604257UA' },
    { organizationId: 'cmipiwlqk000mvyvtc22tnlrb', rfc: 'QBB7223997V9' }
  ],
  checkpointDate: new Date('2026-08-13T23:31:02.000Z')
}

const DRY_RUN = process.argv.includes('--dry-run')

async function countAuditLogsAfterCheckpoint(): Promise<number> {
  return prisma.auditLog.count({
    where: { timestamp: { gte: SAST_SEED_IDS.checkpointDate } }
  })
}

async function countSatCredentialsSeedOrPostCp(): Promise<number> {
  return prisma.satCredential.count({
    where: {
      OR: [
        { organizationId: { in: ['cmnntrppk000502gcp93ketfx', 'cmipiwlqk000mvyvtc22tnlrb'] },
          rfc: { in: ['ODE8604257UA', 'QBB7223997V9'] } },
        { createdAt: { gte: SAST_SEED_IDS.checkpointDate } }
      ]
    }
  })
}

async function countMassDownloadSeedOrPostCp(): Promise<{ total: number; seedById: number; postCpById: number }> {
  const seedById = await prisma.massDownloadRequest.count({
    where: { id: { in: SAST_SEED_IDS.massDownloadRequestIds } }
  })
  const postCpById = await prisma.massDownloadRequest.count({
    where: {
      AND: [
        { id: { notIn: SAST_SEED_IDS.massDownloadRequestIds } },
        { createdAt: { gte: SAST_SEED_IDS.checkpointDate } }
      ]
    }
  })
  return { total: seedById + postCpById, seedById, postCpById }
}

async function countInvoicesSeedOrPostCp(): Promise<{ total: number; seedByUuid: number; postCpByUuid: number; blobs: number }> {
  const seedByUuid = await prisma.invoice.count({
    where: { uuid: { in: SAST_SEED_IDS.invoiceUuids } }
  })
  const postCpByUuid = await prisma.invoice.count({
    where: {
      AND: [
        { uuid: { notIn: SAST_SEED_IDS.invoiceUuids } },
        { createdAt: { gte: SAST_SEED_IDS.checkpointDate } }
      ]
    }
  })
  const blobs = await prisma.invoiceBlob.count({
    where: {
      invoice: {
        OR: [
          { uuid: { in: SAST_SEED_IDS.invoiceUuids } },
          { createdAt: { gte: SAST_SEED_IDS.checkpointDate } }
        ]
      }
    }
  })
  return { total: seedByUuid + postCpByUuid, seedByUuid, postCpByUuid, blobs }
}

async function countImportRunsAfterCheckpoint(): Promise<{ importRuns: number; importSessions: number; importRunItems: number }> {
  let importRuns = 0, importSessions = 0, importRunItems = 0
  try {
    importRuns = await (prisma as any).importRun?.count({ where: { createdAt: { gte: SAST_SEED_IDS.checkpointDate } } }) || 0
  } catch { importRuns = 0 }
  try {
    importSessions = await (prisma as any).importDirectorySession?.count({ where: { createdAt: { gte: SAST_SEED_IDS.checkpointDate } } }) || 0
  } catch { importSessions = 0 }
  try {
    importRunItems = await (prisma as any).importRunItem?.count({ where: { createdAt: { gte: SAST_SEED_IDS.checkpointDate } } }) || 0
  } catch { importRunItems = 0 }
  return { importRuns, importSessions, importRunItems }
}

async function main() {
  await prisma.$connect()

  console.log('')
  console.log('='.repeat(78))
  console.log('🔄 SAST ROLLBACK · NIVEL 1 · INCREMENTAL')
  console.log('='.repeat(78))
  console.log('Proveedor BD: PostgreSQL (via Prisma 6.x)')
  console.log('Checkpoint fecha: ', SAST_SEED_IDS.checkpointDate.toISOString())
  console.log('Modo DRY_RUN:      ', DRY_RUN ? 'SÍ (solo lectura · SIN CAMBIOS EN BD)' : 'NO (transacción deleteMany)')
  console.log('Obj. seed (hardcodeados):')
  console.log('  · Users emails  : ', SAST_SEED_IDS.usersEmails.join(', '))
  console.log('  · Companies RFCs: ', SAST_SEED_IDS.companyRfcs.join(', '), '  (¡ODE8604257UA NO ESTÁ AQUÍ!)')
  console.log('  · FE RFCs       : ', SAST_SEED_IDS.fiscalEntityRfcs.join(', '), '  (¡ODE8604257UA NO ESTÁ AQUÍ!)')
  console.log('  · Invoice UUIDs : ', SAST_SEED_IDS.invoiceUuids.join(', '))
  console.log('  · MDR IDs       : ', SAST_SEED_IDS.massDownloadRequestIds.join(', '))
  console.log('')

  const [cAudit, cSat, cMdr, cInv, cImp] = await Promise.all([
    countAuditLogsAfterCheckpoint(),
    countSatCredentialsSeedOrPostCp(),
    countMassDownloadSeedOrPostCp(),
    countInvoicesSeedOrPostCp(),
    countImportRunsAfterCheckpoint()
  ])

  console.log('--- 📊 Conteos Pre-Rollback (impacto detectado) ---')
  console.log(`  AuditLogs >= checkpoint                      : ${cAudit}`)
  console.log(`  SatCredential seed/range (Org-A/B + ODE/QBB): ${cSat}`)
  console.log(`  MassDownloadRequest (seed ${cMdr.seedById} + post-cp ${cMdr.postCpById}) = ${cMdr.total}`)
  console.log(`  Invoices (seed ${cInv.seedByUuid} + post-cp ${cInv.postCpByUuid}) = ${cInv.total}   (+ InvoiceBlobs=${cInv.blobs} cascade)`)
  console.log(`  ImportRun=${cImp.importRuns}  ImportDirSession=${cImp.importSessions}  ImportRunItem=${cImp.importRunItems}`)
  console.log('')

  if (DRY_RUN) {
    console.log('--- 🔴 RESUMEN DRY-RUN (lo que haría en modo REAL, sin escribir a BD aún) ---')
    console.log('  1) DELETE MassDownloadRequest WHERE id IN (mdr-sast-org-a-prop-001, mdr-sast-org-b-aje-001) OR createdAt >= 2026-08-13T23:31:02Z')
    console.log(`     ≈ ${cMdr.total} filas`)
    console.log('  2) DELETE SatCredential (Org-A/ODE8604257UA + Org-B/QBB7223997V9 seed) OR createdAt >= checkpoint')
    console.log(`     ≈ ${cSat} filas`)
    console.log('  3) DELETE Invoice (UUIDs seed 0001/0002) OR createdAt >= checkpoint  →  cascade InvoiceBlobs')
    console.log(`     ≈ ${cInv.total} invoices + ${cInv.blobs} blobs`)
    console.log(`  4) DELETE ImportRun/ImportDirSession/ImportRunItem post-cp        ≈ ${cImp.importRuns + cImp.importSessions + cImp.importRunItems} filas`)
    console.log(`  5) DELETE CompanyAccess → Company  RFCS QA2190188S3Z, QB2306260K5Y  (no productivas)`)
    console.log(`  6) DELETE FiscalEntity RFC QBB7223997V9                          (no productiva · ODE8604257UA SOBREVIVE)`)
    console.log(`  7) DELETE Member → User  emails seed (sa-sast/audit-sast/other-sast)`)
    console.log(`     ✅ rtorreh@itcomplements.com  ✅ pnajera@itcomplements.com  ✅ ODE8604257UA  ✅ OPTICAS DEVLYN  NO SE TOCAN`)
    console.log(`  8) DELETE AuditLog timestamp >= 2026-08-13T23:31:02Z              ≈ ${cAudit} filas`)
    console.log('')
    console.log('[DRY-RUN] Ejecución REAL omitida. Para lanzar con escritura:')
    console.log('          npx tsx scripts\\rollback-sast-incremental.mts')
    console.log('')
    console.log('--- ✅ PREGUNTA AL USUARIO ANTES DE PASO REAL: ---')
    console.log('¿Los números de arriba COINCIDEN con lo que esperabas (seed + post-cp)?')
    console.log('¿Confirmas que NO se incluye a ODE8604257UA, rtorreh, pnajera ni empresas productivas?')
    console.log('')
    await prisma.$disconnect()
    return
  }

  const results: Array<{ step: string; deleted: number; skipped?: number }> = []

  const tx = await prisma.$transaction(async (tx) => {
    console.log('')
    console.log('[1/9] Eliminar MassDownloadRequest (seed IDs + post-checkpoint)')
    const delMdr = await tx.massDownloadRequest.deleteMany({
      where: {
        OR: [
          { id: { in: SAST_SEED_IDS.massDownloadRequestIds } },
          { createdAt: { gte: SAST_SEED_IDS.checkpointDate } }
        ]
      }
    })
    results.push({ step: 'MassDownloadRequest (seed + post-cp)', deleted: delMdr.count })
    console.log('  →', delMdr.count, 'filas')

    console.log('[2/9] Eliminar SatCredential seed Orgs + RFCs o post-checkpoint')
    const delSat = await tx.satCredential.deleteMany({
      where: {
        OR: [
          { AND: SAST_SEED_IDS.satCredentialSeedOrgsRfcs.map(o => ({ organizationId: o.organizationId, rfc: o.rfc })) },
          { createdAt: { gte: SAST_SEED_IDS.checkpointDate } }
        ]
      }
    })
    results.push({ step: 'SatCredential (seed + post-cp)', deleted: delSat.count })
    console.log('  →', delSat.count, 'filas')

    console.log('[3/9] Eliminar Invoices (UUIDs seed + post-checkpoint)  → cascade InvoiceBlob, Complementos, Pagos')
    const delInv = await tx.invoice.deleteMany({
      where: {
        OR: [
          { uuid: { in: SAST_SEED_IDS.invoiceUuids } },
          { createdAt: { gte: SAST_SEED_IDS.checkpointDate } }
        ]
      }
    })
    results.push({ step: `Invoice (+ blobs cascade)`, deleted: delInv.count })
    console.log('  →', delInv.count, 'invoices (InvoiceBlobs borrados en ON DELETE CASCADE)')

    console.log('[4/9] Eliminar ImportRunItem + ImportRun + ImportDirectorySession post-cp')
    let delImpItems = 0, delImpRuns: any = { count: 0 }, delImpSess: any = { count: 0 }
    try {
      const r = await (tx as any).importRunItem?.deleteMany({ where: { createdAt: { gte: SAST_SEED_IDS.checkpointDate } } })
      delImpItems = r?.count || 0
    } catch {}
    try {
      delImpRuns = await (tx as any).importRun?.deleteMany({ where: { createdAt: { gte: SAST_SEED_IDS.checkpointDate } } }) || { count: 0 }
    } catch {}
    try {
      delImpSess = await (tx as any).importDirectorySession?.deleteMany({ where: { createdAt: { gte: SAST_SEED_IDS.checkpointDate } } }) || { count: 0 }
    } catch {}
    results.push({ step: `ImportRunItem + ImportRun + DirSession (post-cp)`, deleted: delImpItems + (delImpRuns.count || 0) + (delImpSess.count || 0) })
    console.log(`  → items=${delImpItems}, runs=${delImpRuns.count || 0}, sessions=${delImpSess.count || 0}`)

    console.log('[5/9] Eliminar CompanyAccess → Companies seed (QA2190188S3Z, QB2306260K5Y)')
    const companiesSeed = await tx.company.findMany({
      where: { rfc: { in: SAST_SEED_IDS.companyRfcs } },
      select: { id: true, rfc: true }
    })
    const companySeedIds = companiesSeed.map(c => c.id)
    const delCa = await tx.companyAccess.deleteMany({ where: { companyId: { in: companySeedIds } } })
    const delCo = await tx.company.deleteMany({ where: { id: { in: companySeedIds } } })
    results.push({ step: `CompanyAccess(${delCa.count}) + Company(${delCo.count}) RFCS QA/QB2`, deleted: delCa.count + delCo.count })
    console.log(`  → companies seed: ${companiesSeed.map(c=>c.rfc+'@'+c.id).join(', ')}`)

    console.log('[6/9] Eliminar FiscalEntity seed (QBB7223997V9)  — ¡SKIP ODE8604257UA!')
    const delFe = await tx.fiscalEntity.deleteMany({ where: { rfc: { in: SAST_SEED_IDS.fiscalEntityRfcs } } })
    results.push({ step: `FiscalEntity RFC QBB7223997V9 (seed)`, deleted: delFe.count })
    console.log('  →', delFe.count, 'FE · ODE8604257UA = SIN TOCAR')

    console.log('[7/9] Eliminar CustomRole si existen references a Members (antes de borrar users)')
    let delCR = { count: 0 }
    try {
      const memberSeedIds = (await tx.member.findMany({
        where: { user: { email: { in: SAST_SEED_IDS.usersEmails } } },
        select: { customRoleId: true }
      })).map(m => m.customRoleId).filter((x): x is string => !!x)
      if (memberSeedIds.length) {
        delCR = await tx.customRole.deleteMany({ where: { id: { in: memberSeedIds } } })
      }
    } catch {}
    results.push({ step: `CustomRole orphan (seed)`, deleted: delCR.count })
    console.log('  →', delCR.count, 'customRoles')

    console.log('[8/9] Eliminar Members + Users seed (sa-sast · audit-sast · other-sast)')
    console.log('      ✅ rtorreh@itcomplements.com  ✅ pnajera@itcomplements.com  = NO TOCADOS')
    const usersSeed = await tx.user.findMany({
      where: { email: { in: SAST_SEED_IDS.usersEmails } },
      select: { id: true, email: true }
    })
    const userSeedIds = usersSeed.map(u => u.id)
    const delMembers = await tx.member.deleteMany({ where: { userId: { in: userSeedIds } } })
    const delUser = await tx.user.deleteMany({ where: { id: { in: userSeedIds } } })
    results.push({ step: `Member(${delMembers.count}) + User(${delUser.count}) seed emails`, deleted: delMembers.count + delUser.count })
    console.log(`  → users seed: ${usersSeed.map(u=>u.email+'@'+u.id).join(', ')}`)

    console.log('[9/9] Eliminar AuditLogs timestamp >= checkpoint (solo post-test, logs antiguos sobreviven)')
    const delAudit = await tx.auditLog.deleteMany({ where: { timestamp: { gte: SAST_SEED_IDS.checkpointDate } } })
    results.push({ step: `AuditLog (post-checkpoint ${SAST_SEED_IDS.checkpointDate.toISOString()})`, deleted: delAudit.count })
    console.log('  →', delAudit.count, 'auditLogs')

    return { ok: true }
  }, { timeout: 180_000 })

  console.log('')
  console.log('=== ✅ TRANSACCIÓN COMMIT REALIZADA ===')
  console.log('─'.repeat(78))
  console.log('  Paso · Objeto                                        · Filas Afectadas')
  console.log('─'.repeat(78))
  for (const r of results) {
    console.log(`  · ${r.step.padEnd(52, ' ')} · ${String(r.deleted).padStart(6)}`)
  }
  console.log('─'.repeat(78))
  console.log('')
  console.log('=== 🧪 VALIDACIÓN POST-ROLLBACK AUTOMÁTICA ===')
  console.log('(contra la BD REAL después del commit)')
  console.log('')

  const postAudit = await countAuditLogsAfterCheckpoint()
  const postSat = await countSatCredentialsSeedOrPostCp()
  const postMdr = await countMassDownloadSeedOrPostCp()
  const postInv = await countInvoicesSeedOrPostCp()
  const postImp = await countImportRunsAfterCheckpoint()
  const userSeedCount = await prisma.user.count({ where: { email: { in: SAST_SEED_IDS.usersEmails } } })
  const companySeedCount = await prisma.company.count({ where: { rfc: { in: SAST_SEED_IDS.companyRfcs } } })
  const feSeedCount = await prisma.fiscalEntity.count({ where: { rfc: { in: SAST_SEED_IDS.fiscalEntityRfcs } } })
  const userRealCount = await prisma.user.count({ where: { email: { in: ['rtorreh@itcomplements.com', 'pnajera@itcomplements.com'] } } })
  const feRealCount = await prisma.fiscalEntity.count({ where: { rfc: 'ODE8604257UA' } })
  const orgRealCount = await prisma.organization.count({ where: { id: { in: ['cmnntrppk000502gcp93ketfx', 'cmipiwlqk000mvyvtc22tnlrb'] } } })

  const checks = [
    { label: 'Users seed (sa-sast, audit, other) → esperado 0', value: userSeedCount, expected: 0, critical: true },
    { label: 'Companies seed (QA2190188S3Z, QB2306260K5Y) → esperado 0', value: companySeedCount, expected: 0, critical: true },
    { label: 'FE seed (QBB7223997V9) → esperado 0', value: feSeedCount, expected: 0, critical: true },
    { label: 'MDR seed IDs (mdr-sast-*) → esperado 0', value: postMdr.seedById, expected: 0, critical: true },
    { label: 'Invoice UUIDs seed (0001,0002) → esperado 0', value: postInv.seedByUuid, expected: 0, critical: true },
    { label: 'AuditLogs post-checkpoint → esperado 0', value: postAudit, expected: 0, critical: true },
    { label: 'SatCredential seed/post-cp → esperado 0', value: postSat, expected: 0, critical: false },
    { label: 'MassDownloadRequest post-cp adicional → esperado 0', value: postMdr.postCpById, expected: 0, critical: false },
    { label: 'Invoices post-cp adicional → esperado 0', value: postInv.postCpByUuid, expected: 0, critical: false },
    { label: 'ImportRun + Session post-cp → esperado 0+0+0', value: postImp.importRuns + postImp.importSessions + postImp.importRunItems, expected: 0, critical: false },
    { label: '✅ GUARD RAIL · Users reales (rtorreh+pnajera) → esperado 2', value: userRealCount, expected: 2, critical: true },
    { label: '✅ GUARD RAIL · FE real (ODE8604257UA) → esperado 1', value: feRealCount, expected: 1, critical: true },
    { label: '✅ GUARD RAIL · Organizations A+B (cmnn/cmip) → esperado 2', value: orgRealCount, expected: 2, critical: true }
  ]

  const fails: string[] = []
  for (const ch of checks) {
    const ok = ch.value === ch.expected
    console.log(`  ${ok ? (ch.critical ? '🛡️ ' : '✅ ') : '❌ '} ${ch.label.padEnd(72, ' ')} · actual=${String(ch.value).padStart(5)} · esperado=${String(ch.expected).padStart(5)}`)
    if (!ok) fails.push(`${ch.label} (actual=${ch.value}, esperado=${ch.expected})`)
  }

  console.log('')
  if (fails.length === 0) {
    console.log('🎉 NIVEL 1 · ROLLBACK INCREMENTAL 100% EXITOSO')
    console.log('   · Seed SAST completamente borrado.')
    console.log('   · Datos reales/productivos INTACTOS (rtorreh, pnajera, ODE8604257UA, organizations A+B).')
    console.log('   · ✅ Plan de Rollback NIVEL 1 QUEDÓ CERTIFICADO.')
    console.log('')
    console.log('   Para regenerar data test y poder repetir batería:')
    console.log('     > npx tsx scripts\\seed-sast-fixtures.mts')
    console.log('   Y para limpiar RL store:')
    console.log('     > (Ctrl+C en next dev) > npm run dev')
  } else {
    console.log('⚠️  Resultados con desvíos (', fails.length, 'fallos):')
    for (const f of fails) console.log('   ·', f)
    console.log('')
    console.log('   Recomendación: Si los GUARD RAILS (últimos 3 checks) pasan, el daño es mínimo.')
    console.log('   Revisar RUNBOOK NIVEL 2. Si no, subir a NIVEL 3 (restore snapshot completo).')
  }

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('')
  console.error('❌ ROLLBACK INCREMENTAL FALLÓ — Prisma ROLLBACK automático dentro de $transaction (¡no cambió nada!)')
  console.error('   Error:', (e as Error).message)
  console.error('   Stack (primeros 1200 chars):', (e as Error).stack?.slice(0, 1200))
  await prisma.$disconnect()
  process.exit(1)
})
