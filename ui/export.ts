import type {
  Achievement,
  Application,
  ApplicationEvent,
  DocumentMeta,
  Payment,
  Position,
  Round,
  StandingTerms,
  User,
} from '../domain/index.js'
import { readDocumentBytes, record, today } from './record.js'
import { buildZip, type ZipEntry } from './zip.js'

interface ExportedRecord {
  exportedAt: string
  user: User
  positions: Position[]
  standingTerms: StandingTerms[]
  payments: Payment[]
  achievements: Achievement[]
  applications: Application[]
  applicationEvents: ApplicationEvent[]
  rounds: Round[]
  documents: DocumentMeta[]
}

/**
 * Everything Hyperion holds for the signed-in User, as one zip: `data.json` (every row,
 * Documents' metadata included) plus each Document's actual bytes under `documents/` — the
 * whole-app export the backup story promises alongside `cp hyperion.db` (hyperion-plan.md §
 * The application record: "the whole-app export becomes a zip of JSON plus files"). Reads
 * only through `record.ts`'s own state and `readDocumentBytes`, so it runs identically
 * whichever storage adapter is behind it.
 */
export async function buildExport(): Promise<Uint8Array> {
  if (!record.user) throw new Error('Nothing to export before signing in')

  const data: ExportedRecord = {
    exportedAt: today(),
    user: record.user,
    positions: [...record.positions],
    standingTerms: [...record.standingTerms],
    payments: [...record.payments],
    achievements: [...record.achievements],
    applications: [...record.applications],
    applicationEvents: [...record.applicationEvents],
    rounds: [...record.rounds],
    documents: [...record.documents],
  }

  const entries: ZipEntry[] = [{ name: 'data.json', data: encodeJson(data) }]
  for (const document of record.documents) {
    const bytes = await readDocumentBytes(document.id)
    if (bytes) entries.push({ name: `documents/${document.id}-${sanitized(document.filename)}`, data: bytes })
  }

  return buildZip(entries)
}

function encodeJson(data: ExportedRecord): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(data, null, 2))
}

/** A zip entry name is a path — a Document's own filename can't be allowed to make one. */
function sanitized(filename: string): string {
  return filename.replace(/[/\\]/g, '_')
}
