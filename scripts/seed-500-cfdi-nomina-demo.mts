import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

// ====================== Constantes y generadores pseudoaleatorios deterministas (seeded)
const ORG_ID = 'cmnntrppk000502gcp93ketfx'
const TARGET_RFCS = ['ODE8604257UA','NMP7502257ZA','QA2414521FJW','QA27383427M8','QA27301176NC','QB2983782QT1','QB26123630CU'] as const
const FIRST = ['Rosa','María','José','Juan','Luis','Guadalupe','Francisco','Ana','Miguel','Carmen','Roberto','Laura','Pedro','Sofía','Alejandro','Isabel','Emilio','Dulce','Ricardo','Ximena','Eduardo','Mariana','Ignacio','Lucía','Raúl','Andrea','Alberto','Claudia','Fernando','Alejandra']
const LAST  = ['García','Martínez','López','González','Pérez','Rodríguez','Sánchez','Ramírez','Cruz','Gómez','Flores','Vázquez','Jiménez','Reyes','Díaz','Torres','Ruiz','Gutiérrez','Mendoza','Herrera','Aguilar','Medina','Ríos','Castro','Vargas','Mora','Domínguez','Castillo','Ortega','Silva']
const DEPTS = ['Finanzas','RH','Operaciones','Comercial','IT','Logística','Producción','Marketing','Legal','Administración']
const PUESTOS=['Contador','Analista','Jefe de Área','Gerente','Ejecutivo','Auxiliar','Técnico','Supervisor','Coordinador','Director']
const TCONTR =['01','02','03','04','05','06','07','08','09','10','99'] as const
const TJORN = ['01','02','03','04','05','06','07','08','99'] as const
const TREGIM=['02','03','04','05','06','07','08','09','10','11','12','13','14','99'] as const
const PERPA = ['01','02','03','04','05','06','99'] as const
const ENTFED= ['ASG','BCN','BCS','CAM','CHP','CHH','CMP','COA','COL','DIF','DUR','GUA','GRO','HGO','JAL','MIC','MOR','NAY','NLE','OAX','PUE','QUE','ROO','SLP','SIN','SON','TAB','TAM','TLX','VER','YUC','ZAC']
const NSSPF = ['77','26','08','68','30','71','94','18','42','55']

function mulberry32(seed: number) { return function() { let t = seed += 0x6D2B79F5; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const RAND = mulberry32(20260903)
const rand = (n: number) => Math.floor(RAND() * n)
const pick = <T,>(arr: readonly T[] | T[]): T => arr[rand(arr.length)] as T
const pad  = (n: number, w = 2) => String(n).padStart(w, '0')
const mxn  = (n: number, d = 2) => Number(n.toFixed(d))
const uuid = () => {
  const s = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = rand(16), v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  }).toUpperCase()
  return s
}
const sello = (len=30) => Array.from({length:len},()=>Math.floor(RAND()*36).toString(36).toUpperCase()).join('')
const rfc13 = () => {
  const a = pick(LAST).slice(0,2).toUpperCase().padEnd(2,'X')
  const b = (pick(LAST).slice(0,1)||'X').toUpperCase()
  const c = (pick(FIRST).slice(0,1)||'X').toUpperCase()
  const yy = pad(60+rand(45)), mm = pad(1+rand(12)), dd = pad(1+rand(28))
  const h = () => String.fromCharCode(65+rand(26))+String.fromCharCode(65+rand(26))+pad(rand(100))
  return `${a}${b}${c}${yy}${mm}${dd}${h()}`
}
const curp18 = () => {
  const a = pick(LAST).slice(0,2).toUpperCase().padEnd(2,'X')
  const b = (pick(LAST).slice(0,1)||'X').toUpperCase()
  const c = (pick(FIRST).slice(0,1)||'X').toUpperCase()
  const yy = pad(60+rand(45)), mm = pad(1+rand(12)), dd = pad(1+rand(28))
  const sexo = pick(['H','M']), edo = pick(ENTFED)
  const c1 = (pick(LAST).slice(0,1)||'X').toUpperCase()
  const c2 = (pick(LAST).slice(0,1)||'X').toUpperCase()
  const c3 = (pick(FIRST).slice(0,1)||'X').toUpperCase()
  return `${a}${b}${c}${yy}${mm}${dd}${sexo}${edo}${c1}${c2}${c3}${pad(1+rand(9))}${pad(rand(10))}`
}
const nss11 = () => pick(NSSPF) + pad(rand(100000000),8)

