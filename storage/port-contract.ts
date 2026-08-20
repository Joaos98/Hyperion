import { describe, expect, it } from 'vitest'
import type {
  Application,
  ApplicationEvent,
  Currency,
  DocumentMeta,
  Payment,
  Position,
  Round,
  StandingTerms,
  User,
} from '../domain/index.js'
import { StorageError, type HyperionStore } from './port.js'

const EUR: Currency = { code: 'EUR', symbol: '€', decimals: 2 }

function sampleUser(id = 'user-1'): User {
  return {
    id,
    displayName: 'João',
    isAdmin: true,
    foldThresholdDays: 90,
    stallThresholdDays: 21,
    aiBaseUrl: null,
    aiApiKey: null,
    aiModel: null,
    compensationDisplay: 'annual',
  }
}

function samplePosition(userId: string, id = 'pos-1'): Position {
  return { id, userId, company: 'Kestrel Systems', currency: EUR, startDate: '2021-05-01', departure: null }
}

function sampleTerms(positionId: string, id = 'st-1'): StandingTerms {
  return {
    id,
    positionId,
    effectiveDate: '2021-05-01',
    title: 'Backend Engineer',
    employmentType: 'pj',
    baseSalaryMinor: 6_400_000,
    targetBonusMinor: 0,
  }
}

function samplePayment(positionId: string, id = 'pay-1'): Payment {
  return { id, positionId, date: '2025-02-10', amountMinor: 610_000, label: 'Annual bonus' }
}

function sampleApplication(userId: string, id = 'app-1'): Application {
  return {
    id,
    userId,
    company: 'Aurora Labs',
    title: 'Staff Engineer',
    source: 'Referral',
    postingUrl: null,
    advertisedRange: { minMinor: 9_000_000, maxMinor: 11_000_000, currency: EUR },
    offeredTerms: null,
    documentId: null,
    priorApplicationId: null,
  }
}

function sampleEvent(applicationId: string, id = 'evt-1'): ApplicationEvent {
  return { id, applicationId, stage: 'applied', date: '2026-07-22', note: null }
}

function sampleRound(applicationId: string, id = 'round-1'): Round {
  return { id, applicationId, date: '2026-08-05', kind: 'interview', person: 'Sarah, Eng Manager', notes: null }
}

function sampleDocumentMeta(userId: string, id = 'doc-1'): DocumentMeta {
  return {
    id,
    userId,
    label: 'Résumé v3, backend-heavy',
    filename: 'resume-v3.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 4,
    createdAt: '2026-06-01',
  }
}

const sampleBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]) // "%PDF"

/**
 * The behaviour every `HyperionStore` adapter must have in common, run once against each
 * — the same discipline as Prometheus's `port-contract.ts`, so a rule that holds for
 * `localStorage` and not SQLite (or the reverse) fails loudly instead of surfacing as a
 * demo that drifts from the real app.
 */
