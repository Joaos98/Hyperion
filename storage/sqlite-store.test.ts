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
      aiApiKey: null,
      compensationDisplay: 'annual',
    })
    const reopened = new SqliteStore(db)
    expect((await reopened.loadUserRecord('user-1'))?.user.displayName).toBe('João')
  })

  it('runs its migration only once against an already-migrated database', () => {
    const db = new DatabaseConstructor(':memory:')
    new SqliteStore(db)
    expect(() => new SqliteStore(db)).not.toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(2)
  })

  it('refuses a Standing Terms row whose Position does not exist', async () => {
    const store = new SqliteStore(new DatabaseConstructor(':memory:'))
    await store.createUser({
      id: 'user-1',
      displayName: 'João',
      isAdmin: true,
      foldThresholdDays: 90,
      stallThresholdDays: 21,
      aiApiKey: null,
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
