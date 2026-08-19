import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { base64ToBytes, type UserId } from '../domain/index.js'
import { StorageError, type HyperionStore } from '../storage/port.js'

/**
 * The self-hosted server: the built app, and one User's rows.
 *
 * It stores what it is given and returns what it stored. It computes nothing and imports
 * no domain code beyond the id types it routes on — the engine runs in the browser in
 * both builds, and a second copy of the rules here would be a second answer waiting to
 * disagree with the first (server/server.ts in Prometheus, the same discipline).
 *
 * `currentUserId` stands in for a session until auth lands (build order step 4): every
 * request is answered as this one User, there is no login, and nothing here checks who is
 * asking. That is the last thing to change, not the first.
 */
export interface Deployment {
  store: HyperionStore
  currentUserId: UserId
  /** The built app to serve, if this deployment serves one. */
  root?: string
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
 * because the port is shaped like a web API — every one of them is a User's action,
 * always taken as `currentUserId` until there is a session to read it from instead.
 */
async function route(
  deployment: Deployment,
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
): Promise<void> {
  const { store, currentUserId } = deployment
  const at = path.split('/').slice(1).map(decodeURIComponent)
  const method = request.method ?? 'GET'

  if (at[0] === 'record' && at.length === 1 && method === 'GET') {
    return send(response, 200, { record: (await store.loadUserRecord(currentUserId)) ?? null })
  }

  if (at[0] === 'user' && at.length === 1 && method === 'PUT') {
    await store.writeUser(await asked(request, 'user'))
    return send(response, 204)
  }

  if (at[0] === 'positions' && at[1] && at.length === 2) {
    if (method === 'PUT') {
      await store.writePosition(await asked(request, 'position'))
      return send(response, 204)
    }
    if (method === 'DELETE') {
      await store.deletePosition(currentUserId, at[1])
      return send(response, 204)
    }
  }

  if (at[0] === 'standing-terms' && at[1] && at.length === 2) {
    if (method === 'PUT') {
      await store.writeStandingTerms(await asked(request, 'standingTerms'))
      return send(response, 204)
    }
    if (method === 'DELETE') {
      await store.deleteStandingTerms(currentUserId, at[1])
      return send(response, 204)
    }
  }

  if (at[0] === 'payments' && at[1] && at.length === 2) {
    if (method === 'PUT') {
      await store.writePayment(await asked(request, 'payment'))
      return send(response, 204)
    }
    if (method === 'DELETE') {
      await store.deletePayment(currentUserId, at[1])
      return send(response, 204)
    }
  }

  if (at[0] === 'achievements' && at[1] && at.length === 2) {
    if (method === 'PUT') {
      await store.writeAchievement(await asked(request, 'achievement'))
      return send(response, 204)
    }
    if (method === 'DELETE') {
      await store.deleteAchievement(currentUserId, at[1])
      return send(response, 204)
    }
  }

  if (at[0] === 'applications' && at[1] && at.length === 2) {
    if (method === 'PUT') {
      await store.writeApplication(await asked(request, 'application'))
      return send(response, 204)
    }
    if (method === 'DELETE') {
      await store.deleteApplication(currentUserId, at[1])
      return send(response, 204)
    }
  }

  if (at[0] === 'application-events' && at[1] && at.length === 2) {
    if (method === 'PUT') {
      await store.writeApplicationEvent(await asked(request, 'event'))
      return send(response, 204)
    }
    if (method === 'DELETE') {
      await store.deleteApplicationEvent(currentUserId, at[1])
      return send(response, 204)
    }
  }

  if (at[0] === 'documents' && at[1] && at.length === 2 && method === 'PUT') {
    const sent = await askedDocument(request)
    await store.writeDocument(sent.document as Parameters<HyperionStore['writeDocument']>[0], base64ToBytes(sent.bytesBase64))
    return send(response, 204)
  }

  if (at[0] === 'documents' && at[1] && at.length === 2 && method === 'DELETE') {
    await store.deleteDocument(currentUserId, at[1])
    return send(response, 204)
  }

  if (at[0] === 'documents' && at[1] && at[2] === 'bytes' && at.length === 3 && method === 'GET') {
    const record = await store.loadUserRecord(currentUserId)
    const meta = record?.documents.find((document) => document.id === at[1])
    const bytes = meta && (await store.readDocumentBytes(currentUserId, at[1]))
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
