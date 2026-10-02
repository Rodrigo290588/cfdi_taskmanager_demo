import http from "node:http"
import { URL } from "node:url"
import { createHash, randomBytes } from "node:crypto"

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex")
}

function req(method: string, urlStr: string, opts: { headers?: Record<string, string>; body?: Buffer | string; cookies?: Record<string, string> } = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string; setCookies: Record<string, string>; rawSetCookie: string[] }> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr)
    const cookies: Record<string, string> = opts.cookies || {}
    const cookieHdr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ")
    const defaultHeaders: Record<string, string> = {
      Host: u.host,
      Accept: "*/*",
      "User-Agent": "Mozilla/5.0 smoke/1.0",
      ...(cookieHdr ? { Cookie: cookieHdr } : {}),
    }
    const headers = { ...defaultHeaders, ...(opts.headers || {}) }
    if (opts.body) headers["Content-Length"] = String(Buffer.byteLength(Buffer.isBuffer(opts.body) ? opts.body : opts.body))
    const req = http.request({ method, hostname: u.hostname, port: Number(u.port), path: u.pathname + u.search, headers }, (res) => {
      const chunks: Buffer[] = []
      res.on("data", (c) => chunks.push(c))
      res.on("end", () => {
        const rawSC = (res.headers["set-cookie"] || []) as string[]
        const jar: Record<string, string> = {}
        for (const raw of rawSC) {
          const head = raw.split(";")[0]
          const i = head.indexOf("=")
          if (i > 0) jar[head.slice(0, i).trim()] = head.slice(i + 1).trim()
        }
        resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8"), setCookies: jar, rawSetCookie: rawSC })
      })
      res.on("error", reject)
    })
    req.on("error", reject)
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

function multipart(fields: Array<[string, string]>): { body: Buffer; boundary: string; contentType: string } {
  const boundary = "--NextAuthBoundary" + Date.now().toString(36)
  const parts: string[] = []
  for (const [k, v] of fields) {
    parts.push(boundary)
    parts.push(`Content-Disposition: form-data; name="${k}"`)
    parts.push("")
    parts.push(v)
  }
  parts.push(boundary + "--")
  parts.push("")
  const body = Buffer.from(parts.join("\r\n"), "utf8")
  return { body, boundary, contentType: `multipart/form-data; boundary=${boundary.slice(2)}` }
}

;(async function main() {
  const BASE = "http://localhost:3000"
  const SECRET_FROM_ENV = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "(no secret)"
  console.log("DEBUG: using secret from env first", SECRET_FROM_ENV.slice(0, 10) + "...")
  const jar: Record<string, string> = {}

  const r1 = await req("GET", `${BASE}/auth/signin`, { cookies: jar })
  Object.assign(jar, r1.setCookies)
  console.log("[1] GET signin cookies set:", Object.keys(r1.setCookies))

  const r2 = await req("GET", `${BASE}/api/auth/csrf`, { cookies: jar })
  let csrfJson = { csrfToken: "" }
  try { csrfJson = JSON.parse(r2.body) as { csrfToken: string } } catch {}
  Object.assign(jar, r2.setCookies)
  const csrfCookieRaw = jar["authjs.csrf-token"] || ""
  console.log("[2] csrf JSON body token=", csrfJson.csrfToken.slice(0, 12), "...")
  console.log("    csrf cookie raw (URL encoded) first 30:", csrfCookieRaw.slice(0, 30))
  const csrfCookieDecoded = decodeURIComponent(csrfCookieRaw)
  const [cookieCsrfLeft, cookieCsrfHash] = csrfCookieDecoded.split("|")
  console.log("    cookie split left=", cookieCsrfLeft?.slice(0, 12) || "", " hash=", cookieCsrfHash?.slice(0, 12) || "")
  console.log("    left matches JSON csrfToken?", cookieCsrfLeft === csrfJson.csrfToken)
  // reproduce HMAC/SHA256: @auth/core createHash (probably sha256?) let's see
  console.log("    (DEBUG LOCAL) createHash(csrfToken+SECRET).sha256 =", sha256Hex(csrfJson.csrfToken + SECRET_FROM_ENV).slice(0, 12), "...")
  console.log("    expected hash (from cookie)                =", (cookieCsrfHash || "").slice(0, 12), "...")
  console.log("    MATCH?", sha256Hex(csrfJson.csrfToken + SECRET_FROM_ENV) === cookieCsrfHash)

  // Now try TWO variants: Variant A body csrfToken = csrfJson.csrfToken (64 chars). Variant B: body csrfToken = cookie LEFT
  for (const variant of ["A", "B"] as const) {
    const token = variant === "A" ? csrfJson.csrfToken : cookieCsrfLeft || csrfJson.csrfToken
    const mp = multipart([
      ["csrfToken", token],
      ["email", "admin@itcomplements.com"],
      ["password", "Admin_Itcomplements_Demo_2026!"],
      ["callbackUrl", `${BASE}/dashboard`],
      ["json", "true"],
    ])
    const p = await req("POST", `${BASE}/api/auth/callback/credentials`, {
      cookies: jar,
      headers: {
        "Content-Type": mp.contentType,
        Origin: BASE,
        Referer: `${BASE}/auth/signin`,
        Accept: "application/json",
      },
      body: mp.body,
    })
    const loc = (p.headers["location"] as string) || ""
    Object.assign(jar, p.setCookies)
    console.log(`[variant ${variant}] POST status=${p.status} location=${loc || "(none)"}`)
    if (loc.includes("MissingCSRF") === false) {
      // SUCCESS: check session cookie
      const sess = Object.keys(p.setCookies).filter(k => k.includes("session"))
      console.log("   NEW set-cookie keys after POST:", Object.keys(p.setCookies), "sessions:", sess)
      if (sess.length > 0 || Object.keys(jar).some(k => k.includes("session"))) {
        const ca = await req("GET", `${BASE}/api/user/company-access`, { cookies: jar })
        console.log("   GET /company-access status=", ca.status, "snippet=", ca.body.slice(0, 250))
      }
      break
    }
  }
})().catch(e => { console.error(e); process.exit(1) })
