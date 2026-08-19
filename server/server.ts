import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import {
  base64ToBytes,
  mintId,
  systemClock,
  type Achievement,
  type Application,
  type DocumentMeta,
  type Invite,
  type Position,
  type User,
  type UserId,
} from '../domain/index.js'
import { StorageError, type HyperionStore } from '../storage/port.js'
import type { SqliteStore } from '../storage/sqlite-store.js'
import {
  clearSessionCookieHeader,
  hashPassword,
  readSessionCookie,
  sessionCookieHeader,
  SESSION_MAX_AGE_SECONDS,
  verifyPassword,
} from './auth.js'

/**
 * The self-hosted server: the built app, and every signed-in User's rows.
 *
 * It stores what it is given and returns what it stored. It computes nothing and imports
 * no domain code beyond the id types it routes on and the auth flow's own bookkeeping — the
 * engine runs in the browser in both builds, and a second copy of the rules here would be a
 * second answer waiting to disagree with the first (server/server.ts in Prometheus, the
 * same discipline).
 *
 * `store: HyperionStore` is what every record-CRUD route uses, kept behind the port's own
 * abstraction. `auth: SqliteStore` is the same instance, typed concretely, for the
 * session/invite/credential methods only `SqliteStore` has — auth only ever runs against
 * the self-hosted SQLite deployment (plan § Users and access), so a second port interface
 * nobody else would implement was not worth inventing.
 */
export interface Deployment {
  store: HyperionStore
  auth: SqliteStore
  /** Printed to the console at boot; presenting it is what closes first-run setup. */
  setupToken: string
  /** The built app to serve, if this deployment serves one. */
  root?: string
}

