import { reactive, readonly, type DeepReadonly } from 'vue'
import {
  landApplication as landApplicationDomain,
  mintId,
  systemClock,
  type Achievement,
  type Application,
  type ApplicationEvent,
  type ApplicationEventId,
  type ApplicationId,
  type DocumentId,
  type DocumentMeta,
  type IsoDate,
  type Payment,
  type PaymentId,
  type Position,
  type PositionId,
  type Round,
  type RoundId,
  type StandingTerms,
  type StandingTermsId,
  type User,
  type UserId,
} from '../domain/index.js'
import type { HyperionStore } from '../storage/port.js'

interface RecordState {
  loading: boolean
  loaded: boolean
  user: User | undefined
  positions: Position[]
  standingTerms: StandingTerms[]
  payments: Payment[]
  achievements: Achievement[]
  applications: Application[]
  applicationEvents: ApplicationEvent[]
  rounds: Round[]
  documents: DocumentMeta[]
}

const state = reactive<RecordState>({
  loading: true,
  loaded: false,
  user: undefined,
  positions: [],
  standingTerms: [],
  payments: [],
  achievements: [],
  applications: [],
  applicationEvents: [],
  rounds: [],
  documents: [],
})

/** The whole of the signed-in User's record, read-only — every write goes through an action below. */
export const record: DeepReadonly<RecordState> = readonly(state)

let store: HyperionStore
let userId: UserId

/**
 * The signed-in User's id — every write below scopes itself to it. Set once, by
 * `initRecord`, from whoever the caller has already established is signed in: the demo
 * build's own fixed seed, or the server build's Session (`ui/main.ts`'s bootstrap either
 * way — `record.ts` itself never guesses at identity, matching "identity lives at the
 * boundary").
 */
export function currentUserId(): UserId {
  return userId
}

/** Wires the chosen adapter and loads `forUserId`'s record once. Call before mounting. */
export async function initRecord(chosen: HyperionStore, forUserId: UserId): Promise<void> {
  store = chosen
  userId = forUserId
  await refresh()
}

/**
 * The server build's own way of saying "checked, nobody is signed in" — `record.loaded`
 * becomes true with `record.user` left unset, the same shape `refresh` already leaves it
 * in for an id storage doesn't recognise, so `App.vue`'s loading gate renders Login/Setup
 * rather than spinning forever on someone who was never going to have a record to load.
 */
export function markNotSignedIn(): void {
  state.loading = false
  state.loaded = true
}

async function refresh(): Promise<void> {
  state.loading = true
  const loaded = await store.loadUserRecord(userId)
  if (loaded) {
    state.user = loaded.user
    state.positions = loaded.positions
    state.standingTerms = loaded.standingTerms
    state.payments = loaded.payments
    state.achievements = loaded.achievements
    state.applications = loaded.applications
    state.applicationEvents = loaded.applicationEvents
    state.rounds = loaded.rounds
    state.documents = loaded.documents
  }
  state.loading = false
  state.loaded = true
}

/** Today, through the one clock every date-dependent view reads (domain/clock.ts). */
export function today(): string {
  return systemClock.today()
}

/** Writes an Achievement as given, id included — the primitive `logAchievement` and a restore both build on. */
export async function saveAchievement(achievement: Achievement): Promise<void> {
  await store.writeAchievement(achievement)
  state.achievements = upsert(state.achievements, achievement)
}

export async function logAchievement(
  text: string,
  positionId: PositionId,
  date: IsoDate = today(),
  impact: string | null = null,
): Promise<Achievement> {
  const achievement: Achievement = {
    id: mintId(),
    userId: currentUserId(),
    positionId,
    date,
    text,
    impact,
  }
  await saveAchievement(achievement)
  return achievement
}

export async function deleteAchievement(id: string): Promise<void> {
  await store.deleteAchievement(currentUserId(), id)
  state.achievements = state.achievements.filter((row) => row.id !== id)
}

export async function saveUser(user: User): Promise<void> {
  await store.writeUser(user)
  state.user = user
}

export async function savePosition(position: Position): Promise<void> {
  await store.writePosition(position)
  state.positions = upsert(state.positions, position)
}

/**
 * Refused by the store (`StorageError`, propagated unchanged) while any Achievement is
 * still attached — an Achievement can no longer exist without a Position, so there is no
 * state left to detach it into. Local state is only touched once the store has actually
 * agreed to the delete.
 */
export async function deletePosition(id: PositionId): Promise<void> {
  await store.deletePosition(currentUserId(), id)
  state.positions = state.positions.filter((row) => row.id !== id)
  state.standingTerms = state.standingTerms.filter((row) => row.positionId !== id)
  state.payments = state.payments.filter((row) => row.positionId !== id)
}

export async function saveStandingTerms(terms: StandingTerms): Promise<void> {
  await store.writeStandingTerms(terms)
  state.standingTerms = upsert(state.standingTerms, terms)
}

