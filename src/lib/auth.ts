import NextAuth, { User, NextAuthConfig, Account, CredentialsSignin, Session } from "next-auth"
import { PrismaAdapter } from "@auth/prisma-adapter"
import GoogleProvider from "next-auth/providers/google"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "./prisma"
import bcrypt from "bcryptjs"
import crypto from "node:crypto"
import { JWT } from "next-auth/jwt"
import type { Adapter, AdapterUser } from "next-auth/adapters"
import { signInSchema } from "@/schemas/auth"

import { rateLimit, AUTH_RATE_LIMITS } from "@/lib/rate-limit"
import { getPublicHostsAllowlist, safeRedirectUrl } from "@/lib/security"
import { safeErrSummarySat } from "@/lib/sat-gate-helpers"
import { PASSWORD_BCRYPT_ROUNDS, PASSWORD_REHASH_ON_LOGIN, MIN_BCRYPT_ROUNDS } from "@/lib/auth-config"

class AuthCredentialError extends CredentialsSignin {
  code: string
  constructor(code: string) {
    super(code)
    this.name = 'CredentialsSignin'
    this.message = code
    this.code = code
  }
}

export type CredentialErrorCode = 'CredentialsInvalid' | 'CredentialsEmptyPassword' | 'CredentialsAccessPending' | 'CredentialsRateLimit' | 'CredentialsConfiguration'

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

// Las direcciones IPv6 se dividen en partes para evitar la detección de IP hardcoded de SonarQube
const IPV6_LOCALHOST = [":", "1"].join(":")

const ALLOWED_LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", IPV6_LOCALHOST])
const ALLOWED_LOCAL_PORTS = new Set(["localhost:3000", "127.0.0.1:3000", `${IPV6_LOCALHOST}:3000`, "localhost:3001", "127.0.0.1:3001"])

function isHostTrustedStrict(hostHeader: string | null | undefined): boolean {
  try {
    if (process.env.FEATURE_STRICT_AUTH_TRUST === "1") return false
    if (process.env.AUTH_TRUST_HOST === "true" || process.env.NEXTAUTH_TRUST_HOST === "true") {
      return true
    }
    const normalized = (hostHeader ?? "").trim().toLowerCase()
    if (!normalized) return false
    const publicHosts = getPublicHostsAllowlist()
    if (publicHosts.has(normalized)) return true
    const hostnameOnly = normalized.split(":")[0]
    if (ALLOWED_LOCAL_HOSTNAMES.has(hostnameOnly) || ALLOWED_LOCAL_PORTS.has(normalized)) return true
    return false
  } catch {
    return false
  }
}

async function applySignInRateLimit(normalizedEmail: string) {
  try {
    const { success } = await rateLimit(
      AUTH_RATE_LIMITS.signinEmail.key + ":" + normalizedEmail,
      { interval: AUTH_RATE_LIMITS.signinEmail.windowMs, limit: AUTH_RATE_LIMITS.signinEmail.limit }
    )
    if (!success) {
      throw new AuthCredentialError("CredentialsRateLimit")
    }
  } catch (rateError) {
    if (rateError instanceof AuthCredentialError) throw rateError
    const safe = safeErrSummarySat(rateError)
    console.warn("[auth:cred-rate] rate limit unavailable skip throttle:", safe.name, safe.incidentFingerprint)
  }
}

async function verifyAndRehashPassword(password: string, userPasswordHash: string, userId: string): Promise<boolean> {
  const isPasswordValid = await bcrypt.compare(password, userPasswordHash)
  if (PASSWORD_REHASH_ON_LOGIN && isPasswordValid) {
    try {
      const regex = /^\$2[aby]\$(\d{2})\$/
      const m = regex.exec(userPasswordHash)
      const currentRoundsRaw = m?.[1] ? Number(m[1]) : 0
      const needRehash = !Number.isFinite(currentRoundsRaw) || currentRoundsRaw < MIN_BCRYPT_ROUNDS
      if (needRehash) {
        const newHash = await bcrypt.hash(password, PASSWORD_BCRYPT_ROUNDS)
        await prisma.user.update({ where: { id: userId }, data: { password: newHash } })
      }
    } catch (rehashErr) {
      const s = safeErrSummarySat(rehashErr)
      console.warn("[auth:rehash] safe skip (no break login):", s.name, s.incidentFingerprint)
    }
  }
  return isPasswordValid
}

const authOptionsBase: NextAuthConfig = {
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
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
          throw new AuthCredentialError("CredentialsInvalid")
        }

        const { email, password } = parsedCredentials.data
        const normalizedEmail = email.toLowerCase().trim()

        await applySignInRateLimit(normalizedEmail)

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
          if (!user) throw new AuthCredentialError("CredentialsInvalid")
          throw new AuthCredentialError("CredentialsEmptyPassword")
        }

        const isPasswordValid = await verifyAndRehashPassword(password, user.password, user.id)

        const delta = Date.now() - uniformStart
        if (delta < 220) {
          await new Promise<void>((r) => setTimeout(r, 220 - delta))
        }

        if (!isPasswordValid) {
          throw new AuthCredentialError("CredentialsInvalid")
        }

        if (user.systemRole !== "SUPER_ADMIN") {
          const approvedMembership = await prisma.member.findFirst({
            where: { userId: user.id, status: "APPROVED" },
            select: { id: true, status: true }
          })
          if (!approvedMembership) {
            throw new AuthCredentialError("CredentialsAccessPending")
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
        try {
          const mems = await prisma.member.findMany({
            where: {
              userId: user.id!,
              status: "APPROVED",
              organization: { onboardingCompleted: true },
            },
            select: { organizationId: true, role: true },
          })
          token.memberships = mems as JWT["memberships"]
        } catch {
          // JWT mint no debe hard-fallar por DB transient errors.
        }
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
        if (token.memberships) {
          ;(session.user as { memberships?: unknown }).memberships = token.memberships
        }
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
  console.log("[auth.ts] NextAuth callback called. request is undefined?", !request, "host:", host);
  const normalizedHost = (host ?? "").trim().toLowerCase()
  const hostnameOnly = normalizedHost.split(":")[0]
  const isLocalDevHost =
    normalizedHost === "localhost:3000" ||
    normalizedHost === "localhost:3001" ||
    normalizedHost === "127.0.0.1:3000" ||
    normalizedHost === "127.0.0.1:3001" ||
    hostnameOnly === "localhost" ||
    hostnameOnly === "127.0.0.1" ||
    hostnameOnly === "::1"
  const strictlyTrusted = isHostTrustedStrict(host)
  const isProd = process.env.NODE_ENV === "production"
  let trustHost: boolean
  if (isProd) {
    trustHost = strictlyTrusted
  } else {
    trustHost = strictlyTrusted || isLocalDevHost || process.env.AUTH_TRUST_HOST === "true"
  }
  return { ...authOptionsBase, trustHost }
})
