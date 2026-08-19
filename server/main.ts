import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { UserId } from '../domain/index.js'
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

/**
 * Stands in for a session until auth lands (build order step 4): one User, seeded on
 * first boot, answered for every request. Real accounts, invites and login replace this
 * constant — nothing else about the server changes underneath them.
 */
const CURRENT_USER_ID: UserId = 'local'

mkdirSync(dirname(database), { recursive: true })
const db = new Database(database)
db.pragma('journal_mode = WAL')

const store = new SqliteStore(db)

await store.loadUserRecord(CURRENT_USER_ID).then(async (record) => {
  if (record) return
  await store.createUser({
    id: CURRENT_USER_ID,
    displayName: 'You',
    isAdmin: true,
    foldThresholdDays: 90,
    stallThresholdDays: 21,
    aiApiKey: null,
    compensationDisplay: 'monthly',
  })
})

const server = createServer({ store, currentUserId: CURRENT_USER_ID, root })
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