// ====================== Main
async function main() {
  console.log('=========================================')
  console.log(' SEED DEMO · 500 CFDIs Nómina 1.2 ')
  console.log('=========================================')
  const org = await prisma.organization.findUnique({ where: { id: ORG_ID }, select: { id: true } })
  if (!org) throw new Error(`Org ${ORG_ID} no existe → corre primero npm run onboarding:full`)
  const companies = await prisma.company.findMany({ where: { rfc: { in: [...TARGET_RFCS] }, status: 'APPROVED' }, select: { id: true, rfc: true } })
  if (companies.length !== TARGET_RFCS.length) throw new Error(`Faltan empresas APPROVED: ${companies.length}/${TARGET_RFCS.length}`)
  const fes = await prisma.fiscalEntity.findMany({ where: { rfc: { in: [...TARGET_RFCS] }, isActive: true, organizationId: org.id }, select: { id: true, rfc: true } })
  const feByRfc: Record<string,string> = {}
  fes.forEach(f => (feByRfc[f.rfc] = f.id))
  const admins = await prisma.user.findMany({ where: { email: 'admin@itcomplements.com' }, select: { id: true } })
  const approver = admins[0]?.id
  if (!approver) throw new Error('admin@itcomplements.com no existe → onboarding:full')
  console.log(`[ok] Org, ${companies.length} empresas, ${fes.length} fiscal entities, approver.`)

  // Meses: últimos 12 móviles a hoy (pagos día 15 de cada mes)
  const today = new Date()
  const months: Date[] = []
  for (let i = 12; i >= 1; i--) months.push(new Date(today.getFullYear(), today.getMonth()-i+1, 15))

  // 500 CFDIs
  const TOTAL = 500
  const CHUNK = 50
  let inserts = 0
  for (let block = 0; block < TOTAL / CHUNK; block++) {
    await prisma.$transaction(async (tx) => {
      for (let k = 0; k < CHUNK; k++) {
        const co    = pick(companies)
        const feId  = feByRfc[co.rfc]
        const fpago = pick(months)
        const femi  = new Date(fpago.getFullYear(), fpago.getMonth(), fpago.getDate() - 3)
        const fn    = pick(FIRST), a1 = pick(LAST), a2 = pick(LAST)
        const nombre= `${fn} ${a1} ${a2}`
        const rfcE  = rfc13(), curpE = curp18(), nssE = nss11()
        const dept  = pick(DEPTS), puesto = pick(PUESTOS)
        const tcont = pick(TCONTR), tjor = pick(TJORN), treg = pick(TREGIM)
        const ppago = pick(PERPA), entfed = pick(ENTFED)
        const sind  = pick(['Sí','No']), riesgo = String(1+rand(6))
        const nemp  = pad(1000+rand(8999),4)
        const ant   = 6+rand(120)
        const finic = new Date(fpago.getFullYear(), fpago.getMonth()-ant, 1)
        const sbc   = mxn(450 + rand(1000), 6)
        const pct   = RAND() < 0.15 ? 0.031 + RAND()*0.05 : RAND()*0.029
        const sdi   = mxn(sbc * (1 + (RAND()<0.5 ? -1 : 1)*pct), 6)
        const diasP = ppago==='02' ? 15 : ppago==='01' ? 7 : ppago==='03' ? 14 : ppago==='04' ? 30 : 30
        const smens = mxn(sbc*30, 2)
        const grav001 = mxn(smens*0.97, 2)
        const exen001 = mxn(smens*0.03, 2)
        const isrR    = mxn(smens*0.105, 2)
        const infR    = mxn(smens*0.050, 2)
        const fonR    = mxn(smens*0.015, 2)
        const penR    = mxn(smens*0.025, 2)
        const sinR    = mxn(smens*0.018, 2)
        // Beneficios (8 percepciones x receipt)
        const benefs = [
          { t:'029', c:'VALES DESPENSA',       g: 0,            e: mxn(smens*0.04,2) },
          { t:'005', c:'FONDO AHORRO',         g: mxn(smens*0.015,2), e: mxn(smens*0.015,2) },
          { t:'010', c:'PREMIO PUNTUALIDAD',   g: 0,            e: mxn(smens*0.02,2) },
          { t:'049', c:'PREMIO ASISTENCIA',    g: 0,            e: mxn(smens*0.018,2) },
          { t:'001', c:'SUELDO BASE',          g: grav001,      e: exen001 },
          { t:'011', c:'PRIMA VACACIONAL',    g: 0,            e: mxn(smens*0.02,2) },
          { t:'012', c:'PRIMA DOMINICAL',     g: 0,            e: mxn(smens*0.005,2) },
          { t:'013', c:'HORAS EXTRA EXENTO',   g: 0,            e: mxn(smens*0.02,2) },
        ]
        // Incapacidad 20%
        let inc: undefined | { t:string; d:number; imp:number; ini:Date; fin:Date }
        if (RAND()<0.2) {
          const t = pick(['01','02','03'])
          const d = 2+rand(8)
          const imp = mxn(sbc*d*0.75, 2)
          const ini = new Date(fpago.getFullYear(), fpago.getMonth(), 1)
          const fin = new Date(ini.getTime() + d*86400000)
          inc = { t, d, imp, ini, fin }
        }
        // Horas extra 24%
        let hex: undefined | { t:string; h:number; d:number; imp:number; dias:number }
        if (RAND()<0.24) {
          const tri = RAND()<0.30
          const h = 3+rand(10), d = Math.ceil(h/9)
          const tarifa = mxn(sbc*(tri?3:2), 2)
          hex = { t: tri?'02':'01', h, d, imp: mxn(h*tarifa,2), dias:d }
        }
        // Flags de alerta
        const cancelado = RAND()<0.02
        const brecha5   = RAND()<0.03
        const sbcNull = RAND()<0.01, sdiNull = RAND()<0.01
        const feFinal = brecha5 ? new Date(femi.getFullYear(), femi.getMonth(), femi.getDate()-7) : femi

        // Totales
        const totPerc = benefs.reduce((s,x)=>s+x.g+x.e,0) + (hex?hex.imp:0) + (inc?inc.imp:0)
        const imss = mxn(totPerc*0.035, 2)
        const totDed = isrR + infR + fonR + penR + sinR + imss
        const otros = mxn(RAND()*500, 2)

        // 1) Receipt
        const u = uuid()
        const rid = `payroll_${u.slice(0,16)}_${pad(rand(9999),4)}`
        await tx.payrollReceipt.create({
          data: {
            id: rid, organizationId: org.id, companyId: co.id, fiscalEntityId: feId,
            createdBy: approver, updatedBy: approver, approvedBy: approver,
            approvedAt: new Date(fpago.getTime()),
            uuid: u, serie: 'A', folio: String(1000+rand(8999)),
            fechaEmision: feFinal, fechaPago: fpago,
            fechaCertificacionSat: new Date(feFinal.getTime()+900000),
            fechaCancelacion: cancelado ? new Date(feFinal.getTime()+1036800000) : null,
            moneda: 'MXN', tipoCambio: 1, lugarExpedicion: entfed,
            tipoNomina: pick(['O','E']),
            fechaPagoInicial: new Date(fpago.getFullYear(), fpago.getMonth(), 1),
            fechaPagoFinal:   new Date(fpago.getFullYear(), fpago.getMonth(), diasP),
            numDiasPagados: diasP, departamento: dept, periodicidadPago: ppago,
            selloSat: sello(32), selloCfd: sello(32),
            cadenaOriginalSat: `||1.2|${u}|SAT|CERT|`,
            satStatus: cancelado ? 'CANCELED' : pick(['ACTIVE','ACTIVE','ACTIVE','ACTIVE','NOT_FOUND']),
            totalPercepciones: mxn(totPerc,6), totalDeducciones: mxn(totDed,6), totalOtrosPagos: mxn(otros,6),
            version: '1.2', rawXml: `<CFDI><Nomina/></CFDI>`, source: 'SEED_DEMO_500_CFDIS_V1'
          }, select: { id: true }
        })
        // 2) Receptor
        await tx.payrollReceptor.create({
          data: {
            payrollReceiptId: rid, rfc: rfcE, nombre, curp: curpE, nss: nssE,
            fechaInicioRelLaboral: finic, antiguedad: ant, tipoContrato: tcont,
            sindicalizado: sind, tipoJornada: tjor, tipoRegimen: treg, numEmpleado: nemp,
            departamento: dept, puesto, riesgoPuesto: riesgo, periodicidadPago: ppago,
            salarioBaseCotApor: sbcNull?null:sbc, salarioDiarioIntegrado: sdiNull?null:sdi, claveEntFed: entfed,
          }
        })
        // 3) Percepciones
        for (const b of benefs) {
          await tx.payrollPercepcion.create({ data: { payrollReceiptId:rid, tipoPercepcion:b.t, clave:`CP${b.t}`, concepto:b.c, importeGravado:b.g, importeExento:b.e } })
        }
        // 4) Deducciones (12)
        const deducs = [
          { t:'001', c:'ISR RETENIDO', i: isrR },
          { t:'002', c:'IMSS OBRERO',  i: mxn(totPerc*0.0165,2) },
          { t:'003', c:'INFONAVIT',    i: infR },
          { t:'004', c:'FONACOT',      i: fonR },
          { t:'005', c:'PENSIÓN ALIM', i: penR },
          { t:'006', c:'SINDICATO',    i: sinR },
          { t:'007', c:'IMSS PATRON',  i: mxn(totPerc*0.0185,2) },
          { t:'008', c:'SAR PATRONAL', i: mxn(totPerc*0.02,2) },
          { t:'009', c:'RETIRO PATR',  i: mxn(totPerc*0.011,2) },
          { t:'010', c:'CUOTA SOCIAL', i: mxn(totPerc*0.004,2) },
          { t:'011', c:'PRESTAMO CFE', i: mxn(totPerc*0.010,2) },
          { t:'012', c:'OTRAS DEDUC',  i: mxn(totPerc*0.006,2) },
        ]
        for (const d of deducs) {
          await tx.payrollDeduccion.create({ data: { payrollReceiptId: rid, tipoDeduccion: d.t, clave:`CD${d.t}`, concepto: d.c, importe: d.i } })
        }
        // 5) Incapacidad
        if (inc) {
          await tx.payrollIncapacidad.create({
            data: { payrollReceiptId: rid, tipoIncapacidad: inc.t, numeroDias: inc.d, importe: inc.imp, fechaInicio: inc.ini, fechaFin: inc.fin }
          })
        }
        // 6) Horas extra
        if (hex) {
          await tx.payrollHorasExtra.create({
            data: { payrollReceiptId: rid, tipoHoras: hex.t, numDias: hex.d, numHoras: hex.h, importePagadoExtra: hex.imp, importeExento: 0 }
          })
        }
        // 7) Otros pagos (siempre un subsidio al empleo chico)
        await tx.payrollOtroPago.create({
          data: { payrollReceiptId: rid, tipoOtroPago: '002', clave: 'OP002', concepto:'SUBSIDIO EMPLEO', importe: mxn(RAND()*80,2) }
        })
        // 8) Beneficios: las percepciones SAT 029/005/010/049 YA están insertadas como PayrollPercepcion; la MV `mv_hr_beneficios_prestaciones`
        //    las lee de ahí (no existe modelo Prisma PayrollBeneficiosPrestaciones).
        inserts++
      }
    })
    console.log(`  insertados ${Math.min((block+1)*CHUNK, TOTAL)}/${TOTAL}`)
  }
  console.log(`[ok] ${inserts} CFDIs insertados con sus tablas hijas.`)

  // ====================== REFRESH MVs (FISCAL + 6 RH)
  console.log('[refresh] MV fiscal conciliacion mensual...')
  await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY IF EXISTS mv_fiscal_conciliacion_mensual; ANALYZE mv_fiscal_conciliacion_mensual;`)
  console.log('[refresh] 6 MVs RH via refresh_hr_materialized_views(true)...')
  await prisma.$executeRawUnsafe(`SELECT refresh_hr_materialized_views(true);`)
  console.log('[refresh] OK.')

  // Cross-check (usamos queryRawUnsafe con coerción manual para estricto TS)
  const qc = async (sql: string): Promise<bigint> => {
    try { const r = await prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(sql); return (r[0]?.c as bigint) ?? BigInt(0) } catch { return BigInt(0) }
  }
  const cReceipts   = await qc(`SELECT COUNT(*)::bigint AS c FROM public.payroll_receipts`)
  const cReceptors  = await qc(`SELECT COUNT(*)::bigint AS c FROM public.payroll_receptors`)
  const cPercep     = await qc(`SELECT COUNT(*)::bigint AS c FROM public.payroll_percepciones`)
  const cDeduc      = await qc(`SELECT COUNT(*)::bigint AS c FROM public.payroll_deducciones`)
  const cIncap      = await qc(`SELECT COUNT(*)::bigint AS c FROM public.payroll_incapacidades`)
  const cHex        = await qc(`SELECT COUNT(*)::bigint AS c FROM public.payroll_horas_extra`)
  const cBene       = await qc(`SELECT COUNT(*)::bigint AS c FROM public.mv_hr_beneficios_prestaciones`)
  const mvFiscal    = await qc(`SELECT COUNT(*)::bigint AS c FROM public.mv_fiscal_conciliacion_mensual`)
  let mvHrRows: Array<{n:string;c:bigint}> = []
  try { mvHrRows = await prisma.$queryRawUnsafe<Array<{n:string;c:bigint}>>(`
    SELECT 'mv_hr_headcount_costo_kpis'     AS n, COUNT(*)::bigint AS c FROM mv_hr_headcount_costo_kpis     UNION ALL
    SELECT 'mv_hr_turnover_mensual'         AS n, COUNT(*)::bigint AS c FROM mv_hr_turnover_mensual         UNION ALL
    SELECT 'mv_hr_incapacidades_acumulado'  AS n, COUNT(*)::bigint AS c FROM mv_hr_incapacidades_acumulado  UNION ALL
    SELECT 'mv_hr_horas_extra_por_depto'    AS n, COUNT(*)::bigint AS c FROM mv_hr_horas_extra_por_depto    UNION ALL
    SELECT 'mv_hr_plantilla_actual'         AS n, COUNT(*)::bigint AS c FROM mv_hr_plantilla_actual         UNION ALL
    SELECT 'mv_hr_beneficios_prestaciones'  AS n, COUNT(*)::bigint AS c FROM mv_hr_beneficios_prestaciones;
  `) } catch { /* ignorar si alguna MV no tiene datos */ }
  console.log('\n=====[ SEED DEMO CROSS-CHECK ]=====')
  console.log(`  payroll_receipts:               ${cReceipts}`)
  console.log(`  payroll_receptors:              ${cReceptors}`)
  console.log(`  payroll_percepciones:           ${cPercep}`)
  console.log(`  payroll_deducciones:            ${cDeduc}`)
  console.log(`  payroll_incapacidades:          ${cIncap}`)
  console.log(`  payroll_horas_extra:            ${cHex}`)
  console.log(`  mv_hr_beneficios_prest:         ${cBene}`)
  console.log(`  mv_fiscal_conciliacion_mensual: ${mvFiscal} filas`)
  mvHrRows.forEach(r => console.log(`  ${r.n}: ${r.c} filas`))
  console.log('====================================\n')
}
void main().catch(err => { console.error(err); process.exit(1) }).finally(() => prisma.$disconnect())
