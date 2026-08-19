import type { IncomingMessage } from 'node:http'
import { hash, verify } from '@node-rs/argon2'

/**
 * How long a Session lasts from creation, fixed rather than sliding — simple, and fine for
 * a personal or small-shared deployment (plan § Users and access: sessions in a cookie).
 */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

const COOKIE_NAME = 'hyperion_session'

/**
 * A password, hashed with Argon2id (plan § Users and access) — `@node-rs/argon2`'s own
 * default algorithm when `options` is omitted, so nothing here names it explicitly (the
 * enum it lives on is a `const enum`, which `verbatimModuleSyntax` refuses to import for
 * its numeric value alone). Never store the plain text anywhere else.
 */
export function hashPassword(password: string): Promise<string> {
  return hash(password)
}

/** Whether `password` is the one `hashed` was made from. `false` for any malformed hash rather than throwing. */
export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password)
  } catch {
    return false
  }
}

/**
 * The Session token this request carries, if any. Plain header parsing — Hyperion's server
 * runs no framework (`server/server.ts`'s own convention), so there is no cookie-jar to
 * reach for, and one cookie is all this app ever sets.
 */
export function readSessionCookie(request: IncomingMessage): string | undefined {
  const header = request.headers['cookie']
  if (!header) return undefined
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=')
    if (separator === -1) continue
    if (pair.slice(0, separator).trim() !== COOKIE_NAME) continue
    return decodeURIComponent(pair.slice(separator + 1).trim())
  }
  return undefined
}

/**
 * The `Set-Cookie` header value that signs a browser in with `token`. No `Secure`: a
 * self-hosted deployment reached over plain HTTP on a LAN, or at `http://localhost:8080`
 * straight off `docker compose up -d` (`compose.yaml`'s own framing — "keep this off the
 * public internet", no TLS story), is the deployment shape this app actually supports, and
 * a `Secure` cookie would silently break login there.
 */
export function sessionCookieHeader(token: string): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`
}

/** The `Set-Cookie` header value that signs a browser back out. */
export function clearSessionCookieHeader(): string {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
}