export async function deleteStandingTerms(id: StandingTermsId): Promise<void> {
  await store.deleteStandingTerms(currentUserId(), id)
  state.standingTerms = state.standingTerms.filter((row) => row.id !== id)
}

export async function savePayment(payment: Payment): Promise<void> {
  await store.writePayment(payment)
  state.payments = upsert(state.payments, payment)
}

export async function deletePayment(id: PaymentId): Promise<void> {
  await store.deletePayment(currentUserId(), id)
  state.payments = state.payments.filter((row) => row.id !== id)
}

export async function saveApplication(application: Application): Promise<void> {
  await store.writeApplication(application)
  state.applications = upsert(state.applications, application)
}

/** Cascades its Application Events and Rounds — nothing refuses this the way deletePosition does. */
export async function deleteApplication(id: ApplicationId): Promise<void> {
  await store.deleteApplication(currentUserId(), id)
  state.applications = state.applications.filter((row) => row.id !== id)
  state.applicationEvents = state.applicationEvents.filter((row) => row.applicationId !== id)
  state.rounds = state.rounds.filter((row) => row.applicationId !== id)
}

export async function saveApplicationEvent(event: ApplicationEvent): Promise<void> {
  await store.writeApplicationEvent(event)
  state.applicationEvents = upsert(state.applicationEvents, event)
}

export async function deleteApplicationEvent(id: ApplicationEventId): Promise<void> {
  await store.deleteApplicationEvent(currentUserId(), id)
  state.applicationEvents = state.applicationEvents.filter((row) => row.id !== id)
}

export async function saveRound(round: Round): Promise<void> {
  await store.writeRound(round)
  state.rounds = upsert(state.rounds, round)
}

export async function deleteRound(id: RoundId): Promise<void> {
  await store.deleteRound(currentUserId(), id)
  state.rounds = state.rounds.filter((row) => row.id !== id)
}

/**
 * Turns an Application into a Position (CONTEXT.md § Landing). Three writes, sequential
 * rather than one transactional call — the same convention `AddPositionModal` already uses
 * for "Position plus its Starting Terms," so a compound action here is not a new shape in
 * the codebase. The Application itself is untouched by any of these three writes; only
 * the Landed Event, appended last, records that it happened.
 */
export async function landApplication(application: Application): Promise<Position> {
  const { position, standingTerms, event } = landApplicationDomain(
    application,
    { positionId: mintId(), standingTermsId: mintId(), eventId: mintId() },
    today(),
  )
  await savePosition(position)
  await saveStandingTerms(standingTerms)
  await saveApplicationEvent(event)
  return position
}

/**
 * Reads a File chosen from an `<input type="file">`, mints its Document metadata, and
 * writes both together — there is no meaning to one without the other (`writeDocument`'s
 * own contract). Label is asked for separately from the filename: "Résumé v3,
 * backend-heavy" is what a person actually wants to see in a list a year later, not
 * whatever the file happened to be called on disk.
 */
export async function uploadDocument(label: string, file: File): Promise<DocumentMeta> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const meta: DocumentMeta = {
    id: mintId(),
    userId: currentUserId(),
    label,
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: bytes.byteLength,
    createdAt: today(),
  }
  await restoreDocument(meta, bytes)
  return meta
}

/**
 * Writes a Document's metadata and bytes exactly as given, id included — unlike
 * `uploadDocument`, which always mints a fresh id from a browser `File`. What a restore from
 * an export uses to bring a Document back with its original identity intact.
 */
export async function restoreDocument(meta: DocumentMeta, bytes: Uint8Array): Promise<void> {
  await store.writeDocument(meta, bytes)
  state.documents = upsert(state.documents, meta)
}

export async function readDocumentBytes(id: DocumentId): Promise<Uint8Array | undefined> {
  return store.readDocumentBytes(currentUserId(), id)
}

/**
 * Relabels a Document in place — same id, same file, only what a person calls it
 * changes. Reuses `writeDocument` rather than a dedicated metadata-only port method: a
 * rename is rare enough that re-sending bytes already on the User's own machine costs
 * nothing worth a wider port surface for.
 */
export async function renameDocument(id: DocumentId, label: string): Promise<void> {
  const existing = state.documents.find((row) => row.id === id)
  if (!existing) return
  const bytes = await store.readDocumentBytes(currentUserId(), id)
  if (!bytes) return
  const meta: DocumentMeta = { ...existing, label }
  await store.writeDocument(meta, bytes)
  state.documents = upsert(state.documents, meta)
}

/** Clears the reference on any Application that named it — the store's own contract. */
export async function deleteDocument(id: DocumentId): Promise<void> {
  await store.deleteDocument(currentUserId(), id)
  state.documents = state.documents.filter((row) => row.id !== id)
  state.applications = state.applications.map((row) => (row.documentId === id ? { ...row, documentId: null } : row))
}

function upsert<T extends { id: string }>(rows: T[], row: T): T[] {
  const index = rows.findIndex((existing) => existing.id === row.id)
  if (index === -1) return [...rows, row]
  const next = [...rows]
  next[index] = row
  return next
}
