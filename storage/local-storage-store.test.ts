import { describe, expect, it } from 'vitest'
import { LocalStorageStore } from './local-storage-store.js'
import { runStoreContract } from './port-contract.js'
import { StorageError } from './port.js'

/** Enough of the browser's Storage for the adapter to be exercised without a browser. */
function fakeStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => void entries.delete(key),
    setItem: (key, value) => void entries.set(key, value),
  }
}

runStoreContract('the browser’s own storage', () => new LocalStorageStore(fakeStorage()))

describe('LocalStorageStore — beyond the shared contract', () => {
  it('is empty rather than throwing when nothing has ever been written', async () => {
    const store = new LocalStorageStore(fakeStorage())
    expect(await store.loadUserRecord('user-1')).toBeUndefined()
  })

  it('ignores a stored document from an unrecognised shape', async () => {
    const storage = fakeStorage()
    storage.setItem('hyperion.records', JSON.stringify({ shape: 0, records: { 'user-1': {} } }))
    const store = new LocalStorageStore(storage)
    expect(await store.loadUserRecord('user-1')).toBeUndefined()
  })

  it('refuses to delete a Standing Terms row under a User that does not exist', async () => {
    const store = new LocalStorageStore(fakeStorage())
    await expect(store.deleteStandingTerms('nobody', 'st-1')).rejects.toThrow(StorageError)
  })

  it('persists across a fresh adapter instance over the same storage', async () => {
    const storage = fakeStorage()
    await new LocalStorageStore(storage).createUser({
      id: 'user-1',
      displayName: 'João',
      isAdmin: true,
      foldThresholdDays: 90,
      stallThresholdDays: 21,
      aiApiKey: null,
      compensationDisplay: 'annual',
    })
    const reopened = new LocalStorageStore(storage)
    expect((await reopened.loadUserRecord('user-1'))?.user.displayName).toBe('João')
  })

  it('defaults Applications, Application Events and Documents missing from an older record', async () => {
    // Exactly what a real record saved before this session added those three arrays
    // looks like: present positions and achievements, the newer fields simply absent —
    // not `null`, not `[]`, not there at all.
    const storage = fakeStorage()
    storage.setItem(
      'hyperion.records',
      JSON.stringify({
        shape: 1,
        records: {
          'user-1': {
            user: { id: 'user-1', displayName: 'João', isAdmin: true, foldThresholdDays: 90, stallThresholdDays: 21, aiApiKey: null },
            positions: [],
            standingTerms: [],
            payments: [],
            achievements: [],
          },
        },
      }),
    )
    const store = new LocalStorageStore(storage)
    const record = await store.loadUserRecord('user-1')
    expect(record?.applications).toEqual([])
    expect(record?.applicationEvents).toEqual([])
    expect(record?.documents).toEqual([])
  })
})
