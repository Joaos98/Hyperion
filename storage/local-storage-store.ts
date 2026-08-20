import {
  base64ToBytes,
  bytesToBase64,
  type Achievement,
  type AchievementId,
  type Application,
  type ApplicationEvent,
  type ApplicationEventId,
  type ApplicationId,
  type DocumentId,
  type DocumentMeta,
  type Payment,
  type PaymentId,
  type Position,
  type PositionId,
  type RecordedRate,
  type RecordedRateId,
  type Round,
  type RoundId,
  type StandingTerms,
  type StandingTermsId,
  type User,
  type UserId,
} from '../domain/index.js'
import { StorageError, type HyperionStore, type UserRecord } from './port.js'

const KEY = 'hyperion.records'

/**
 * Document bytes, base64-encoded, in a key of their own rather than folded into
 * `KEY`. Every write anywhere in this adapter re-serialises the whole of `KEY`'s
 * document — fine for the plain data every other row is, wrong for potentially
 * megabytes of file content that would otherwise be re-parsed and re-stringified on
 * every unrelated write, from logging an Achievement on up.
 */
const BYTES_KEY = 'hyperion.document-bytes'

/**
 * The shape the browser's storage is written in today. Every schema change is paid in
 * both adapters, and the stored document says which shape it is rather than leaving a
 * later version to guess from what it finds (storage/local-storage-store.ts in
 * Prometheus, the same convention).
 */
const SHAPE = 1

interface StoredDocument {
  shape: number
  records: Record<UserId, UserRecord>
}

/**
 * What a User's record read out of storage needs before the rest of this adapter is
 * handed it — a read-side default, not a migration (storage/stored.ts in Prometheus, the
 * same reasoning): a record written before this session added Applications, Application
 * Events or Documents to `UserRecord` is missing those arrays entirely, and every method
 * below trusts `HyperionStore`'s own contract that they are always present. One boundary,
 * crossed once, rather than an optional-chain defending every call site that reads them.
 * Nothing is written back; the record is saved in the current shape the next time
 * anything about it changes, same as any other write.
 */
function defaulted(record: Partial<UserRecord> & Pick<UserRecord, 'user'>): UserRecord {
  return {
    user: record.user,
    positions: record.positions ?? [],
    standingTerms: record.standingTerms ?? [],
    payments: record.payments ?? [],
    achievements: record.achievements ?? [],
    applications: record.applications ?? [],
    applicationEvents: record.applicationEvents ?? [],
    rounds: record.rounds ?? [],
    recordedRates: record.recordedRates ?? [],
    documents: record.documents ?? [],
  }
}

/**
 * Keeps every User's record in the browser's own storage. This is the whole data layer
 * of the static demo build, and of local development before a server is running — no
 * network, nothing sent anywhere.
 *
 * Takes the DOM's `Storage` rather than reaching for the global `localStorage`, so the
 * adapter runs the same contract suite as SQLite under plain Node — no browser, no jsdom
 * (storage/local-storage-store.ts in Prometheus, the same reasoning).
 */
export class LocalStorageStore implements HyperionStore {
  constructor(private readonly storage: Storage) {}

  private read(): Record<UserId, UserRecord> {
    const raw = this.storage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Partial<StoredDocument>
    if (parsed.shape !== SHAPE) return {}
    const records = parsed.records ?? {}
    return Object.fromEntries(Object.entries(records).map(([id, record]) => [id, defaulted(record)]))
  }

  private write(records: Record<UserId, UserRecord>): void {
    const document: StoredDocument = { shape: SHAPE, records }
    this.storage.setItem(KEY, JSON.stringify(document))
  }

  private readBytes(): Record<DocumentId, string> {
    const raw = this.storage.getItem(BYTES_KEY)
    return raw ? (JSON.parse(raw) as Record<DocumentId, string>) : {}
  }

  private writeBytes(bytes: Record<DocumentId, string>): void {
    this.storage.setItem(BYTES_KEY, JSON.stringify(bytes))
  }

  async loadUserRecord(userId: UserId): Promise<UserRecord | undefined> {
    return this.read()[userId]
  }

  async createUser(user: User): Promise<void> {
    const records = this.read()
    if (records[user.id]) {
      throw new StorageError(`a User with id "${user.id}" already exists`)
    }
    records[user.id] = {
      user,
      positions: [],
      standingTerms: [],
      payments: [],
      achievements: [],
      applications: [],
      applicationEvents: [],
      rounds: [],
      recordedRates: [],
      documents: [],
    }
    this.write(records)
  }

  async writeUser(user: User): Promise<void> {
    const records = this.read()
    const record = requireRecord(records, user.id)
    record.user = user
    this.write(records)
  }

  async writePosition(position: Position): Promise<void> {
    const records = this.read()
    const record = requireRecord(records, position.userId)
    record.positions = upsert(record.positions, position)
    this.write(records)
  }

  async deletePosition(userId: UserId, positionId: PositionId): Promise<void> {
    const records = this.read()
    const record = requireRecord(records, userId)
    const attached = record.achievements.filter((row) => row.positionId === positionId).length
    if (attached > 0) {
      throw new StorageError(
        `cannot delete this Position while ${attached} Achievement${attached === 1 ? '' : 's'} still ${attached === 1 ? 'belongs' : 'belong'} to it`,
      )
    }
    record.positions = record.positions.filter((row) => row.id !== positionId)
    record.standingTerms = record.standingTerms.filter((row) => row.positionId !== positionId)
    record.payments = record.payments.filter((row) => row.positionId !== positionId)
    this.write(records)
  }

