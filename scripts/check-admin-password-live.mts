import { prisma } from "../src/lib/prisma"
import bcrypt from "bcryptjs"

const NODE_ENV = (process.env.NODE_ENV ?? "development").trim().toLowerCase()
const VERCEL = process.env.VERCEL === "1" || process.env.VERCEL_ENV != null
const IS_PRODUCTION =
  NODE_ENV === "production" ||
  VERCEL ||
  (process.env.AUTH_URL != null && !process.env.AUTH_URL.includes("localhost") && !process.env.AUTH_URL.includes("127.0.0.1"))

if (IS_PRODUCTION) {
  console.log("\n🚫 ===== SCRIPT BLOQUEADO EN PRODUCCIÓN =====\n")
  console.log("   Este script (check-admin-password-live.mts) es EXCLUSIVAMENTE para uso")
  console.log("   LOCAL / DEV. No se puede ejecutar en ambientes de producción por seguridad:")
  console.log("     · Expone emails y huellas de contraseñas en logs de pipeline.")
  console.log("     · Imprime información sensible de cuentas de administrador.")
  console.log("     · Modo hardening: credenciales de admin en PROD se gestionan por CLI")
  console.log("       (por ejemplo: npx tsx scripts/reset-admin-password-safe.mts pidiendo 2FA).\n")
  if (NODE_ENV) console.log(`   · NODE_ENV detectado : ${NODE_ENV}`)
  if (VERCEL) console.log(`   · Plataforma        : Vercel (vercel)`)
  console.log("")
  process.exit(4)
}

const TARGET_EMAIL = "admin@itcomplements.com"
const PASSWORD_PLAIN = "Admin_Itcomplements_Demo_2026!"

async function main() {
  const candidates = await prisma.user.findMany({
    where: { email: { equals: TARGET_EMAIL, mode: "insensitive" } },
    select: { id: true, email: true, systemRole: true, password: true, emailVerified: true, createdAt: true }
  })

  console.log("\n===== CHECK SUPERADMIN PASSWORD LIVE =====")
  console.log(`  · email target    : ${TARGET_EMAIL}`)
  console.log(`  · password plain  : ${PASSWORD_PLAIN.length} chars`)
  console.log(`  · users encontrados por email: ${candidates.length}`)

  if (candidates.length === 0) {
    console.log("  ❌ NO HAY USUARIO con email " + TARGET_EMAIL)
    process.exit(1)
  }

  if (candidates.length > 1) {
    console.log("  ⚠️  HAY DUPLICADOS (email debería ser UNIQUE). IDs:")
    candidates.forEach(c => console.log(`      - id=${c.id} role=${c.systemRole} email=${c.email}`))
  }

  let anyPass = false
  for (const u of candidates) {
    const hasPassword = !!u.password
    let bcryptRes: boolean | null = null
    let bcryptErr: Error | null = null
    if (hasPassword) {
      try { bcryptRes = await bcrypt.compare(PASSWORD_PLAIN, u.password) } catch (e) { bcryptErr = e as Error }
    }
    const roundMatch = u.password?.match(/^\$2[aby]\$(\d{2})\$/)
    const rounds = roundMatch ? Number(roundMatch[1]) : null
    console.log(`\n  · User id=${u.id}`)
    console.log(`      · email       : ${u.email}`)
    console.log(`      · systemRole  : ${u.systemRole}`)
    console.log(`      · hasPassword : ${hasPassword}`)
    console.log(`      · bcryptRounds: ${rounds ?? "NULL/DESCONOCIDO"}`)
    console.log(`      · bcrypt.hash len prefix: ${hasPassword ? u.password!.substring(0, 7) : "null"}`)
    console.log(`      · bcrypt.compare("${PASSWORD_PLAIN}", storedHash) = ${bcryptRes}`)
    if (bcryptErr) console.log(`      · bcrypt compare ERROR: ${bcryptErr.message}`)
    console.log(`      · emailVerified: ${u.emailVerified}`)
    console.log(`      · createdAt    : ${u.createdAt?.toISOString()}`)
    if (bcryptRes) anyPass = true
  }

  console.log("\n===== RESULTADO =====")
  console.log(anyPass
    ? "✅ bcrypt.compare OK. La contraseña almacenada COINCIDE con la esperada."
    : "❌ bcrypt.compare FALLA. El password almacenado NO COINCIDE con la esperada. Hay que re-escribir el hash.")
  process.exit(anyPass ? 0 : 2)
}
main().catch((e) => { console.error("FATAL:", e); process.exit(99) })
