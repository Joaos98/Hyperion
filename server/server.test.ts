import DatabaseConstructor from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { bytesToBase64, type Currency, type User } from '../domain/index.js'
import { SqliteStore } from '../storage/sqlite-store.js'
import { hashPassword } from './auth.js'
import { createServer, type Deployment } from './server.js'

const EUR: Currency = { code: 'EUR', symbol: '€', decimals: 2 }
const USER: User = {
  id: 'local',
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
const PASSWORD = 'correct horse battery staple'
const SETUP_TOKEN = 'the-real-setup-token'

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

/** A fresh deployment with nobody signed up yet — first-run and register-flow tests start here. */
async function openServer(): Promise<{ base: string; store: SqliteStore }> {
  const store = new SqliteStore(new DatabaseConstructor(':memory:'))
  const base = await running({ store, auth: store, setupToken: SETUP_TOKEN })
  return { base, store }
}

/** A second, non-Admin User brought in the only way there is — an Invite the Admin generated. */
async function secondUser(base: string, adminCookie: string): Promise<string> {
  const invited = await fetch(`${base}/api/invites`, authed(adminCookie, { method: 'POST' }))
  const { invite } = (await invited.json()) as { invite: { code: string } }
  const response = await fetch(`${base}/api/register`, {
    method: 'POST',
    body: JSON.stringify({ code: invite.code, displayName: 'Ana', password: PASSWORD }),
  })
  return response.headers.get('set-cookie')!.split(';')[0]!
}

/** `Cookie` attached, so the request rides `cookie`'s Session — Node's `fetch` carries no cookie jar of its own. */
function authed(cookie: string, init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...init.headers, cookie } }
}

/** A deployment with `USER` already registered and signed in — most tests only care about what happens next. */
async function seededServer(): Promise<{ base: string; cookie: string; store: SqliteStore }> {
  const { base, store } = await openServer()
  await store.createUser(USER)
  await store.setPasswordHash(USER.id, await hashPassword(PASSWORD))
  const response = await fetch(`${base}/api/login`, {
    method: 'POST',
    body: JSON.stringify({ displayName: USER.displayName, password: PASSWORD }),
  })
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) throw new Error('login in the test setup did not set a cookie')
  return { base, cookie: setCookie.split(';')[0]!, store }
}

describe('first-run setup', () => {
  it('creates the first User as an Admin, and signs them in', async () => {
    const { base } = await openServer()
    const response = await fetch(`${base}/api/setup`, {
      method: 'POST',
      body: JSON.stringify({ setupToken: SETUP_TOKEN, displayName: 'Alex', password: PASSWORD }),
    })
    expect(response.status).toBe(200)
    const setCookie = response.headers.get('set-cookie')
    expect(setCookie).toBeTruthy()
    const created = (await response.json()) as { user: User }
    expect(created.user.isAdmin).toBe(true)
    expect(created.user.displayName).toBe('Alex')

    const record = await fetch(`${base}/api/record`, authed(setCookie!.split(';')[0]!))
    expect(record.status).toBe(200)
  })

  it('refuses the wrong setup token', async () => {
    const { base } = await openServer()
    const response = await fetch(`${base}/api/setup`, {
      method: 'POST',
      body: JSON.stringify({ setupToken: 'not-the-token', displayName: 'Alex', password: PASSWORD }),
    })
    expect(response.status).toBe(403)
  })

  it('refuses once any User already exists', async () => {
    const { base } = await seededServer()
    const response = await fetch(`${base}/api/setup`, {
      method: 'POST',
      body: JSON.stringify({ setupToken: SETUP_TOKEN, displayName: 'Someone Else', password: PASSWORD }),
    })
    expect(response.status).toBe(403)
  })
})

