import type {
  Achievement,
  AchievementId,
  Application,
  ApplicationEvent,
  ApplicationEventId,
  ApplicationId,
  DocumentId,
  DocumentMeta,
  Payment,
  PaymentId,
  Position,
  PositionId,
  StandingTerms,
  StandingTermsId,
  User,
  UserId,
} from '../domain/index.js'

/** Raised when storage cannot honour an operation. */
export class StorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageError'
  }
}

/**
 * One User's whole record: every Position they hold or held, every Standing Terms and
 * Payment across all of them, every Achievement, every Application and its Events, and
 * every Document's metadata. What `domain/` is handed once it has been scoped to one User
 * — the domain layer never sees a `userId` at all (plan § Architecture: identity lives at
 * the boundary).
 *
 * `documents` carries metadata only, never bytes (CONTEXT.md § Document): the record
 * stays cheap to load regardless of how many résumé versions, or how large, sit behind
 * it. Bytes are fetched with `readDocumentBytes`, on demand, the one place this port
 * hands back something other than plain data.
 */
export interface UserRecord {
  user: User
  positions: Position[]
  standingTerms: StandingTerms[]
  payments: Payment[]
  achievements: Achievement[]
  applications: Application[]
  applicationEvents: ApplicationEvent[]
  documents: DocumentMeta[]
}

/**
 * How Hyperion stores a User's career record.
 *
 * The port speaks in the operations a User performs — write a Position, delete an
 * Achievement — rather than in requests and responses, so that an adapter is free to be a
 * table, a file or the browser's storage rather than a fetch shim faking HTTP
 * (storage/port.ts in Prometheus, the same shape, adapted to Hyperion's several distinct
 * row kinds rather than one generic row).
 *
 * Writes carry no `userId`: a Position and an Achievement already carry one, and a
 * Standing Terms or Payment belongs to the Position it names, so the row itself says who
 * owns it. Deletes take `userId` explicitly, since deleting by id alone would otherwise
 * let one User's request remove a row it does not own — the one place this port checks
 * ownership on its own rather than trusting the caller.
 */
export interface HyperionStore {
  /** The signed-in User's whole record, or nothing if this User id is not known. */
  loadUserRecord(userId: UserId): Promise<UserRecord | undefined>

  /** Creates a User and its empty record. Refused if the id is already taken. */
  createUser(user: User): Promise<void>

  /** Updates a User's own fields — display name, Fold/Stall Thresholds, the Admin bit. */
  writeUser(user: User): Promise<void>

  writePosition(position: Position): Promise<void>
  deletePosition(userId: UserId, positionId: PositionId): Promise<void>

  writeStandingTerms(terms: StandingTerms): Promise<void>
  deleteStandingTerms(userId: UserId, id: StandingTermsId): Promise<void>

  writePayment(payment: Payment): Promise<void>
  deletePayment(userId: UserId, id: PaymentId): Promise<void>

  writeAchievement(achievement: Achievement): Promise<void>
  deleteAchievement(userId: UserId, id: AchievementId): Promise<void>

  writeApplication(application: Application): Promise<void>
  deleteApplication(userId: UserId, id: ApplicationId): Promise<void>

  writeApplicationEvent(event: ApplicationEvent): Promise<void>
  deleteApplicationEvent(userId: UserId, id: ApplicationEventId): Promise<void>

  /** Writes a Document's metadata and its bytes together — there is no meaning to one without the other. */
  writeDocument(meta: DocumentMeta, bytes: Uint8Array): Promise<void>

  /** A Document's bytes, or `undefined` if no such Document is stored for this User. */
  readDocumentBytes(userId: UserId, id: DocumentId): Promise<Uint8Array | undefined>

  /**
   * Deletes a Document and its bytes. Any Application that named it has that reference
   * cleared rather than left dangling or refused outright — losing which résumé was sent
   * is a smaller loss than being unable to remove an old file at all, unlike an
   * Achievement's bond to its Position.
   */
  deleteDocument(userId: UserId, id: DocumentId): Promise<void>
}