  async writeStandingTerms(terms: StandingTerms): Promise<void> {
    const records = this.read()
    const record = ownerOfPosition(records, terms.positionId)
    record.standingTerms = upsert(record.standingTerms, terms)
    this.write(records)
  }

  async deleteStandingTerms(userId: UserId, id: StandingTermsId): Promise<void> {
    const records = this.read()
    const record = requireRecord(records, userId)
    record.standingTerms = record.standingTerms.filter((row) => row.id !== id)
    this.write(records)
  }

  async writePayment(payment: Payment): Promise<void> {
    const records = this.read()
    const record = ownerOfPosition(records, payment.positionId)
    record.payments = upsert(record.payments, payment)
    this.write(records)
  }

  async deletePayment(userId: UserId, id: PaymentId): Promise<void> {
    const records = this.read()
    const record = requireRecord(records, userId)
    record.payments = record.payments.filter((row) => row.id !== id)
    this.write(records)
  }

  async writeAchievement(achievement: Achievement): Promise<void> {
    const records = this.read()
    const record = requireRecord(records, achievement.userId)
    record.achievements = upsert(record.achievements, achievement)
    this.write(records)
  }

  async deleteAchievement(userId: UserId, id: AchievementId): Promise<void> {
    const records = this.read()
    const record = requireRecord(records, userId)
    record.achievements = record.achievements.filter((row) => row.id !== id)
    this.write(records)
  }

  async writeApplication(application: Application): Promise<void> {
    const records = this.read()
    const record = requireRecord(records, application.userId)
    record.applications = upsert(record.applications, application)
    this.write(records)
  }

  async deleteApplication(userId: UserId, id: ApplicationId): Promise<void> {
    const records = this.read()
    const record = requireRecord(records, userId)
    record.applications = record.applications.filter((row) => row.id !== id)
    record.applicationEvents = record.applicationEvents.filter((row) => row.applicationId !== id)
    record.rounds = record.rounds.filter((row) => row.applicationId !== id)
    this.write(records)
  }

  async writeApplicationEvent(event: ApplicationEvent): Promise<void> {
    const records = this.read()
    const record = ownerOfApplication(records, event.applicationId)
    record.applicationEvents = upsert(record.applicationEvents, event)
    this.write(records)
  }

  async deleteApplicationEvent(userId: UserId, id: ApplicationEventId): Promise<void> {
    const records = this.read()
    const record = requireRecord(records, userId)
    record.applicationEvents = record.applicationEvents.filter((row) => row.id !== id)
    this.write(records)
  }

  async writeRound(round: Round): Promise<void> {
    const records = this.read()
    const record = ownerOfApplication(records, round.applicationId)
    record.rounds = upsert(record.rounds, round)
    this.write(records)
  }

  async deleteRound(userId: UserId, id: RoundId): Promise<void> {
    const records = this.read()
    const record = requireRecord(records, userId)
    record.rounds = record.rounds.filter((row) => row.id !== id)
    this.write(records)
  }

  async writeRecordedRate(rate: RecordedRate): Promise<void> {
    const records = this.read()
    const record = requireRecord(records, rate.userId)
    record.recordedRates = upsert(record.recordedRates, rate)
    this.write(records)
  }

  async deleteRecordedRate(userId: UserId, id: RecordedRateId): Promise<void> {
    const records = this.read()
    const record = requireRecord(records, userId)
    record.recordedRates = record.recordedRates.filter((row) => row.id !== id)
    this.write(records)
  }

  async writeDocument(meta: DocumentMeta, bytes: Uint8Array): Promise<void> {
    const records = this.read()
    const record = requireRecord(records, meta.userId)
    record.documents = upsert(record.documents, meta)
    this.write(records)

    const allBytes = this.readBytes()
    allBytes[meta.id] = bytesToBase64(bytes)
    this.writeBytes(allBytes)
  }

  async readDocumentBytes(userId: UserId, id: DocumentId): Promise<Uint8Array | undefined> {
    const records = this.read()
    const record = requireRecord(records, userId)
    if (!record.documents.some((row) => row.id === id)) return undefined
    const encoded = this.readBytes()[id]
    return encoded ? base64ToBytes(encoded) : undefined
  }

  async deleteDocument(userId: UserId, id: DocumentId): Promise<void> {
    const records = this.read()
    const record = requireRecord(records, userId)
    record.documents = record.documents.filter((row) => row.id !== id)
    record.applications = record.applications.map((row) => (row.documentId === id ? { ...row, documentId: null } : row))
    this.write(records)

    const allBytes = this.readBytes()
    delete allBytes[id]
    this.writeBytes(allBytes)
  }
}

function requireRecord(records: Record<UserId, UserRecord>, userId: UserId): UserRecord {
  const record = records[userId]
  if (!record) throw new StorageError(`no User "${userId}" is stored`)
  return record
}

function ownerOfPosition(records: Record<UserId, UserRecord>, positionId: PositionId): UserRecord {
  for (const record of Object.values(records)) {
    if (record.positions.some((position) => position.id === positionId)) return record
  }
  throw new StorageError(`no Position "${positionId}" is stored`)
}

function ownerOfApplication(records: Record<UserId, UserRecord>, applicationId: ApplicationId): UserRecord {
  for (const record of Object.values(records)) {
    if (record.applications.some((application) => application.id === applicationId)) return record
  }
  throw new StorageError(`no Application "${applicationId}" is stored`)
}

function upsert<T extends { id: string }>(rows: T[], row: T): T[] {
  const index = rows.findIndex((existing) => existing.id === row.id)
  if (index === -1) return [...rows, row]
  const next = [...rows]
  next[index] = row
  return next
}