describe('login', () => {
  it('signs in with the right display name and password', async () => {
    const { base, store } = await openServer()
    await store.createUser(USER)
    await store.setPasswordHash(USER.id, await hashPassword(PASSWORD))
    const response = await fetch(`${base}/api/login`, {
      method: 'POST',
      body: JSON.stringify({ displayName: USER.displayName, password: PASSWORD }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toBeTruthy()
  })

  it('refuses the wrong password', async () => {
    const { base, store } = await openServer()
    await store.createUser(USER)
    await store.setPasswordHash(USER.id, await hashPassword(PASSWORD))
    const response = await fetch(`${base}/api/login`, {
      method: 'POST',
      body: JSON.stringify({ displayName: USER.displayName, password: 'wrong password' }),
    })
    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('refuses an unknown display name', async () => {
    const { base } = await openServer()
    const response = await fetch(`${base}/api/login`, {
      method: 'POST',
      body: JSON.stringify({ displayName: 'Nobody', password: PASSWORD }),
    })
    expect(response.status).toBe(401)
  })
})

describe('register via Invite', () => {
  it('creates a non-Admin User and signs them in, consuming the Invite', async () => {
    const { base, cookie } = await seededServer()
    const invited = await fetch(`${base}/api/invites`, authed(cookie, { method: 'POST' }))
    const { invite } = (await invited.json()) as { invite: { code: string } }

    const response = await fetch(`${base}/api/register`, {
      method: 'POST',
      body: JSON.stringify({ code: invite.code, displayName: 'Ana', password: PASSWORD }),
    })
    expect(response.status).toBe(200)
    const created = (await response.json()) as { user: User }
    expect(created.user.isAdmin).toBe(false)
    expect(response.headers.get('set-cookie')).toBeTruthy()

    // Spent — a second attempt with the same code fails.
    const again = await fetch(`${base}/api/register`, {
      method: 'POST',
      body: JSON.stringify({ code: invite.code, displayName: 'Someone Else', password: PASSWORD }),
    })
    expect(again.status).toBe(403)
  })

  it('refuses an unknown code', async () => {
    const { base } = await openServer()
    const response = await fetch(`${base}/api/register`, {
      method: 'POST',
      body: JSON.stringify({ code: 'no-such-code', displayName: 'Ana', password: PASSWORD }),
    })
    expect(response.status).toBe(403)
  })
})

describe('session and logout', () => {
  it('answers null and setupOpen: true with no cookie and no User yet', async () => {
    const { base } = await openServer()
    const response = await fetch(`${base}/api/session`)
    expect(await response.json()).toEqual({ user: null, setupOpen: true })
  })

  it('answers the signed-in User, and setupOpen: false once one exists', async () => {
    const { base, cookie } = await seededServer()
    const response = await fetch(`${base}/api/session`, authed(cookie))
    const body = (await response.json()) as { user: User; setupOpen: boolean }
    expect(body.user.displayName).toBe('You')
    expect(body.setupOpen).toBe(false)
  })

  it('clears the Session on logout, so the old cookie stops working', async () => {
    const { base, cookie } = await seededServer()
    const out = await fetch(`${base}/api/logout`, authed(cookie, { method: 'POST' }))
    expect(out.status).toBe(204)

    const after = await fetch(`${base}/api/record`, authed(cookie))
    expect(after.status).toBe(401)
  })

  it('treats an expired Session as no Session at all', async () => {
    const { base, store } = await openServer()
    await store.createUser(USER)
    await store.createSession({ token: 'expired-token', userId: USER.id, createdAt: '2020-01-01', expiresAt: '2020-01-02' })
    const response = await fetch(`${base}/api/record`, authed('hyperion_session=expired-token'))
    expect(response.status).toBe(401)
  })
})

describe('every protected route requires a Session', () => {
  it('401s the record endpoint with no cookie', async () => {
    const { base } = await seededServer()
    expect((await fetch(`${base}/api/record`)).status).toBe(401)
  })

  it('401s a write with no cookie', async () => {
    const { base } = await seededServer()
    const response = await fetch(`${base}/api/positions/pos-1`, {
      method: 'PUT',
      body: JSON.stringify({ position: { id: 'pos-1', userId: 'local', company: 'Kestrel', currency: EUR, startDate: '2021-05-01', departure: null } }),
    })
    expect(response.status).toBe(401)
  })
})

describe('writes cannot claim another User\'s id', () => {
  it('403s a Position write whose userId does not match the signed-in User', async () => {
    const { base, cookie } = await seededServer()
    const response = await fetch(
      `${base}/api/positions/pos-1`,
      authed(cookie, {
        method: 'PUT',
        body: JSON.stringify({
          position: { id: 'pos-1', userId: 'someone-else', company: 'Kestrel', currency: EUR, startDate: '2021-05-01', departure: null },
        }),
      }),
    )
    expect(response.status).toBe(403)
  })

  it('403s an Achievement write whose userId does not match the signed-in User', async () => {
    const { base, cookie, store } = await seededServer()
    await store.writePosition({ id: 'pos-1', userId: 'local', company: 'Kestrel', currency: EUR, startDate: '2021-05-01', departure: null })
    const response = await fetch(
      `${base}/api/achievements/ach-1`,
      authed(cookie, {
        method: 'PUT',
        body: JSON.stringify({
          achievement: { id: 'ach-1', userId: 'someone-else', positionId: 'pos-1', date: '2026-02-12', text: 'Shipped it.', impact: null },
        }),
      }),
    )
    expect(response.status).toBe(403)
  })

  it('writes a Recorded Rate and reads it back on the record', async () => {
    const { base, cookie } = await seededServer()
    const rate = { id: 'rate-1', userId: 'local', fromCode: 'USD', toCode: 'BRL', date: '2026-03-01', rateMinor: 54231, rateDecimals: 4 }
    const written = await fetch(
      `${base}/api/recorded-rates/rate-1`,
      authed(cookie, { method: 'PUT', body: JSON.stringify({ rate }) }),
    )
    expect(written.status).toBe(204)

    const loaded = await fetch(`${base}/api/record`, authed(cookie, {}))
    const { record } = (await loaded.json()) as { record: { recordedRates: unknown[] } }
    expect(record.recordedRates).toEqual([rate])
  })

  it('403s a Recorded Rate write whose userId does not match the signed-in User', async () => {
    const { base, cookie } = await seededServer()
    const response = await fetch(
      `${base}/api/recorded-rates/rate-1`,
      authed(cookie, {
        method: 'PUT',
        body: JSON.stringify({
          rate: { id: 'rate-1', userId: 'someone-else', fromCode: 'USD', toCode: 'BRL', date: '2026-03-01', rateMinor: 54231, rateDecimals: 4 },
        }),
      }),
    )
    expect(response.status).toBe(403)
  })
})

describe('admin routes', () => {
  it('creates and lists Invites', async () => {
    const { base, cookie } = await seededServer()
    await fetch(`${base}/api/invites`, authed(cookie, { method: 'POST' }))
    const list = await fetch(`${base}/api/invites`, authed(cookie))
    const { invites } = (await list.json()) as { invites: unknown[] }
    expect(invites).toHaveLength(1)
  })

  it('resets another User\'s password, signing them out everywhere', async () => {
    const { base, cookie } = await seededServer()
    const otherCookie = await secondUser(base, cookie)
    expect((await fetch(`${base}/api/session`, authed(otherCookie))).status).toBe(200)

    const users = (await (await fetch(`${base}/api/users`, authed(cookie))).json()) as { users: User[] }
    const other = users.users.find((user) => user.displayName === 'Ana')!

    const reset = await fetch(`${base}/api/users/${other.id}/reset-password`, authed(cookie, { method: 'POST', body: JSON.stringify({ newPassword: 'a new password' }) }))
    expect(reset.status).toBe(204)

    // The old Session is gone — the reset invalidated it.
    const stale = await fetch(`${base}/api/record`, authed(otherCookie))
    expect(stale.status).toBe(401)

    // The new password signs them in; the old one no longer does.
    const oldLogin = await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ displayName: 'Ana', password: PASSWORD }) })
    expect(oldLogin.status).toBe(401)
    const newLogin = await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ displayName: 'Ana', password: 'a new password' }) })
    expect(newLogin.status).toBe(200)
  })

  it('refuses a non-Admin', async () => {
    const { base, cookie } = await seededServer()
    const otherCookie = await secondUser(base, cookie)

    expect((await fetch(`${base}/api/invites`, authed(otherCookie, { method: 'POST' }))).status).toBe(403)
    expect((await fetch(`${base}/api/invites`, authed(otherCookie))).status).toBe(403)
    expect((await fetch(`${base}/api/users`, authed(otherCookie))).status).toBe(403)
  })
})

