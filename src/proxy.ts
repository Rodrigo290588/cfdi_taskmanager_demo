// Proxy / Middleware Next.js 16.2.10
// ----------------------------------------------------------------------------
// Este archivo exporta TRES nombres, por compatibilidad:
//   named `proxy`      → convención Next.js 16 (file = proxy.ts  →  page='/proxy')
//   named `middleware` → legacy para build templates alternos
//   default            → fallback final.
//
// Plantilla oficial Next (node_modules/next/dist/build/templates/middleware.js):
//   isProxy = (page === '/proxy' || page === '/src/proxy')
//   handlerUserland = isProxy ? mod.proxy : mod.middleware || mod.default
//
// Regla CRÍTICA: este archivo NUNCA debe importar @/lib/auth (arrastra prisma +
// node:crypto a un chunk EDGE wasm que NO existe) ni tampoco helpers con
// `node:crypto`. Toda lectura de session auth corre vía authMiddleware en
// src/auth-middleware.ts (standalone, JWT strategy, re-importa prisma solo en
// callbacks lazy ejecutados DENTRO del pipeline Node.js, no en build-time edge).
// ----------------------------------------------------------------------------
import type { NextRequest, NextFetchEvent, NextMiddleware } from "next/server"
import { NextResponse } from "next/server"
import type { Session } from "next-auth"
import { authMiddleware } from "@/auth-middleware"

type NextRequestWithAuth = NextRequest & { auth?: Session | null }

function withSecurityHeaders(response: NextResponse) {
  response.headers.set("X-DNS-Prefetch-Control", "on")
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
  response.headers.set("X-Frame-Options", "SAMEORIGIN")
  response.headers.set("X-Content-Type-Options", "nosniff")
  response.headers.set("Referrer-Policy", "origin-when-cross-origin")
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
  return response
}

function isAuthNextAuthInternalPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/auth/signin") ||
    pathname.startsWith("/auth/signout") ||
    pathname.startsWith("/auth/callback") ||
    pathname.startsWith("/auth/session") ||
    pathname.startsWith("/auth/providers") ||
    pathname.startsWith("/auth/csrf") ||
    pathname.startsWith("/auth/error") ||
    pathname.startsWith("/auth/forgot-password") ||
    pathname.startsWith("/auth/reset-password") ||
    pathname.startsWith("/auth/signup") ||
    pathname.startsWith("/auth/verify")
  )
}

function onRequest(req: NextRequestWithAuth) {
  const isLoggedIn = !!req.auth
  const isOnDashboard = req.nextUrl.pathname.startsWith("/dashboard")
  const isOnAdmin = req.nextUrl.pathname.startsWith("/admin")
  const isOnApi = req.nextUrl.pathname.startsWith("/api")
  const isMachineToMachineApi =
    req.nextUrl.pathname.startsWith("/api/oauth/token") ||
    req.nextUrl.pathname.startsWith("/api/external/users") ||
    req.nextUrl.pathname.startsWith("/api/external/provider-payments") ||
    req.nextUrl.pathname.startsWith("/api/external/cfdi-import")

  if (isOnApi) {
    if (req.nextUrl.pathname.startsWith("/api/auth")) {
      return withSecurityHeaders(NextResponse.next())
    }
    if (req.nextUrl.pathname.startsWith("/api/cfdi/timbrar")) {
      return withSecurityHeaders(NextResponse.next())
    }
    if (isMachineToMachineApi) {
      return withSecurityHeaders(NextResponse.next())
    }
    if (!isLoggedIn) {
      return withSecurityHeaders(NextResponse.json({ error: "Unauthorized" }, { status: 401 }))
    }
  }

  if (isOnAdmin) {
    if (!isLoggedIn) {
      return withSecurityHeaders(NextResponse.redirect(new URL("/auth/signin", req.nextUrl)))
    }
    const userRole = (req.auth?.user as { systemRole?: string } | undefined)?.systemRole
    if (userRole !== "SUPER_ADMIN" && userRole !== "ADMIN") {
      return withSecurityHeaders(NextResponse.redirect(new URL("/dashboard", req.nextUrl)))
    }
  }

  if (isOnDashboard) {
    if (!isLoggedIn) {
      return withSecurityHeaders(NextResponse.redirect(new URL("/auth/signin", req.nextUrl)))
    }
  }

  return withSecurityHeaders(NextResponse.next())
}

const wrappedAuthMiddleware = authMiddleware(onRequest) as unknown as NextMiddleware

function ensureFetchEvent(evt: NextFetchEvent | undefined): NextFetchEvent {
  if (evt) return evt
  return {
    waitUntil: (promise: Promise<unknown>) => { void promise },
    passThroughOnException: () => {},
  } as unknown as NextFetchEvent
}

export async function proxy(req: NextRequest, evt?: NextFetchEvent) {
  if (isAuthNextAuthInternalPath(req.nextUrl.pathname)) {
    return withSecurityHeaders(NextResponse.next())
  }
  return wrappedAuthMiddleware(req, ensureFetchEvent(evt))
}

export async function middleware(req: NextRequest, evt?: NextFetchEvent) {
  return proxy(req, evt)
}

export default async function defaultProxy(req: NextRequest, evt?: NextFetchEvent) {
  return proxy(req, evt)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|images/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