/** `from`, thirty days later, at the same ISO-date granularity Sessions are stored at. */
function sessionExpiry(from: string): string {
  const date = new Date(`${from}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + SESSION_MAX_AGE_SECONDS / 86_400)
  return date.toISOString().slice(0, 10)
}

/** Mints a Session for `userId`, persists it, and sets the cookie that carries it back. */
async function signIn(deployment: Deployment, response: ServerResponse, userId: UserId): Promise<void> {
  const token = mintId()
  const createdAt = systemClock.today()
  await deployment.auth.createSession({ token, userId, createdAt, expiresAt: sessionExpiry(createdAt) })
  response.setHeader('set-cookie', sessionCookieHeader(token))
}

/** The signed-in User's id for this request, or `undefined` with no session, an unknown token, or an expired one. */
async function sessionUserId(deployment: Deployment, request: IncomingMessage): Promise<UserId | undefined> {
  const token = readSessionCookie(request)
  if (!token) return undefined
  const session = await deployment.auth.session(token)
  if (!session || session.expiresAt < systemClock.today()) return undefined
  return session.userId
}

/** The signed-in Admin for this request, or `undefined` after answering 401/403 itself. */
async function requireAdmin(deployment: Deployment, request: IncomingMessage, response: ServerResponse): Promise<User | undefined> {
  const userId = await sessionUserId(deployment, request)
  const record = userId ? await deployment.store.loadUserRecord(userId) : undefined
  if (!record) {
    send(response, 401, { error: 'Sign in first' })
    return undefined
  }
  if (!record.user.isAdmin) {
    send(response, 403, { error: 'Admins only' })
    return undefined
  }
  return record.user
}

export function createServer(deployment: Deployment): Server {
  return createHttpServer((request, response) => {
    answer(deployment, request, response).catch((cause: unknown) => {
      send(response, 500, { error: String(cause) })
    })
  })
}

async function answer(deployment: Deployment, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = new URL(request.url ?? '/', 'http://hyperion').pathname
  if (!path.startsWith('/api/')) return serveApp(deployment.root, path, response)
  try {
    await route(deployment, request, response, path.slice('/api'.length))
  } catch (cause) {
    if (cause instanceof StorageError) return send(response, 409, { error: cause.message })
    throw cause
  }
}

/**
 * The port's operations, one path each. The paths exist because HTTP needs them, not
 * because the port is shaped like a web API — every one of them is a User's action, taken
 * as whoever the Session cookie resolves to. `setup`, `login`, `register` and `session`
 * are the only paths answered without one; everything past them 401s without a valid,
 * unexpired Session.
 */
async function route(
  deployment: Deployment,
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
): Promise<void> {
  const { store, auth } = deployment
  const at = path.split('/').slice(1).map(decodeURIComponent)
  const method = request.method ?? 'GET'

  // ── public: no Session required ──────────────────────────────────────

  if (at[0] === 'setup' && at.length === 1 && method === 'POST') {
    if (await auth.hasAnyUser()) return send(response, 403, { error: 'Setup has already run' })
    const sent = (await body(request)) as { setupToken?: string; displayName?: string; password?: string }
    if (sent.setupToken !== deployment.setupToken) return send(response, 403, { error: 'Wrong setup token' })
    const displayName = sent.displayName?.trim()
    if (!displayName || !sent.password) return send(response, 400, { error: 'Display name and password are required' })
    const user: User = {
      id: mintId(),
      displayName,
      isAdmin: true,
      foldThresholdDays: 90,
      stallThresholdDays: 21,
      aiApiKey: null,
      compensationDisplay: 'monthly',
    }
    await auth.createUser(user)
    await auth.setPasswordHash(user.id, await hashPassword(sent.password))
    await signIn(deployment, response, user.id)
    return send(response, 200, { user })
  }

  if (at[0] === 'login' && at.length === 1 && method === 'POST') {
    const sent = (await body(request)) as { displayName?: string; password?: string }
    const user = sent.displayName ? await auth.findUserByDisplayName(sent.displayName) : undefined
    const hash = user ? await auth.passwordHashFor(user.id) : undefined
    const ok = hash ? await verifyPassword(hash, sent.password ?? '') : false
    if (!user || !ok) return send(response, 401, { error: 'Wrong display name or password' })
    await signIn(deployment, response, user.id)
    return send(response, 200, { user })
  }

  if (at[0] === 'register' && at.length === 1 && method === 'POST') {
    const sent = (await body(request)) as { code?: string; displayName?: string; password?: string }
    const invite = sent.code ? await auth.invite(sent.code) : undefined
    if (!invite) return send(response, 403, { error: 'This Invite is invalid or already used' })
    const displayName = sent.displayName?.trim()
    if (!displayName || !sent.password) return send(response, 400, { error: 'Display name and password are required' })
    if (await auth.findUserByDisplayName(displayName)) return send(response, 409, { error: `"${displayName}" is already taken` })
    const user: User = {
      id: mintId(),
      displayName,
      isAdmin: false,
      foldThresholdDays: 90,
      stallThresholdDays: 21,
      aiApiKey: null,
      compensationDisplay: 'annual',
    }
    await auth.createUser(user)
    await auth.setPasswordHash(user.id, await hashPassword(sent.password))
    await auth.deleteInvite(invite.code)
    await signIn(deployment, response, user.id)
    return send(response, 200, { user })
  }

  if (at[0] === 'session' && at.length === 1 && method === 'GET') {
    const userId = await sessionUserId(deployment, request)
    const record = userId ? await store.loadUserRecord(userId) : undefined
    // `setupOpen` is what lets a cold client tell "nobody signed in yet" apart from
    // "nobody has ever signed up" — the difference between routing to Login and Setup.
    return send(response, 200, { user: record?.user ?? null, setupOpen: !(await auth.hasAnyUser()) })
  }

  if (at[0] === 'logout' && at.length === 1 && method === 'POST') {
    const token = readSessionCookie(request)
    if (token) await auth.deleteSession(token)
    response.setHeader('set-cookie', clearSessionCookieHeader())
    return send(response, 204)
  }

  // ── Admin-only: each resolves and checks its own Session ────────────

  if (at[0] === 'invites' && at.length === 1 && method === 'POST') {
    const admin = await requireAdmin(deployment, request, response)
    if (!admin) return
    const invite: Invite = { code: mintId(), createdBy: admin.id, createdAt: systemClock.today() }
    await auth.createInvite(invite)
    return send(response, 200, { invite })
  }

  if (at[0] === 'invites' && at.length === 1 && method === 'GET') {
    const admin = await requireAdmin(deployment, request, response)
    if (!admin) return
    return send(response, 200, { invites: await auth.invites() })
  }

  if (at[0] === 'invites' && at[1] && at.length === 2 && method === 'DELETE') {
    const admin = await requireAdmin(deployment, request, response)
    if (!admin) return
    await auth.deleteInvite(at[1])
    return send(response, 204)
  }

  if (at[0] === 'users' && at.length === 1 && method === 'GET') {
    const admin = await requireAdmin(deployment, request, response)
    if (!admin) return
    return send(response, 200, { users: await auth.allUsers() })
  }

  if (at[0] === 'users' && at[1] && at[2] === 'reset-password' && at.length === 3 && method === 'POST') {
    const admin = await requireAdmin(deployment, request, response)
    if (!admin) return
    const sent = (await body(request)) as { newPassword?: string }
    if (!sent.newPassword) return send(response, 400, { error: 'A new password is required' })
    await auth.setPasswordHash(at[1], await hashPassword(sent.newPassword))
    await auth.deleteSessionsForUser(at[1])
    return send(response, 204)
  }

  // ── everything past here needs a valid, unexpired Session ───────────

  const userId = await sessionUserId(deployment, request)
  if (!userId) return send(response, 401, { error: 'Sign in first' })

  if (at[0] === 'record' && at.length === 1 && method === 'GET') {
    return send(response, 200, { record: (await store.loadUserRecord(userId)) ?? null })
  }

  if (at[0] === 'user' && at.length === 1 && method === 'PUT') {
    await store.writeUser(await asked(request, 'user'))
    return send(response, 204)
  }

  if (at[0] === 'change-password' && at.length === 1 && method === 'POST') {
    const sent = (await body(request)) as { currentPassword?: string; newPassword?: string }
    const hash = await auth.passwordHashFor(userId)
    const ok = hash ? await verifyPassword(hash, sent.currentPassword ?? '') : false
    if (!ok) return send(response, 401, { error: 'Wrong current password' })
    if (!sent.newPassword) return send(response, 400, { error: 'A new password is required' })
    await auth.setPasswordHash(userId, await hashPassword(sent.newPassword))
    await auth.deleteSessionsForUser(userId)
    await signIn(deployment, response, userId)
    return send(response, 204)
  }

  if (at[0] === 'positions' && at[1] && at.length === 2) {
    if (method === 'PUT') {
      const position = await asked<Position>(request, 'position')
      if (position.userId !== userId) return send(response, 403, { error: "Cannot write another User's Position" })
      await store.writePosition(position)
      return send(response, 204)
    }
    if (method === 'DELETE') {
      await store.deletePosition(userId, at[1])
      return send(response, 204)
    }
  }

  if (at[0] === 'standing-terms' && at[1] && at.length === 2) {
    if (method === 'PUT') {
      await store.writeStandingTerms(await asked(request, 'standingTerms'))
      return send(response, 204)
    }
    if (method === 'DELETE') {
      await store.deleteStandingTerms(userId, at[1])
      return send(response, 204)
    }
  }

  if (at[0] === 'payments' && at[1] && at.length === 2) {
    if (method === 'PUT') {
      await store.writePayment(await asked(request, 'payment'))
      return send(response, 204)
    }
    if (method === 'DELETE') {
      await store.deletePayment(userId, at[1])
      return send(response, 204)
    }
  }

  if (at[0] === 'achievements' && at[1] && at.length === 2) {
    if (method === 'PUT') {
      const achievement = await asked<Achievement>(request, 'achievement')
      if (achievement.userId !== userId) return send(response, 403, { error: "Cannot write another User's Achievement" })
      await store.writeAchievement(achievement)
      return send(response, 204)
    }
    if (method === 'DELETE') {
      await store.deleteAchievement(userId, at[1])
      return send(response, 204)
    }
  }

  if (at[0] === 'applications' && at[1] && at.length === 2) {
    if (method === 'PUT') {
      const application = await asked<Application>(request, 'application')
      if (application.userId !== userId) return send(response, 403, { error: "Cannot write another User's Application" })
      await store.writeApplication(application)
      return send(response, 204)
    }
    if (method === 'DELETE') {
      await store.deleteApplication(userId, at[1])
      return send(response, 204)
    }
  }

  if (at[0] === 'application-events' && at[1] && at.length === 2) {
    if (method === 'PUT') {
      await store.writeApplicationEvent(await asked(request, 'event'))
      return send(response, 204)
    }
    if (method === 'DELETE') {
      await store.deleteApplicationEvent(userId, at[1])
      return send(response, 204)
    }
  }

  if (at[0] === 'documents' && at[1] && at.length === 2 && method === 'PUT') {
    const sent = await askedDocument(request)
    const document = sent.document as DocumentMeta
    if (document.userId !== userId) return send(response, 403, { error: "Cannot write another User's Document" })
    await store.writeDocument(document, base64ToBytes(sent.bytesBase64))
    return send(response, 204)
  }

  if (at[0] === 'documents' && at[1] && at.length === 2 && method === 'DELETE') {
    await store.deleteDocument(userId, at[1])
    return send(response, 204)
  }

  if (at[0] === 'documents' && at[1] && at[2] === 'bytes' && at.length === 3 && method === 'GET') {
    const record = await store.loadUserRecord(userId)
    const meta = record?.documents.find((document) => document.id === at[1])
    const bytes = meta && (await store.readDocumentBytes(userId, at[1]))
    if (!meta || !bytes) return send(response, 404, { error: `Hyperion has no Document "${at[1]}"` })
    response.writeHead(200, {
      'content-type': meta.mimeType,
      'content-disposition': `attachment; filename="${meta.filename.replace(/"/g, '')}"`,
      'content-length': bytes.byteLength,
    })
    return void response.end(Buffer.from(bytes))
  }

  send(response, 404, { error: `Hyperion has nothing at ${path}` })
}