describe('writing your own settings', () => {
  async function userBehind(base: string, cookie: string): Promise<User> {
    const response = await fetch(`${base}/api/record`, authed(cookie))
    const { record } = (await response.json()) as { record: { user: User } }
    return record.user
  }

  it('saves what the settings page changes', async () => {
    const { base, cookie } = await seededServer()
    const mine = await userBehind(base, cookie)
    const put = await fetch(`${base}/api/user`, authed(cookie, { method: 'PUT', body: JSON.stringify({ user: { ...mine, stallThresholdDays: 30 } }) }))
    expect(put.status).toBe(204)
    expect((await userBehind(base, cookie)).stallThresholdDays).toBe(30)
  })

  it('will not grant the Admin bit to whoever asks for it', async () => {
    const { base, cookie } = await seededServer()
    const otherCookie = await secondUser(base, cookie)
    const ana = await userBehind(base, otherCookie)
    expect(ana.isAdmin).toBe(false)

    const put = await fetch(`${base}/api/user`, authed(otherCookie, { method: 'PUT', body: JSON.stringify({ user: { ...ana, isAdmin: true } }) }))
    expect(put.status).toBe(204)

    // The write landed, and the bit did not come with it.
    expect((await userBehind(base, otherCookie)).isAdmin).toBe(false)
    expect((await fetch(`${base}/api/users`, authed(otherCookie))).status).toBe(403)
  })

  it('writes the User behind the Session, not whichever id the body names', async () => {
    const { base, cookie } = await seededServer()
    const otherCookie = await secondUser(base, cookie)
    const admin = await userBehind(base, cookie)

    // Ana sends the Admin's own row back, renamed. It is her settings that move, not theirs.
    const put = await fetch(`${base}/api/user`, authed(otherCookie, { method: 'PUT', body: JSON.stringify({ user: { ...admin, displayName: 'Taken', foldThresholdDays: 7 } }) }))
    expect(put.status).toBe(204)

    const stillAdmin = await userBehind(base, cookie)
    expect(stillAdmin.displayName).toBe(USER.displayName)
    expect(stillAdmin.foldThresholdDays).toBe(USER.foldThresholdDays)

    const ana = await userBehind(base, otherCookie)
    expect(ana.foldThresholdDays).toBe(7)
    expect(ana.isAdmin).toBe(false)
  })
})

