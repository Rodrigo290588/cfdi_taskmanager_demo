import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"

function withSecurityHeaders(response: NextResponse) {
  response.headers.set("X-DNS-Prefetch-Control", "on")
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
  response.headers.set("X-Frame-Options", "SAMEORIGIN")
  response.headers.set("X-Content-Type-Options", "nosniff")
  response.headers.set("Referrer-Policy", "origin-when-cross-origin")
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
  return response
}

export default auth((req) => {
  const isLoggedIn = !!req.auth
  const isOnDashboard = req.nextUrl.pathname.startsWith("/dashboard")
  const isOnAdmin = req.nextUrl.pathname.startsWith("/admin")
  const isOnApi = req.nextUrl.pathname.startsWith("/api")

  // 1. API Protection
  if (isOnApi) {
    // Whitelist public API routes
    if (req.nextUrl.pathname.startsWith("/api/auth")) {
      return withSecurityHeaders(NextResponse.next())
    }
    // API Key protected routes (handled by route logic, but we pass them through)
    if (req.nextUrl.pathname.startsWith("/api/cfdi/timbrar")) {
      return withSecurityHeaders(NextResponse.next())
    }

    // Permitir ingesta masiva (podría requerir API Key en el futuro, pero por ahora whitelisted)
    if (req.nextUrl.pathname.startsWith("/api/import")) {
      return withSecurityHeaders(NextResponse.next())
    }
    
    // Default API protection: Require session
    if (!isLoggedIn) {
      return withSecurityHeaders(NextResponse.json({ error: "Unauthorized" }, { status: 401 }))
    }
  }

  // 2. Admin Protection
  if (isOnAdmin) {
    if (!isLoggedIn) {
      return withSecurityHeaders(NextResponse.redirect(new URL("/auth/signin", req.nextUrl)))
    }
    // Strict Role Check
    const userRole = req.auth?.user?.systemRole
    if (userRole !== "SUPER_ADMIN" && userRole !== "ADMIN") {
      // Redirect to dashboard if logged in but not admin
      return withSecurityHeaders(NextResponse.redirect(new URL("/dashboard", req.nextUrl)))
    }
  }

  // 3. Dashboard Protection
  if (isOnDashboard) {
    if (!isLoggedIn) {
      return withSecurityHeaders(NextResponse.redirect(new URL("/auth/signin", req.nextUrl)))
    }
  }

  return withSecurityHeaders(NextResponse.next())
})

// Configure matcher to run middleware on specific paths
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth (handled above but excluded from matcher for performance if needed, but we keep it to be safe)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc - assuming they are in public folder and served at root)
     */
    "/((?!_next/static|_next/image|favicon.ico|images/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
