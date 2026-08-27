import NextAuth, { User, NextAuthConfig, Account } from "next-auth"
import { PrismaAdapter } from "@auth/prisma-adapter"
import GoogleProvider from "next-auth/providers/google"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "./prisma"
import bcrypt from "bcryptjs"
import crypto from "crypto"
import { JWT } from "next-auth/jwt"
import { Session } from "next-auth"
import type { Adapter, AdapterUser } from "next-auth/adapters"
import { signInSchema } from "@/schemas/auth"

import { rateLimit } from "@/lib/rate-limit"
import { getPublicHostsAllowlist, safeRedirectUrl } from "@/lib/security"
import { AUTH_RATE_LIMITS } from "@/lib/rate-limit"
import { safeErrSummarySat } from "@/lib/sat-gate-helpers"
import { PASSWORD_BCRYPT_ROUNDS, PASSWORD_REHASH_ON_LOGIN, MIN_BCRYPT_ROUNDS } from "@/lib/auth-config"

const DUMMY_CACHE_TTL_MS = 10 * 60 * 1000
let DUMMY_LAST_ROTATE_TS = 0
let DUMMY_CACHED_HASH: string | null = null

async function getDummyBcryptHash(rounds = PASSWORD_BCRYPT_ROUNDS): Promise<string> {
  const now = Date.now()
  if (DUMMY_CACHED_HASH && (now - DUMMY_LAST_ROTATE_TS) < DUMMY_CACHE_TTL_MS) {
    return DUMMY_CACHED_HASH
  }
  const h = await bcrypt.hash("dummy-" + crypto.randomBytes(20).toString("base64"), rounds)
  DUMMY_CACHED_HASH = h
  DUMMY_LAST_ROTATE_TS = now
  return h
}

function isHostTrustedStrict(hostHeader: string | null | undefined): boolean {
  try {
    const normalized = (hostHeader ?? "").trim().toLowerCase()
    if (!normalized) return false
    const publicHosts = getPublicHostsAllowlist()
    if (publicHosts.has(normalized)) return true
    const hostnameOnly = normalized.split(":")[0]
    const localHostnames = new Set(["localhost", "127.0.0.1", "::1"])
    const localPorts = new Set(["localhost:3000", "127.0.0.1:3000", "::1:3000", "localhost:3001", "127.0.0.1:3001"])
    if (localHostnames.has(hostnameOnly) || localPorts.has(normalized)) return true
    // AUTH_TRUST_HOST solo sobreescrito a mano solo si también se habilita FLIGHT_FEATURE_STRICT_AUTH_TRUST = "1" (disable)
    if (process.env.FEATURE_STRICT_AUTH_TRUST === "1") return false
    if (process.env.AUTH_TRUST_HOST === "true" || process.env.NEXTAUTH_TRUST_HOST === "true") {
      return true
    }
    return false
  } catch {
    return false
  }
}

