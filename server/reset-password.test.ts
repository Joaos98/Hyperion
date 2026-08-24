import DatabaseConstructor from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type { Session } from '../storage/sqlite-store.js'
import { SqliteStore } from '../storage/sqlite-store.js'
import type { User } from '../domain/index.js'
import { hashPassword, verifyPassword } from './auth.js'
import { resetPassword } from './reset-password.js'

const USER: User = {
  id: 'admin',
  displayName: 'You',
  isAdmin: true,
  foldThresholdDays: 90,
  stallThresholdDays: 21,
  aiBaseUrl: null,
  aiApiKey: null,
  aiModel: null,
  compensationDisplay: 'annual',
  displayCurrency: null,
}

async function seeded(): Promise<SqliteStore> {
  const store = new SqliteStore(new DatabaseConstructor(':memory:'))
  await store.createUser(USER)
  await store.setPasswordHash(USER.id, await hashPassword('the old password'))
  return store
}

function session(token: string): Session {
  return { token, userId: USER.id, createdAt: '2026-08-24', expiresAt: '2099-01-01' }
}

describe('the break-glass password reset', () => {
  it('replaces the password, so the new one verifies and the old one no longer does', async () => {
    const store = await seeded()
    await resetPassword(store, 'You', 'a new password')

    const hash = await store.passwordHashFor(USER.id)
    expect(hash).toBeDefined()
    expect(await verifyPassword(hash!, 'a new password')).toBe(true)
    expect(await verifyPassword(hash!, 'the old password')).toBe(false)
  })

  it('signs out every existing Session — a reset that left them alive would not be one', async () => {
    const store = await seeded()
    await store.createSession(session('one'))
    await store.createSession(session('two'))
    expect(await store.session('one')).toBeDefined()

    await resetPassword(store, 'You', 'a new password')

    expect(await store.session('one')).toBeUndefined()
    expect(await store.session('two')).toBeUndefined()
  })

  it('refuses an unknown display name, and changes nothing', async () => {
    const store = await seeded()
    await expect(resetPassword(store, 'Nobody', 'a new password')).rejects.toThrow('No account named "Nobody"')

    const hash = await store.passwordHashFor(USER.id)
    expect(await verifyPassword(hash!, 'the old password')).toBe(true)
  })

  it('refuses an empty password rather than locking the account out for good', async () => {
    const store = await seeded()
    await expect(resetPassword(store, 'You', '')).rejects.toThrow('A new password is required')

    const hash = await store.passwordHashFor(USER.id)
    expect(await verifyPassword(hash!, 'the old password')).toBe(true)
  })

  it('resets a non-Admin too — whoever holds the database file already holds every record in it', async () => {
    const store = await seeded()
    const other: User = { ...USER, id: 'ana', displayName: 'Ana', isAdmin: false }
    await store.createUser(other)
    await store.setPasswordHash(other.id, await hashPassword('hers'))

    const reset = await resetPassword(store, 'Ana', 'a new password')
    expect(reset.id).toBe('ana')
    expect(await verifyPassword((await store.passwordHashFor('ana'))!, 'a new password')).toBe(true)
    // The Admin's own password is untouched — the command names one account and changes that one.
    expect(await verifyPassword((await store.passwordHashFor(USER.id))!, 'the old password')).toBe(true)
  })
})
