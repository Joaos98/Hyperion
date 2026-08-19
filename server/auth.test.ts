import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { clearSessionCookieHeader, hashPassword, readSessionCookie, sessionCookieHeader, verifyPassword } from './auth.js'

function requestWithCookie(cookie: string | undefined): IncomingMessage {
  return { headers: { cookie } } as IncomingMessage
}

describe('hashPassword / verifyPassword', () => {
  it('hashes with Argon2id', async () => {
    const hashed = await hashPassword('correct horse battery staple')
    expect(hashed).toMatch(/^\$argon2id\$/)
  })

  it('verifies a password against its own hash', async () => {
    const hashed = await hashPassword('correct horse battery staple')
    expect(await verifyPassword(hashed, 'correct horse battery staple')).toBe(true)
  })

  it('refuses the wrong password', async () => {
    const hashed = await hashPassword('correct horse battery staple')
    expect(await verifyPassword(hashed, 'wrong password')).toBe(false)
  })

  it('answers false rather than throwing on a malformed hash', async () => {
    await expect(verifyPassword('not a real hash', 'anything')).resolves.toBe(false)
  })
})

describe('readSessionCookie', () => {
  it('reads the session token out of a single cookie', () => {
    expect(readSessionCookie(requestWithCookie('hyperion_session=tok-1'))).toBe('tok-1')
  })

  it('finds it among several cookies', () => {
    expect(readSessionCookie(requestWithCookie('theme=dark; hyperion_session=tok-1; lang=en'))).toBe('tok-1')
  })

  it('decodes a URL-encoded value', () => {
    expect(readSessionCookie(requestWithCookie('hyperion_session=a%2Fb%3Dc'))).toBe('a/b=c')
  })

  it('is undefined with no Cookie header at all', () => {
    expect(readSessionCookie(requestWithCookie(undefined))).toBeUndefined()
  })

  it('is undefined when the header carries other cookies but not this one', () => {
    expect(readSessionCookie(requestWithCookie('theme=dark'))).toBeUndefined()
  })
})

describe('sessionCookieHeader / clearSessionCookieHeader', () => {
  it('carries the token, HttpOnly, and a 30-day Max-Age', () => {
    const header = sessionCookieHeader('tok-1')
    expect(header).toContain('hyperion_session=tok-1')
    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Max-Age=2592000')
  })

  it('never sets Secure, so plain-HTTP self-hosting still logs in', () => {
    expect(sessionCookieHeader('tok-1')).not.toContain('Secure')
  })

  it('clears the cookie with Max-Age=0', () => {
    expect(clearSessionCookieHeader()).toContain('Max-Age=0')
  })
})