/** The whole of what the client sent, parsed once. */
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  } catch (cause) {
    throw new StorageError(`Hyperion could not read what was sent: ${String(cause)}`)
  }
}

/** What the client sent, under the one name this operation expects. */
async function asked<T>(request: IncomingMessage, name: string): Promise<T> {
  const sent = await body(request)
  if (!sent || !(name in sent)) throw new StorageError(`What was sent carried no ${name}`)
  return sent[name] as T
}

/** A Document's write carries its metadata and its bytes as two names in one body. */
async function askedDocument(request: IncomingMessage): Promise<{ document: unknown; bytesBase64: string }> {
  const sent = await body(request)
  if (!sent || !('document' in sent) || !('bytesBase64' in sent)) {
    throw new StorageError('What was sent carried no document or no bytesBase64')
  }
  return { document: sent['document'], bytesBase64: sent['bytesBase64'] as string }
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

/**
 * The built app. Anything the build did not produce is answered with the app itself, so
 * a Position's address typed straight into the bar opens Hyperion rather than a 404.
 */
async function serveApp(root: string | undefined, path: string, response: ServerResponse): Promise<void> {
  if (!root) return send(response, 404, { error: 'This deployment serves no app' })
  const built = resolve(root)
  const file = withinRoot(built, path)
  if (file) {
    const body = await read(file)
    if (body) return sendFile(response, file, body)
  }
  const app = await read(join(built, 'index.html'))
  if (!app) return send(response, 404, { error: 'The app has not been built' })
  sendFile(response, 'index.html', app)
}

/** Keeps a request for `../../etc/passwd` inside the directory the build produced. */
function withinRoot(root: string, path: string): string | undefined {
  const file = normalize(join(root, decodeURIComponent(path)))
  return file === root || file.startsWith(root + sep) ? file : undefined
}

async function read(file: string): Promise<Buffer | undefined> {
  try {
    return await readFile(file)
  } catch {
    return undefined
  }
}

function sendFile(response: ServerResponse, file: string, body: Buffer): void {
  response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  response.end(body)
}

function send(response: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    response.writeHead(status)
    response.end()
    return
  }
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}
