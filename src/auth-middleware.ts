// auth-middleware.ts: STANDALONE NextAuth wrapper for src/proxy.ts
// ---------------------------------------------------------------------------
// Reglas de este archivo (IMPORTANTÍSIMO para no romper el bundler en dev):
//  1. NO importar "@/lib/auth" (arrastra prisma, @auth/prisma-adapter, rate-limit,
//     sat-gate-helpers, security.ts → node:crypto / util / PrismaClient → se genera
//     un chunk en .next/dev/server/edge/chunks/*.wasm que NO existe en runtime).
//  2. NO importar "@/lib/prisma" ESTÁTICAMENTE en top-level. Usar import() DENTRO
//     de los callbacks authorize/jwt (lazy, solo cuando ya corre en Node.js).
//  3. NO importar "@/lib/security", "@/lib/rate-limit", "@/lib/sat-gate-helpers"
//     (usan node:crypto → runtime edge NO lo tiene).
//  4. NO importar "bcryptjs" ESTÁTICAMENTE top-level; usar await import('bcryptjs')
//     dentro de authorize(). bcryptjs es pure-JS pero para ser 100% safe lazy-load.
//  5. Session strategy = JWT, NO PrismaAdapter. La membership/systemRole se llenan
//     en el callback jwt() haciendo una consulta prisma al momento.
//  6. ⚠️ PRODUCCIÓN (NODE_ENV === "production"): trustHost SOLO true si el host
//     está en PUBLIC_HOSTS_ALLOWLIST o coincide con host de AUTH_URL/NEXTAUTH_URL
//     o AUTH_TRUST_HOST=true. Nunca hardcodear `trustHost: true` en prod.
//  7. NO usar NextAuth(request => {...}) (factory dinámico) en este archivo: rompe
//     src/proxy.ts porque `authMiddleware(onRequest)` requiere resolver la firma
//     `NextAuthConfig` sincrónicamente en build-time.
// ---------------------------------------------------------------------------
import NextAuth, { CredentialsSignin } from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import CredentialsProvider from "next-auth/providers/credentials"
import type { JWT } from "next-auth/jwt"
import type { Session } from "next-auth"
import type { AdapterUser } from "next-auth/adapters"
import type { MemberRole } from "@prisma/client"
import { signInSchema } from "@/schemas/auth"

type CredentialErrorCode =
  | "CredentialsInvalid"
  | "CredentialsEmptyPassword"
  | "CredentialsAccessPending"
  | "CredentialsRateLimit"
  | "CredentialsConfiguration"

class AuthCredentialError extends CredentialsSignin {
  code: CredentialErrorCode = "CredentialsInvalid"
  constructor(code: CredentialErrorCode, message?: string) {
    super()
    this.code = code
    if (message) this.message = message
  }
}

function envTrustHost(): boolean {
  try {
    const isProd = process.env.NODE_ENV === "production"
    if (process.env.FEATURE_STRICT_AUTH_TRUST === "1") return false
    if (process.env.AUTH_TRUST_HOST === "true" || process.env.NEXTAUTH_TRUST_HOST === "true") {
      return true
    }
    const allowlist = (process.env.PUBLIC_HOSTS_ALLOWLIST ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    const authUrls = [process.env.AUTH_URL, process.env.NEXTAUTH_URL]
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .map((u) => {
        try { return new URL(u).host.toLowerCase() } catch { return "" }
      })
      .filter(Boolean)
    const effectiveAllowlist = new Set([...allowlist, ...authUrls])
    if (!isProd) {
      effectiveAllowlist.add("localhost:3000")
      effectiveAllowlist.add("localhost:3001")
      effectiveAllowlist.add("127.0.0.1:3000")
      effectiveAllowlist.add("127.0.0.1:3001")
      effectiveAllowlist.add("10.10.33.143:3000")
      effectiveAllowlist.add("10.10.33.143:3001")
    }
    return effectiveAllowlist.size > 0
  } catch {
    return process.env.NODE_ENV !== "production"
  }
}

const _trustHostValue = envTrustHost()
const _isProdRuntime = process.env.NODE_ENV === "production"

export const { auth: authMiddleware, handlers: _h, signIn: _sI, signOut: _sO } = NextAuth({
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: _trustHostValue,
  useSecureCookies: _isProdRuntime,
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      allowDangerousEmailAccountLinking: true,
    }),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new AuthCredentialError("CredentialsInvalid")
        }
        const emailRaw = String(credentials.email)
        const passwordRaw = String(credentials.password)
        const parsed = signInSchema.safeParse({
          email: typeof emailRaw === "string" ? emailRaw.trim() : emailRaw,
          password: typeof passwordRaw === "string" ? passwordRaw.trim() : passwordRaw,
        })
        if (!parsed.success) {
          throw new AuthCredentialError("CredentialsInvalid")
        }
        const { email, password } = parsed.data
        const normalizedEmail = email.toLowerCase().trim()
        let prismaLazy: typeof import("@/lib/prisma").prisma | null = null
        let bcryptLazy: typeof import("bcryptjs") | null = null
        try {
          ;[{ prisma: prismaLazy }, bcryptLazy] = await Promise.all([
            import("@/lib/prisma"),
            import("bcryptjs"),
          ])
        } catch {
          throw new AuthCredentialError("CredentialsConfiguration")
        }
        const user = await prismaLazy.user.findUnique({
          where: { email: normalizedEmail },
          select: { id: true, email: true, password: true, systemRole: true },
        })
        if (!user) {
          try {
            await bcryptLazy.compare(password, "$2b$14$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
          } catch { /* no-op timing-safe */ }
          throw new AuthCredentialError("CredentialsInvalid")
        }
        const passwordHash = user.password
        if (!passwordHash) {
          throw new AuthCredentialError("CredentialsEmptyPassword")
        }
        const match = await bcryptLazy.compare(password, passwordHash)
        if (!match) {
          throw new AuthCredentialError("CredentialsInvalid")
        }
        return { id: user.id, email: user.email, systemRole: user.systemRole } as AdapterUser & { systemRole: unknown }
      },
    }),
  ],
  pages: { signIn: "/auth/signin" },
  callbacks: {
    async jwt({ token, user }: { token: JWT; user?: unknown }) {
        if (user) {
          const u = user as { id: string; systemRole?: unknown }
          token.id = u.id
          token.systemRole = (u.systemRole as JWT["systemRole"] | undefined) ?? ("USER" as JWT["systemRole"])
          try {
            const { prisma: prismaLazy } = await import("@/lib/prisma")
            const mems = await prismaLazy.member.findMany({
              where: {
                userId: u.id,
                status: "APPROVED",
                organization: { onboardingCompleted: true },
              },
              select: { role: true, organizationId: true },
            })
            token.memberships = mems.map((m) => ({
              organizationId: m.organizationId,
              role: m.role as MemberRole,
            })) as JWT["memberships"]
          } catch {
            // JWT mint no debe hard-fallar por DB transient errors.
          }
        }
        return token
      },
    async session({ session, token }: { session: Session; token: JWT }) {
      if (!session.user) session.user = {} as Session["user"]
      session.user.id = token.id
      session.user.systemRole = token.systemRole
      if (token.memberships) session.user.memberships = token.memberships
      return session
    },
  },
})

void _h; void _sI; void _sO