export function runStoreContract(name: string, createStore: () => HyperionStore | Promise<HyperionStore>) {
  describe(`HyperionStore contract — ${name}`, () => {
    it('has no record for a User that was never created', async () => {
      const store = await createStore()
      expect(await store.loadUserRecord('nobody')).toBeUndefined()
    })

    it('creates a User with an empty record', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      const record = await store.loadUserRecord('user-1')
      expect(record?.user.displayName).toBe('João')
      expect(record?.positions).toEqual([])
      expect(record?.standingTerms).toEqual([])
      expect(record?.payments).toEqual([])
      expect(record?.achievements).toEqual([])
      expect(record?.applications).toEqual([])
      expect(record?.applicationEvents).toEqual([])
      expect(record?.documents).toEqual([])
    })

    it('refuses to create a User whose id is already taken', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      await expect(store.createUser(sampleUser())).rejects.toThrow(StorageError)
    })

    it('writes and updates a User', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      await store.writeUser({ ...sampleUser(), displayName: 'Ana', foldThresholdDays: 60 })
      const record = await store.loadUserRecord('user-1')
      expect(record?.user.displayName).toBe('Ana')
      expect(record?.user.foldThresholdDays).toBe(60)
    })

    it('holds no AI Setup until one is set, and stores all three fields once it is', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      const before = (await store.loadUserRecord('user-1'))?.user
      expect(before?.aiBaseUrl).toBeNull()
      expect(before?.aiApiKey).toBeNull()
      expect(before?.aiModel).toBeNull()
      await store.writeUser({
        ...sampleUser(),
        aiBaseUrl: 'https://api.anthropic.com/v1',
        aiApiKey: 'sk-ant-test-key',
        aiModel: 'claude-sonnet-5',
      })
      const after = (await store.loadUserRecord('user-1'))?.user
      expect(after?.aiBaseUrl).toBe('https://api.anthropic.com/v1')
      expect(after?.aiApiKey).toBe('sk-ant-test-key')
      expect(after?.aiModel).toBe('claude-sonnet-5')
    })

    it('writes a Position and reads it back on the User record', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      await store.writePosition(samplePosition('user-1'))
      const record = await store.loadUserRecord('user-1')
      expect(record?.positions).toHaveLength(1)
      expect(record?.positions[0]?.company).toBe('Kestrel Systems')
    })

    it('upserts a Position written twice rather than duplicating it', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      await store.writePosition(samplePosition('user-1'))
      await store.writePosition({ ...samplePosition('user-1'), company: 'Kestrel Systems GmbH' })
      const record = await store.loadUserRecord('user-1')
      expect(record?.positions).toHaveLength(1)
      expect(record?.positions[0]?.company).toBe('Kestrel Systems GmbH')
    })

    it('deletes a Position and cascades its Standing Terms and Payments', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      await store.writePosition(samplePosition('user-1'))
      await store.writeStandingTerms(sampleTerms('pos-1'))
      await store.writePayment(samplePayment('pos-1'))
      await store.deletePosition('user-1', 'pos-1')
      const record = await store.loadUserRecord('user-1')
      expect(record?.positions).toEqual([])
      expect(record?.standingTerms).toEqual([])
      expect(record?.payments).toEqual([])
    })

    it('refuses to delete a Position while an Achievement still belongs to it', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      await store.writePosition(samplePosition('user-1'))
      await store.writeAchievement({
        id: 'ach-1',
        userId: 'user-1',
        positionId: 'pos-1',
        date: '2026-02-12',
        text: 'Shipped the thing.',
        impact: null,
      })
      await expect(store.deletePosition('user-1', 'pos-1')).rejects.toThrow(StorageError)
      const record = await store.loadUserRecord('user-1')
      expect(record?.positions).toHaveLength(1)
      expect(record?.achievements).toHaveLength(1)
    })

    it('writes Standing Terms and Payments under their Position', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      await store.writePosition(samplePosition('user-1'))
      await store.writeStandingTerms(sampleTerms('pos-1'))
      await store.writePayment(samplePayment('pos-1'))
      const record = await store.loadUserRecord('user-1')
      expect(record?.standingTerms).toHaveLength(1)
      expect(record?.payments).toHaveLength(1)
    })

    it('deletes a single Standing Terms row without touching its siblings', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      await store.writePosition(samplePosition('user-1'))
      await store.writeStandingTerms(sampleTerms('pos-1', 'st-1'))
      await store.writeStandingTerms({ ...sampleTerms('pos-1', 'st-2'), effectiveDate: '2024-11-01' })
      await store.deleteStandingTerms('user-1', 'st-1')
      const record = await store.loadUserRecord('user-1')
      expect(record?.standingTerms.map((row) => row.id)).toEqual(['st-2'])
    })

    it('deletes a single Payment without touching its siblings', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      await store.writePosition(samplePosition('user-1'))
      await store.writePayment(samplePayment('pos-1', 'pay-1'))
      await store.writePayment(samplePayment('pos-1', 'pay-2'))
      await store.deletePayment('user-1', 'pay-1')
      const record = await store.loadUserRecord('user-1')
      expect(record?.payments.map((row) => row.id)).toEqual(['pay-2'])
    })

    it('writes and deletes an Achievement', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      await store.writePosition(samplePosition('user-1'))
      await store.writeAchievement({
        id: 'ach-1',
        userId: 'user-1',
        positionId: 'pos-1',
        date: '2026-02-12',
        text: 'Shipped the thing.',
        impact: null,
      })
      expect((await store.loadUserRecord('user-1'))?.achievements).toHaveLength(1)
      await store.deleteAchievement('user-1', 'ach-1')
      expect((await store.loadUserRecord('user-1'))?.achievements).toEqual([])
    })

    it('writes an Application and reads it back, Advertised Range included', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      await store.writeApplication(sampleApplication('user-1'))
      const record = await store.loadUserRecord('user-1')
      expect(record?.applications).toHaveLength(1)
      expect(record?.applications[0]?.advertisedRange).toEqual({
        minMinor: 9_000_000,
        maxMinor: 11_000_000,
        currency: EUR,
      })
    })

    it('upserts an Application written twice rather than duplicating it', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      await store.writeApplication(sampleApplication('user-1'))
      await store.writeApplication({ ...sampleApplication('user-1'), title: 'Principal Engineer' })
      const record = await store.loadUserRecord('user-1')
      expect(record?.applications).toHaveLength(1)
      expect(record?.applications[0]?.title).toBe('Principal Engineer')
    })

    it('writes an Application Event under its Application', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      await store.writeApplication(sampleApplication('user-1'))
      await store.writeApplicationEvent(sampleEvent('app-1'))
      const record = await store.loadUserRecord('user-1')
      expect(record?.applicationEvents).toHaveLength(1)
      expect(record?.applicationEvents[0]?.stage).toBe('applied')
    })

    it('refuses an Application Event whose Application does not exist', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      await expect(store.writeApplicationEvent(sampleEvent('no-such-application'))).rejects.toThrow(StorageError)
    })

    it('deletes an Application and cascades its Application Events', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      await store.writeApplication(sampleApplication('user-1'))
      await store.writeApplicationEvent(sampleEvent('app-1'))
      await store.deleteApplication('user-1', 'app-1')
      const record = await store.loadUserRecord('user-1')
      expect(record?.applications).toEqual([])
      expect(record?.applicationEvents).toEqual([])
    })

    it('deletes a single Application Event without touching its siblings or the Application', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      await store.writeApplication(sampleApplication('user-1'))
      await store.writeApplicationEvent(sampleEvent('app-1', 'evt-1'))
      await store.writeApplicationEvent({ ...sampleEvent('app-1', 'evt-2'), stage: 'screen', date: '2026-08-01' })
      await store.deleteApplicationEvent('user-1', 'evt-1')
      const record = await store.loadUserRecord('user-1')
      expect(record?.applicationEvents.map((row) => row.id)).toEqual(['evt-2'])
      expect(record?.applications).toHaveLength(1)
    })

    it('writes a Round under its Application', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      await store.writeApplication(sampleApplication('user-1'))
      await store.writeRound(sampleRound('app-1'))
      const record = await store.loadUserRecord('user-1')
      expect(record?.rounds).toHaveLength(1)
      expect(record?.rounds[0]?.kind).toBe('interview')
    })

    it('refuses a Round whose Application does not exist', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      await expect(store.writeRound(sampleRound('no-such-application'))).rejects.toThrow(StorageError)
    })

    it('deletes an Application and cascades its Rounds', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      await store.writeApplication(sampleApplication('user-1'))
      await store.writeRound(sampleRound('app-1'))
      await store.deleteApplication('user-1', 'app-1')
      const record = await store.loadUserRecord('user-1')
      expect(record?.applications).toEqual([])
      expect(record?.rounds).toEqual([])
    })

    it('deletes a single Round without touching its siblings or the Application', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      await store.writeApplication(sampleApplication('user-1'))
      await store.writeRound(sampleRound('app-1', 'round-1'))
      await store.writeRound({ ...sampleRound('app-1', 'round-2'), kind: 'take-home' })
      await store.deleteRound('user-1', 'round-1')
      const record = await store.loadUserRecord('user-1')
      expect(record?.rounds.map((row) => row.id)).toEqual(['round-2'])
      expect(record?.applications).toHaveLength(1)
    })

    it('upserts a Round written twice rather than duplicating it', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      await store.writeApplication(sampleApplication('user-1'))
      await store.writeRound(sampleRound('app-1'))
      await store.writeRound({ ...sampleRound('app-1'), notes: 'Went well, moving to the next round.' })
      const record = await store.loadUserRecord('user-1')
      expect(record?.rounds).toHaveLength(1)
      expect(record?.rounds[0]?.notes).toBe('Went well, moving to the next round.')
    })

    it('writes a Document’s metadata and bytes together, and reads both back', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      await store.writeDocument(sampleDocumentMeta('user-1'), sampleBytes)
      const record = await store.loadUserRecord('user-1')
      expect(record?.documents).toEqual([sampleDocumentMeta('user-1')])
      expect(await store.readDocumentBytes('user-1', 'doc-1')).toEqual(sampleBytes)
    })

    it('is undefined reading bytes for a Document that does not exist', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      expect(await store.readDocumentBytes('user-1', 'no-such-document')).toBeUndefined()
    })

    it('upserts a Document written twice rather than duplicating it', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      await store.writeDocument(sampleDocumentMeta('user-1'), sampleBytes)
      const relabelled = { ...sampleDocumentMeta('user-1'), label: 'Résumé v4' }
      await store.writeDocument(relabelled, sampleBytes)
      const record = await store.loadUserRecord('user-1')
      expect(record?.documents).toHaveLength(1)
      expect(record?.documents[0]?.label).toBe('Résumé v4')
    })

    it('deletes a Document, clearing the reference on any Application that named it', async () => {
      const store = await createStore()
      await store.createUser(sampleUser())
      await store.writeDocument(sampleDocumentMeta('user-1'), sampleBytes)
      await store.writeApplication({ ...sampleApplication('user-1'), documentId: 'doc-1' })

      await store.deleteDocument('user-1', 'doc-1')

      const record = await store.loadUserRecord('user-1')
      expect(record?.documents).toEqual([])
      expect(record?.applications[0]?.documentId).toBeNull()
      expect(await store.readDocumentBytes('user-1', 'doc-1')).toBeUndefined()
    })

    it('keeps two Users completely apart', async () => {
      const store = await createStore()
      await store.createUser(sampleUser('user-1'))
      await store.createUser(sampleUser('user-2'))
      await store.writePosition(samplePosition('user-1', 'pos-1'))
      await store.writePosition(samplePosition('user-2', 'pos-2'))
      expect((await store.loadUserRecord('user-1'))?.positions.map((p) => p.id)).toEqual(['pos-1'])
      expect((await store.loadUserRecord('user-2'))?.positions.map((p) => p.id)).toEqual(['pos-2'])
    })
  })
}
