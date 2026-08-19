import DatabaseConstructor from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { bytesToBase64, type Currency, type User } from '../domain/index.js'
import { SqliteStore } from '../storage/sqlite-store.js'
import { createServer, type Deployment } from './server.js'

const EUR: Currency = { code: 'EUR', symbol: '€', decimals: 2 }
const USER: User = {
  id: 'local',
  displayName: 'You',
  isAdmin: true,
  foldThresholdDays: 90,
  stallThresholdDays: 21,
  aiApiKey: null,
  compensationDisplay: 'annual',
}

let servers: Server[] = []

afterEach(() => {
  for (const server of servers) server.close()
  servers = []
})

/** A server on a port nobody chose, which is the only way several may run at once. */
async function running(deployment: Deployment): Promise<string> {
  const server = createServer(deployment)
  servers.push(server)
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

async function seededServer(): Promise<string> {
  const store = new SqliteStore(new DatabaseConstructor(':memory:'))
  await store.createUser(USER)
  return running({ store, currentUserId: 'local' })
}

describe('the record endpoint', () => {
  it('answers null before the User has ever been seeded', async () => {
    const store = new SqliteStore(new DatabaseConstructor(':memory:'))
    const base = await running({ store, currentUserId: 'nobody-yet' })
    const response = await fetch(`${base}/api/record`)
    expect(await response.json()).toEqual({ record: null })
  })

  it('answers the seeded User with an empty record', async () => {
    const base = await seededServer()
    const response = await fetch(`${base}/api/record`)
    const body = (await response.json()) as { record: { user: User } }
    expect(body.record.user.displayName).toBe('You')
  })
})

describe('positions, standing terms, payments and achievements', () => {
  it('round-trips a Position through PUT and into the record', async () => {
    const base = await seededServer()
    const position = {
      id: 'pos-1',
      userId: 'local',
      company: 'Kestrel Systems',
      currency: EUR,
      startDate: '2021-05-01',
      departure: null,
    }
    const put = await fetch(`${base}/api/positions/pos-1`, {
      method: 'PUT',
      body: JSON.stringify({ position }),
    })
    expect(put.status).toBe(204)

    const record = (await (await fetch(`${base}/api/record`)).json()) as {
      record: { positions: unknown[] }
    }
    expect(record.record.positions).toEqual([position])
  })

  it('deletes a Position, cascading its Standing Terms', async () => {
    const base = await seededServer()
    await fetch(`${base}/api/positions/pos-1`, {
      method: 'PUT',
      body: JSON.stringify({
        position: { id: 'pos-1', userId: 'local', company: 'Kestrel', currency: EUR, startDate: '2021-05-01', departure: null },
      }),
    })
    await fetch(`${base}/api/standing-terms/st-1`, {
      method: 'PUT',
      body: JSON.stringify({
        standingTerms: {
          id: 'st-1',
          positionId: 'pos-1',
          effectiveDate: '2021-05-01',
          title: 'Backend Engineer',
          employmentType: 'pj',
          baseSalaryMinor: 6_400_000,
          targetBonusMinor: 0,
        },
      }),
    })

    const del = await fetch(`${base}/api/positions/pos-1`, { method: 'DELETE' })
    expect(del.status).toBe(204)

    const record = (await (await fetch(`${base}/api/record`)).json()) as {
      record: { positions: unknown[]; standingTerms: unknown[] }
    }
    expect(record.record.positions).toEqual([])
    expect(record.record.standingTerms).toEqual([])
  })

  it('writes and deletes an Achievement', async () => {
    const base = await seededServer()
    await fetch(`${base}/api/positions/pos-1`, {
      method: 'PUT',
      body: JSON.stringify({
        position: { id: 'pos-1', userId: 'local', company: 'Kestrel', currency: EUR, startDate: '2021-05-01', departure: null },
      }),
    })
    const achievement = {
      id: 'ach-1',
      userId: 'local',
      positionId: 'pos-1',
      date: '2026-02-12',
      text: 'Shipped the thing.',
      impact: null,
    }
    await fetch(`${base}/api/achievements/ach-1`, { method: 'PUT', body: JSON.stringify({ achievement }) })
    const withIt = (await (await fetch(`${base}/api/record`)).json()) as { record: { achievements: unknown[] } }
    expect(withIt.record.achievements).toEqual([achievement])

    await fetch(`${base}/api/achievements/ach-1`, { method: 'DELETE' })
    const withoutIt = (await (await fetch(`${base}/api/record`)).json()) as { record: { achievements: unknown[] } }
    expect(withoutIt.record.achievements).toEqual([])
  })

  it('round-trips an Application and its Application Events', async () => {
    const base = await seededServer()
    const application = {
      id: 'app-1',
      userId: 'local',
      company: 'Aurora Labs',
      title: 'Staff Engineer',
      source: 'Referral',
      postingUrl: null,
      advertisedRange: null,
      offeredTerms: null,
      documentId: null,
      priorApplicationId: null,
    }
    await fetch(`${base}/api/applications/app-1`, { method: 'PUT', body: JSON.stringify({ application }) })

    const event = { id: 'evt-1', applicationId: 'app-1', stage: 'applied', date: '2026-07-22', note: null }
    await fetch(`${base}/api/application-events/evt-1`, { method: 'PUT', body: JSON.stringify({ event }) })

    const withThem = (await (await fetch(`${base}/api/record`)).json()) as {
      record: { applications: unknown[]; applicationEvents: unknown[] }
    }
    expect(withThem.record.applications).toEqual([application])
    expect(withThem.record.applicationEvents).toEqual([event])

    await fetch(`${base}/api/applications/app-1`, { method: 'DELETE' })
    const withoutThem = (await (await fetch(`${base}/api/record`)).json()) as {
      record: { applications: unknown[]; applicationEvents: unknown[] }
    }
    expect(withoutThem.record.applications).toEqual([])
    expect(withoutThem.record.applicationEvents).toEqual([])
  })

  it('writes a Document, downloads its raw bytes, then deletes it', async () => {
    const base = await seededServer()
    const document = {
      id: 'doc-1',
      userId: 'local',
      label: 'Résumé v3',
      filename: 'resume v3.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4,
      createdAt: '2026-06-01',
    }
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]) // "%PDF"
    const bytesBase64 = bytesToBase64(bytes)

    const put = await fetch(`${base}/api/documents/doc-1`, {
      method: 'PUT',
      body: JSON.stringify({ document, bytesBase64 }),
    })
    expect(put.status).toBe(204)

    const withIt = (await (await fetch(`${base}/api/record`)).json()) as { record: { documents: unknown[] } }
    expect(withIt.record.documents).toEqual([document])

    const download = await fetch(`${base}/api/documents/doc-1/bytes`)
    expect(download.status).toBe(200)
    expect(download.headers.get('content-type')).toBe('application/pdf')
    expect(download.headers.get('content-disposition')).toContain('resume v3.pdf')
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes)

    await fetch(`${base}/api/documents/doc-1`, { method: 'DELETE' })
    const withoutIt = (await (await fetch(`${base}/api/record`)).json()) as { record: { documents: unknown[] } }
    expect(withoutIt.record.documents).toEqual([])
    expect((await fetch(`${base}/api/documents/doc-1/bytes`)).status).toBe(404)
  })
})

