import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { mintId } from '../domain/index.js'
import { SqliteStore } from '../storage/sqlite-store.js'
import { createServer } from './server.js'

/**
 * Hyperion, self-hosted: one process, one SQLite file. The file is the whole of the
 * deployment's state, so putting it on a volume is the whole of the backup story — and
 * exporting your data from Settings is the other half, for people who would rather not
 * think about volumes at all.
 */
const database = process.env['HYPERION_DATABASE'] ?? 'data/hyperion.db'
const port = Number(process.env['PORT'] ?? 8080)
const root = process.env['HYPERION_APP'] ?? 'dist'

mkdirSync(dirname(database), { recursive: true })
const db = new Database(database)
db.pragma('journal_mode = WAL')

const store = new SqliteStore(db)

/**
 * Closes for good the moment the first User exists — the first-run window is held open by
 * this token and nothing else. Held only in memory: reprinted on every
 * restart before an Admin exists, and irrelevant after: `/api/setup` refuses outright once
 * any User is stored, whatever token it is given.
 */
const setupToken = mintId()
if (!(await store.hasAnyUser())) {
  console.log(`No account yet. Open http://localhost:${port}/setup and enter this token:\n\n  ${setupToken}\n`)
}

const server = createServer({ store, auth: store, setupToken, root })
server.listen(port, () => {
  console.log(`Hyperion is at http://localhost:${port}, keeping your record in ${database}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.close()
      process.exit(0)
    })
  })
}
