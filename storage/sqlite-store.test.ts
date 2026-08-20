import DatabaseConstructor from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { runStoreContract } from './port-contract.js'
import { SqliteStore } from './sqlite-store.js'

runStoreContract('SQLite', () => new SqliteStore(new DatabaseConstructor(':memory:')))

describe('SqliteStore — beyond the shared contract', () => {
  it('persists across a fresh adapter instance over the same database', async () => {
    const db = new DatabaseConstructor(':memory:')
    await new SqliteStore(db).createUser({
      id: 'user-1',
      displayName: 'João',
      isAdmin: true,
      foldThresholdDays: 90,
      stallThresholdDays: 21,
      aiBaseUrl: null,
      aiApiKey: null,
      aiModel: null,
      compensationDisplay: 'annual',
    })
    const reopened = new SqliteStore(db)
    expect((await reopened.loadUserRecord('user-1'))?.user.displayName).toBe('João')
  })

  it('runs its migration only once against an already-migrated database', () => {
    const db = new DatabaseConstructor(':memory:')
    new SqliteStore(db)
    expect(() => new SqliteStore(db)).not.toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(5)
  })

  it('refuses a Standing Terms row whose Position does not exist', async () => {
    const store = new SqliteStore(new DatabaseConstructor(':memory:'))
    await store.createUser({
      id: 'user-1',
      displayName: 'João',
      isAdmin: true,
      foldThresholdDays: 90,
      stallThresholdDays: 21,
      aiBaseUrl: null,
      aiApiKey: null,
      aiModel: null,
      compensationDisplay: 'annual',
    })
    await expect(
      store.writeStandingTerms({
        id: 'st-1',
        positionId: 'no-such-position',
        effectiveDate: '2021-05-01',
        title: 'Backend Engineer',
        employmentType: 'pj',
        baseSalaryMinor: 6_400_000,
        targetBonusMinor: 0,
      }),
    ).rejects.toThrow('no Position')
  })
})

describe('SqliteStore — auth', () => {
  function freshStore(): SqliteStore {
    return new SqliteStore(new DatabaseConstructor(':memory:'))
  }

  async function seededUser(store: SqliteStore, id = 'user-1', displayName = 'João'): Promise<void> {
    await store.createUser({
      id,
      displayName,
      isAdmin: true,
      foldThresholdDays: 90,
      stallThresholdDays: 21,
      aiBaseUrl: null,
      aiApiKey: null,
      aiModel: null,
      compensationDisplay: 'annual',
    })
  }

  it('has no User until one is created, and closes for good once one exists', async () => {
    const store = freshStore()
    expect(await store.hasAnyUser()).toBe(false)
    await seededUser(store)
    expect(await store.hasAnyUser()).toBe(true)
  })

  it('finds a User by display name, or answers undefined', async () => {
    const store = freshStore()
    await seededUser(store)
    expect((await store.findUserByDisplayName('João'))?.id).toBe('user-1')
    expect(await store.findUserByDisplayName('nobody')).toBeUndefined()
  })

  it('lists every User', async () => {
    const store = freshStore()
    await seededUser(store, 'user-1', 'João')
    await seededUser(store, 'user-2', 'Ana')
    expect((await store.allUsers()).map((user) => user.displayName).sort()).toEqual(['Ana', 'João'])
  })

  it('has no password hash until one is set, then reads back exactly what was set', async () => {
    const store = freshStore()
    await seededUser(store)
    expect(await store.passwordHashFor('user-1')).toBeUndefined()
    await store.setPasswordHash('user-1', 'argon2-hash-goes-here')
    expect(await store.passwordHashFor('user-1')).toBe('argon2-hash-goes-here')
  })

  it('never puts the password hash on the User domain object', async () => {
    const store = freshStore()
    await seededUser(store)
    await store.setPasswordHash('user-1', 'argon2-hash-goes-here')
    const user = (await store.loadUserRecord('user-1'))?.user as unknown as Record<string, unknown>
    expect(user['passwordHash']).toBeUndefined()
    expect(user['password_hash']).toBeUndefined()
  })

  it('refuses to set a password hash for a User that does not exist', async () => {
    const store = freshStore()
    await expect(store.setPasswordHash('no-such-user', 'hash')).rejects.toThrow('no User')
  })

  it('creates, reads and deletes a Session', async () => {
    const store = freshStore()
    await seededUser(store)
    const session = { token: 'tok-1', userId: 'user-1', createdAt: '2026-08-19', expiresAt: '2026-09-18' }
    await store.createSession(session)
    expect(await store.session('tok-1')).toEqual(session)
    await store.deleteSession('tok-1')
    expect(await store.session('tok-1')).toBeUndefined()
  })

  it('deletes every Session for a User, leaving another User untouched', async () => {
    const store = freshStore()
    await seededUser(store, 'user-1', 'João')
    await seededUser(store, 'user-2', 'Ana')
    await store.createSession({ token: 'tok-1', userId: 'user-1', createdAt: '2026-08-19', expiresAt: '2026-09-18' })
    await store.createSession({ token: 'tok-2', userId: 'user-1', createdAt: '2026-08-19', expiresAt: '2026-09-18' })
    await store.createSession({ token: 'tok-3', userId: 'user-2', createdAt: '2026-08-19', expiresAt: '2026-09-18' })
    await store.deleteSessionsForUser('user-1')
    expect(await store.session('tok-1')).toBeUndefined()
    expect(await store.session('tok-2')).toBeUndefined()
    expect(await store.session('tok-3')).toBeDefined()
  })

  it('creates, reads, lists and deletes an Invite', async () => {
    const store = freshStore()
    await seededUser(store)
    const invite = { code: 'inv-1', createdBy: 'user-1', createdAt: '2026-08-19' }
    await store.createInvite(invite)
    expect(await store.invite('inv-1')).toEqual(invite)
    expect(await store.invites()).toEqual([invite])
    await store.deleteInvite('inv-1')
    expect(await store.invite('inv-1')).toBeUndefined()
    expect(await store.invites()).toEqual([])
  })
})