describe('errors', () => {
  it('answers 409 when a Standing Terms names a Position that does not exist', async () => {
    const base = await seededServer()
    const response = await fetch(`${base}/api/standing-terms/st-1`, {
      method: 'PUT',
      body: JSON.stringify({
        standingTerms: {
          id: 'st-1',
          positionId: 'no-such-position',
          effectiveDate: '2021-05-01',
          title: 'Backend Engineer',
          employmentType: 'pj',
          baseSalaryMinor: 6_400_000,
          targetBonusMinor: 0,
        },
      }),
    })
    expect(response.status).toBe(409)
  })

  it('answers 404 for a path Hyperion does not route', async () => {
    const base = await seededServer()
    const response = await fetch(`${base}/api/nonsense`)
    expect(response.status).toBe(404)
  })
})

describe('serving the built app', () => {
  function builtApp(): { root: string; remove: () => void } {
    const directory = mkdtempSync(join(tmpdir(), 'hyperion-app-'))
    const root = join(directory, 'dist')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'index.html'), '<!doctype html><div id="app"></div>')
    writeFileSync(join(directory, 'secret.txt'), 'not for the network')
    return { root, remove: () => rmSync(directory, { recursive: true, force: true }) }
  }

  it('serves index.html for an unbuilt route, so client-side navigation works', async () => {
    const app = builtApp()
    try {
      const store = new SqliteStore(new DatabaseConstructor(':memory:'))
      const base = await running({ store, currentUserId: 'local', root: app.root })
      const response = await fetch(`${base}/timeline`)
      expect(await response.text()).toContain('<div id="app">')
    } finally {
      app.remove()
    }
  })

  it('never serves a file outside the built app', async () => {
    const app = builtApp()
    try {
      const store = new SqliteStore(new DatabaseConstructor(':memory:'))
      const base = await running({ store, currentUserId: 'local', root: app.root })
      const response = await fetch(`${base}/../secret.txt`)
      const text = await response.text()
      expect(text).not.toContain('not for the network')
    } finally {
      app.remove()
    }
  })
})