const authOptionsBase: NextAuthConfig = {
  adapter: PrismaAdapter(prisma) as Adapter,
  trustHost: false,
  useSecureCookies: process.env.NODE_ENV === "production",
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === "production" ? "__Secure-authjs.session-token" : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: { params: (p: Record<string, unknown>) => ({ ...p, redirect_uri: undefined }) }
    }),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        const parsedCredentials = signInSchema.safeParse({
          email: credentials?.email,
          password: typeof credentials?.password === "string" ? credentials.password.trim() : credentials?.password
        })

        if (!parsedCredentials.success) {
          throw new Error("Credenciales inválidas. Verifica tu correo y contraseña.")
        }

        const { email, password } = parsedCredentials.data
        const normalizedEmail = email.toLowerCase().trim()

        try {
          const { success, retryAfterMs } = await rateLimit(
            AUTH_RATE_LIMITS.signinEmail.key + ":" + normalizedEmail,
            { interval: AUTH_RATE_LIMITS.signinEmail.windowMs, limit: AUTH_RATE_LIMITS.signinEmail.limit }
          )
          if (!success) {
            const waitMin = Math.ceil((retryAfterMs || 0) / 60000)
            const human = waitMin > 0 ? ` Inténtalo de nuevo en ${Math.ceil(waitMin)} minutos.` : " Inténtalo de nuevo en unos minutos."
            throw new Error("Has excedido el número de intentos de inicio de sesión." + human)
          }
        } catch (rateError) {
          const safe = safeErrSummarySat(rateError)
          console.warn("[auth:cred-rate] rate limit unavailable skip throttle:", safe.name, safe.incidentFingerprint)
        }

        const user = await prisma.user.findUnique({
          where: { email: normalizedEmail },
          select: {
            id: true, email: true, name: true, image: true, systemRole: true,
            password: true, onboardingStep: true, onboardingData: true, emailVerified: true
          }
        })

        const uniformStart = Date.now()
        if (!user || !user.password) {
          const dummyHash = await getDummyBcryptHash()
          try { await bcrypt.compare(password, dummyHash) } catch (bcryptErr) {
            const s2 = safeErrSummarySat(bcryptErr)
            console.error("[auth:bcrypt-dummy] timing protect INACTIVA:", s2.name, s2.incidentFingerprint)
          }
          if (!user) throw new Error("Credenciales inválidas. Verifica tu correo y contraseña.")
          throw new Error("La cuenta no tiene contraseña configurada. Usa 'Olvidé mi contraseña' para crear una.")
        }

        const isPasswordValid = await bcrypt.compare(password, user.password)

        if (PASSWORD_REHASH_ON_LOGIN && isPasswordValid) {
          try {
            const m = (user.password.match(/^\$2[aby]\$(\d{2})\$/) || [])
            const currentRoundsRaw = m[1] ? Number(m[1]) : 0
            const needRehash = !Number.isFinite(currentRoundsRaw) || currentRoundsRaw < MIN_BCRYPT_ROUNDS
            if (needRehash) {
              const newHash = await bcrypt.hash(password, PASSWORD_BCRYPT_ROUNDS)
              await prisma.user.update({ where: { id: user.id }, data: { password: newHash } })
            }
          } catch (rehashErr) {
            const s = safeErrSummarySat(rehashErr)
            console.warn("[auth:rehash] safe skip (no break login):", s.name, s.incidentFingerprint)
          }
        }

        const delta = Date.now() - uniformStart
        if (delta < 220) {
          await new Promise<void>((r) => setTimeout(r, 220 - delta))
        }

        if (!isPasswordValid) {
          throw new Error("Credenciales inválidas. Verifica tu correo y contraseña.")
        }

        if (user.systemRole !== "SUPER_ADMIN") {
          const approvedMembership = await prisma.member.findFirst({
            where: { userId: user.id, status: "APPROVED" },
            select: { id: true, status: true }
          })
          if (!approvedMembership) {
            throw new Error("Tu cuenta está creada pero tu acceso a la organización aún no ha sido aprobado o la invitación expiró. Contacta al administrador.")
          }
        }

        return {
          id: user.id,
          email: user.email ?? undefined,
          name: user.name ?? undefined,
          image: user.image ?? undefined,
          systemRole: user.systemRole,
          onboardingStep: user.onboardingStep ?? undefined,
          onboardingData: user.onboardingData ?? undefined
        } as User
      }
    })
  ],
  session: { strategy: "jwt" as const },
  callbacks: {
    async jwt({ token, user }: { token: JWT; user?: User }) {
      if (user) {
        token.id = user.id!
        token.email = user.email
        token.name = user.name
        token.systemRole = (user as { systemRole?: unknown }).systemRole as JWT["systemRole"]
        token.onboardingStep = (user as { onboardingStep?: unknown }).onboardingStep as JWT["onboardingStep"]
        token.onboardingData = (user as { onboardingData?: unknown }).onboardingData as JWT["onboardingData"]
      }
      return token
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      if (token && session.user) {
        ;(session.user as { id: string }).id = token.id as string
        ;(session.user as { email: string | null }).email = token.email as string | null
        ;(session.user as { name: string | null }).name = token.name as string | null
        ;(session.user as { systemRole: unknown }).systemRole = token.systemRole
        ;(session.user as { onboardingStep: unknown }).onboardingStep = token.onboardingStep
        ;(session.user as { onboardingData: unknown }).onboardingData = token.onboardingData
      }
      return session
    },
    async redirect({ url, baseUrl }) {
      const canonicalBase = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).toString().replace(/\/$/, "") : baseUrl.replace(/\/$/, "")
      const publicHosts = getPublicHostsAllowlist()
      const SCHEME_ALLOW = new Set(["https:", "http:"])
      if (url.startsWith("/")) {
        return safeRedirectUrl(url, canonicalBase + "/dashboard")
      }
      try {
        const u = new URL(url)
        if (!SCHEME_ALLOW.has(u.protocol)) return canonicalBase
        if (process.env.NODE_ENV === "production" && u.protocol !== "https:") return canonicalBase
        const hostKey = u.host.toLowerCase()
        if (canonicalBase && new URL(canonicalBase).host.toLowerCase() === hostKey) return u.toString()
        if (publicHosts.has(hostKey)) return u.toString()
        return canonicalBase
      } catch {
        return canonicalBase
      }
    },
    async signIn({ user, account }: { user: User | AdapterUser; account?: Account | null }) {
      if (account?.provider === "credentials" && user?.id) {
        const membership = await prisma.member.findFirst({
          where: { userId: user.id as string, status: "APPROVED" }
        })
        if (!membership && (user as { systemRole?: string }).systemRole !== "SUPER_ADMIN") {
          return false
        }
      }
      return true
    }
  },
  pages: { signIn: "/auth/signin" }
}

export const { handlers, auth, signIn, signOut } = NextAuth((request) => {
  const host = request?.headers?.get?.("host")
  const trusted = isHostTrustedStrict(host)
  return { ...authOptionsBase, trustHost: trusted }
})