describe('changing your own password', () => {
  it('signs the current browser back in, but invalidates every other Session', async () => {
    const { base, cookie } = await seededServer()
    const response = await fetch(
      `${base}/api/change-password`,
      authed(cookie, { method: 'POST', body: JSON.stringify({ currentPassword: PASSWORD, newPassword: 'a new password' }) }),
    )
    expect(response.status).toBe(204)
    const freshCookie = response.headers.get('set-cookie')!.split(';')[0]!

    // The old cookie no longer works — its Session was deleted along with every other one.
    expect((await fetch(`${base}/api/record`, authed(cookie))).status).toBe(401)
    // The fresh one this response set does.
    expect((await fetch(`${base}/api/record`, authed(freshCookie))).status).toBe(200)
  })

  it('refuses the wrong current password', async () => {
    const { base, cookie } = await seededServer()
    const response = await fetch(
      `${base}/api/change-password`,
      authed(cookie, { method: 'POST', body: JSON.stringify({ currentPassword: 'wrong', newPassword: 'a new password' }) }),
    )
    expect(response.status).toBe(401)
  })
})

describe('positions, standing terms, payments and achievements', () => {
  it('round-trips a Position through PUT and into the record', async () => {
    const { base, cookie } = await seededServer()
    const position = {
      id: 'pos-1',
      userId: 'local',
      company: 'Kestrel Systems',
      currency: EUR,
      startDate: '2021-05-01',
      departure: null,
    }
    const put = await fetch(`${base}/api/positions/pos-1`, authed(cookie, { method: 'PUT', body: JSON.stringify({ position }) }))
    expect(put.status).toBe(204)

    const record = (await (await fetch(`${base}/api/record`, authed(cookie))).json()) as {
      record: { positions: unknown[] }
    }
    expect(record.record.positions).toEqual([position])
  })

  it('deletes a Position, cascading its Standing Terms', async () => {
    const { base, cookie } = await seededServer()
    await fetch(
      `${base}/api/positions/pos-1`,
      authed(cookie, {
        method: 'PUT',
        body: JSON.stringify({
          position: { id: 'pos-1', userId: 'local', company: 'Kestrel', currency: EUR, startDate: '2021-05-01', departure: null },
        }),
      }),
    )
    await fetch(
      `${base}/api/standing-terms/st-1`,
      authed(cookie, {
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
      }),
    )

    const del = await fetch(`${base}/api/positions/pos-1`, authed(cookie, { method: 'DELETE' }))
    expect(del.status).toBe(204)

    const record = (await (await fetch(`${base}/api/record`, authed(cookie))).json()) as {
      record: { positions: unknown[]; standingTerms: unknown[] }
    }
    expect(record.record.positions).toEqual([])
    expect(record.record.standingTerms).toEqual([])
  })

  it('writes and deletes an Achievement', async () => {
    const { base, cookie } = await seededServer()
    await fetch(
      `${base}/api/positions/pos-1`,
      authed(cookie, {
        method: 'PUT',
        body: JSON.stringify({
          position: { id: 'pos-1', userId: 'local', company: 'Kestrel', currency: EUR, startDate: '2021-05-01', departure: null },
        }),
      }),
    )
    const achievement = {
      id: 'ach-1',
      userId: 'local',
      positionId: 'pos-1',
      date: '2026-02-12',
      text: 'Shipped the thing.',
      impact: null,
    }
    await fetch(`${base}/api/achievements/ach-1`, authed(cookie, { method: 'PUT', body: JSON.stringify({ achievement }) }))
    const withIt = (await (await fetch(`${base}/api/record`, authed(cookie))).json()) as { record: { achievements: unknown[] } }
    expect(withIt.record.achievements).toEqual([achievement])

    await fetch(`${base}/api/achievements/ach-1`, authed(cookie, { method: 'DELETE' }))
    const withoutIt = (await (await fetch(`${base}/api/record`, authed(cookie))).json()) as { record: { achievements: unknown[] } }
    expect(withoutIt.record.achievements).toEqual([])
  })

  it('round-trips an Application and its Application Events', async () => {
    const { base, cookie } = await seededServer()
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
    await fetch(`${base}/api/applications/app-1`, authed(cookie, { method: 'PUT', body: JSON.stringify({ application }) }))

    const event = { id: 'evt-1', applicationId: 'app-1', stage: 'applied', date: '2026-07-22', note: null }
    await fetch(`${base}/api/application-events/evt-1`, authed(cookie, { method: 'PUT', body: JSON.stringify({ event }) }))

    const withThem = (await (await fetch(`${base}/api/record`, authed(cookie))).json()) as {
      record: { applications: unknown[]; applicationEvents: unknown[] }
    }
    expect(withThem.record.applications).toEqual([application])
    expect(withThem.record.applicationEvents).toEqual([event])

    await fetch(`${base}/api/applications/app-1`, authed(cookie, { method: 'DELETE' }))
    const withoutThem = (await (await fetch(`${base}/api/record`, authed(cookie))).json()) as {
      record: { applications: unknown[]; applicationEvents: unknown[] }
    }
    expect(withoutThem.record.applications).toEqual([])
    expect(withoutThem.record.applicationEvents).toEqual([])
  })

  it('round-trips a Round under its Application, then deletes it', async () => {
    const { base, cookie } = await seededServer()
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
    await fetch(`${base}/api/applications/app-1`, authed(cookie, { method: 'PUT', body: JSON.stringify({ application }) }))

    const round = { id: 'round-1', applicationId: 'app-1', date: '2026-08-05', kind: 'interview', person: 'Sarah', notes: null }
    const put = await fetch(`${base}/api/rounds/round-1`, authed(cookie, { method: 'PUT', body: JSON.stringify({ round }) }))
    expect(put.status).toBe(204)

    const withIt = (await (await fetch(`${base}/api/record`, authed(cookie))).json()) as { record: { rounds: unknown[] } }
    expect(withIt.record.rounds).toEqual([round])

    await fetch(`${base}/api/rounds/round-1`, authed(cookie, { method: 'DELETE' }))
    const withoutIt = (await (await fetch(`${base}/api/record`, authed(cookie))).json()) as { record: { rounds: unknown[] } }
    expect(withoutIt.record.rounds).toEqual([])
  })

  it('writes a Document, downloads its raw bytes, then deletes it', async () => {
    const { base, cookie } = await seededServer()
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

    const put = await fetch(`${base}/api/documents/doc-1`, authed(cookie, { method: 'PUT', body: JSON.stringify({ document, bytesBase64 }) }))
    expect(put.status).toBe(204)

    const withIt = (await (await fetch(`${base}/api/record`, authed(cookie))).json()) as { record: { documents: unknown[] } }
    expect(withIt.record.documents).toEqual([document])

    const download = await fetch(`${base}/api/documents/doc-1/bytes`, authed(cookie))
    expect(download.status).toBe(200)
    expect(download.headers.get('content-type')).toBe('application/pdf')
    expect(download.headers.get('content-disposition')).toContain('resume v3.pdf')
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes)

    await fetch(`${base}/api/documents/doc-1`, authed(cookie, { method: 'DELETE' }))
    const withoutIt = (await (await fetch(`${base}/api/record`, authed(cookie))).json()) as { record: { documents: unknown[] } }
    expect(withoutIt.record.documents).toEqual([])
    expect((await fetch(`${base}/api/documents/doc-1/bytes`, authed(cookie))).status).toBe(404)
  })
})

describe('errors', () => {
  it('answers 409 when a Standing Terms names a Position that does not exist', async () => {
    const { base, cookie } = await seededServer()
    const response = await fetch(
      `${base}/api/standing-terms/st-1`,
      authed(cookie, {
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
      }),
    )
    expect(response.status).toBe(409)
  })

  it('answers 404 for a path Hyperion does not route', async () => {
    const { base, cookie } = await seededServer()
    const response = await fetch(`${base}/api/nonsense`, authed(cookie))
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
      const base = await running({ store, auth: store, setupToken: SETUP_TOKEN, root: app.root })
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
      const base = await running({ store, auth: store, setupToken: SETUP_TOKEN, root: app.root })
      const response = await fetch(`${base}/../secret.txt`)
      const text = await response.text()
      expect(text).not.toContain('not for the network')
    } finally {
      app.remove()
    }
  })
})
