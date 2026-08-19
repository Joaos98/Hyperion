import type { Database } from 'better-sqlite3'
import type {
  Achievement,
  AchievementId,
  AdvertisedRange,
  Application,
  ApplicationEvent,
  ApplicationEventId,
  ApplicationId,
  Currency,
  Departure,
  DocumentId,
  DocumentMeta,
  EmploymentType,
  Invite,
  IsoDate,
  OfferedTerms,
  Payment,
  PaymentId,
  Position,
  PositionId,
  Round,
  RoundId,
  RoundKind,
  Stage,
  StandingTerms,
  StandingTermsId,
  User,
  UserId,
} from '../domain/index.js'
import { StorageError, type HyperionStore, type UserRecord } from './port.js'

/**
 * A signed-in browser (CONTEXT.md has no glossary entry for this — it is pure mechanism,
 * not something a User ever names or thinks about, unlike Invite). Lives only in
 * `SqliteStore`, never in `domain/` or in anything sent to the client beyond the cookie
 * itself: identity lives at the boundary (plan § Architecture).
 */
export interface Session {
  token: string
  userId: UserId
  createdAt: IsoDate
  expiresAt: IsoDate
}

/**
 * The schemas this database has been through, in order — the same convention as
 * Prometheus's `sqlite-store.ts`. A fresh database walks every migration; an existing one
 * walks whatever is left after `user_version`.
 */
const migrations: ((db: Database) => void)[] = [
  /**
   * 1 — Users, and their Positions, Standing Terms, Payments, Achievements, Documents,
   * and Applications with their Application Events.
   */
  (db) => {
    db.exec(`
      create table users (
        id text primary key,
        display_name text not null,
        is_admin integer not null,
        fold_threshold_days integer not null,
        stall_threshold_days integer not null,
        ai_api_key text
      );

      create table positions (
        id text primary key,
        user_id text not null references users(id) on delete cascade,
        company text not null,
        currency_code text not null,
        currency_symbol text not null,
        currency_decimals integer not null,
        start_date text not null,
        departure_date text,
        departure_reason text
      );

      create table standing_terms (
        id text primary key,
        position_id text not null references positions(id) on delete cascade,
        effective_date text not null,
        title text not null,
        employment_type text not null,
        base_salary_minor integer not null,
        target_bonus_minor integer not null
      );

      create table payments (
        id text primary key,
        position_id text not null references positions(id) on delete cascade,
        date text not null,
        amount_minor integer not null,
        label text not null
      );

      create table achievements (
        id text primary key,
        user_id text not null references users(id) on delete cascade,
        position_id text not null references positions(id),
        date text not null,
        text text not null,
        impact text
      );

      -- Bytes live on this table (a native BLOB), not on a volume — cp'ing the one file
      -- stays the whole backup story (CONTEXT.md § Document).
      create table documents (
        id text primary key,
        user_id text not null references users(id) on delete cascade,
        label text not null,
        filename text not null,
        mime_type text not null,
        size_bytes integer not null,
        created_at text not null,
        bytes blob not null
      );

      -- Advertised Range and Offered Terms are each optional nested objects, flattened to
      -- a group of nullable columns the way Position flattens Currency — either every
      -- column in the group is set, or none is.
      create table applications (
        id text primary key,
        user_id text not null references users(id) on delete cascade,
        company text not null,
        title text not null,
        source text not null,
        posting_url text,
        advertised_min_minor integer,
        advertised_max_minor integer,
        advertised_currency_code text,
        advertised_currency_symbol text,
        advertised_currency_decimals integer,
        offered_base_salary_minor integer,
        offered_target_bonus_minor integer,
        offered_employment_type text,
        offered_start_date text,
        offered_currency_code text,
        offered_currency_symbol text,
        offered_currency_decimals integer,
        document_id text references documents(id) on delete set null,
        prior_application_id text references applications(id) on delete set null
      );

      create table application_events (
        id text primary key,
        application_id text not null references applications(id) on delete cascade,
        stage text not null,
        date text not null,
        note text
      );

      create index positions_user on positions(user_id);
      create index standing_terms_position on standing_terms(position_id);
      create index payments_position on payments(position_id);
      create index achievements_user on achievements(user_id);
      create index applications_user on applications(user_id);
      create index application_events_application on application_events(application_id);
      create index documents_user on documents(user_id);
    `)
  },

  /** 2 — a User's chosen display period for a point-in-time salary figure. */
  (db) => {
    db.exec(`alter table users add column compensation_display text not null default 'annual'`)
  },

  /**
   * 3 — auth (plan § Users and access): a password hash on `users` itself, not a separate
   * table (`hyperion-plan.md`'s own "Ten tables" list has no `credentials`); Sessions and
   * Invites as their own tables, both scoped to the User who owns them.
   */
  (db) => {
    db.exec(`
      alter table users add column password_hash text;

      create table sessions (
        token text primary key,
        user_id text not null references users(id) on delete cascade,
        created_at text not null,
        expires_at text not null
      );

      create table invites (
        code text primary key,
        created_by text not null references users(id) on delete cascade,
        created_at text not null
      );

      create index sessions_user on sessions(user_id);
    `)
  },

  /** 4 — Rounds (CONTEXT.md § Round): the steps a company actually put an Application through. */
  (db) => {
    db.exec(`
      create table rounds (
        id text primary key,
        application_id text not null references applications(id) on delete cascade,
        date text not null,
        kind text not null,
        person text,
        notes text
      );

      create index rounds_application on rounds(application_id);
    `)
  },
]

function migrate(db: Database): void {
  db.pragma('foreign_keys = ON')
  const current = db.pragma('user_version', { simple: true }) as number
  for (let version = current; version < migrations.length; version++) {
    migrations[version]!(db)
  }
  db.pragma(`user_version = ${migrations.length}`)
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    displayName: row.display_name,
    isAdmin: row.is_admin === 1,
    foldThresholdDays: row.fold_threshold_days,
    stallThresholdDays: row.stall_threshold_days,
    aiApiKey: row.ai_api_key,
    compensationDisplay: row.compensation_display,
  }
}

function rowToPosition(row: PositionRow): Position {
  const currency: Currency = {
    code: row.currency_code,
    symbol: row.currency_symbol,
    decimals: row.currency_decimals,
  }
  const departure: Departure | null =
    row.departure_date && row.departure_reason
      ? { date: row.departure_date, reason: row.departure_reason }
      : null
  return {
    id: row.id,
    userId: row.user_id,
    company: row.company,
    currency,
    startDate: row.start_date,
    departure,
  }
}

function rowToStandingTerms(row: StandingTermsRow): StandingTerms {
  return {
    id: row.id,
    positionId: row.position_id,
    effectiveDate: row.effective_date,
    title: row.title,
    employmentType: row.employment_type as EmploymentType,
    baseSalaryMinor: row.base_salary_minor,
    targetBonusMinor: row.target_bonus_minor,
  }
}

function rowToPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    positionId: row.position_id,
    date: row.date,
    amountMinor: row.amount_minor,
    label: row.label,
  }
}

function rowToAchievement(row: AchievementRow): Achievement {
  return {
    id: row.id,
    userId: row.user_id,
    positionId: row.position_id,
    date: row.date,
    text: row.text,
    impact: row.impact,
  }
}

function rowToApplication(row: ApplicationRow): Application {
  const advertisedRange: AdvertisedRange | null =
    row.advertised_min_minor !== null &&
    row.advertised_max_minor !== null &&
    row.advertised_currency_code !== null &&
    row.advertised_currency_symbol !== null &&
    row.advertised_currency_decimals !== null
      ? {
          minMinor: row.advertised_min_minor,
          maxMinor: row.advertised_max_minor,
          currency: {
            code: row.advertised_currency_code,
            symbol: row.advertised_currency_symbol,
            decimals: row.advertised_currency_decimals,
          },
        }
      : null

  const offeredTerms: OfferedTerms | null =
    row.offered_base_salary_minor !== null &&
    row.offered_target_bonus_minor !== null &&
    row.offered_employment_type !== null &&
    row.offered_start_date !== null &&
    row.offered_currency_code !== null &&
    row.offered_currency_symbol !== null &&
    row.offered_currency_decimals !== null
      ? {
          baseSalaryMinor: row.offered_base_salary_minor,
          targetBonusMinor: row.offered_target_bonus_minor,
          employmentType: row.offered_employment_type as EmploymentType,
          startDate: row.offered_start_date,
          currency: {
            code: row.offered_currency_code,
            symbol: row.offered_currency_symbol,
            decimals: row.offered_currency_decimals,
          },
        }
      : null

  return {
    id: row.id,
    userId: row.user_id,
    company: row.company,
    title: row.title,
    source: row.source,
    postingUrl: row.posting_url,
    advertisedRange,
    offeredTerms,
    documentId: row.document_id,
    priorApplicationId: row.prior_application_id,
  }
}

function rowToApplicationEvent(row: ApplicationEventRow): ApplicationEvent {
  return {
    id: row.id,
    applicationId: row.application_id,
    stage: row.stage as Stage,
    date: row.date,
    note: row.note,
  }
}

function rowToRound(row: RoundRow): Round {
  return {
    id: row.id,
    applicationId: row.application_id,
    date: row.date,
    kind: row.kind as RoundKind,
    person: row.person,
    notes: row.notes,
  }
}

function rowToSession(row: SessionRow): Session {
  return {
    token: row.token,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }
}

function rowToInvite(row: InviteRow): Invite {
  return {
    code: row.code,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

/** Metadata only — `bytes` is selected separately, by `readDocumentBytes` alone. */
function rowToDocumentMeta(row: DocumentMetaRow): DocumentMeta {
  return {
    id: row.id,
    userId: row.user_id,
    label: row.label,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  }
}

interface UserRow {
  id: string
  display_name: string
  is_admin: 0 | 1
  fold_threshold_days: number
  stall_threshold_days: number
  ai_api_key: string | null
  compensation_display: 'annual' | 'monthly'
  /** Never read by `rowToUser` — `passwordHashFor` is the only method that selects this. */
  password_hash: string | null
}
interface SessionRow {
  token: string
  user_id: string
  created_at: string
  expires_at: string
}
interface InviteRow {
  code: string
  created_by: string
  created_at: string
}
interface PositionRow {
  id: string
  user_id: string
  company: string
  currency_code: string
  currency_symbol: string
  currency_decimals: number
  start_date: string
  departure_date: string | null
  departure_reason: string | null
}
interface StandingTermsRow {
  id: string
  position_id: string
  effective_date: string
  title: string
  employment_type: string
  base_salary_minor: number
  target_bonus_minor: number
}
interface PaymentRow {
  id: string
  position_id: string
  date: string
  amount_minor: number
  label: string
}
interface AchievementRow {
  id: string
  user_id: string
  position_id: string
  date: string
  text: string
  impact: string | null
}
interface ApplicationRow {
  id: string
  user_id: string
  company: string
  title: string
  source: string
  posting_url: string | null
  advertised_min_minor: number | null
  advertised_max_minor: number | null
  advertised_currency_code: string | null
  advertised_currency_symbol: string | null
  advertised_currency_decimals: number | null
  offered_base_salary_minor: number | null
  offered_target_bonus_minor: number | null
  offered_employment_type: string | null
  offered_start_date: string | null
  offered_currency_code: string | null
  offered_currency_symbol: string | null
  offered_currency_decimals: number | null
  document_id: string | null
  prior_application_id: string | null
}
interface ApplicationEventRow {
  id: string
  application_id: string
  stage: string
  date: string
  note: string | null
}
interface RoundRow {
  id: string
  application_id: string
  date: string
  kind: string
  person: string | null
  notes: string | null
}
interface DocumentMetaRow {
  id: string
  user_id: string
  label: string
  filename: string
  mime_type: string
  size_bytes: number
  created_at: string
}

/**
 * The self-hosted adapter: one SQLite file, everything scoped to the User who owns it.
 * Row-scoped writes and deletes throughout, the same shape as `LocalStorageStore`, so the
 * two behave identically under `port-contract.ts` and a User cannot tell which one is
 * running underneath.
 */
export class SqliteStore implements HyperionStore {
  constructor(private readonly db: Database) {
    migrate(db)
  }

  async loadUserRecord(userId: UserId): Promise<UserRecord | undefined> {
    const userRow = this.db.prepare('select * from users where id = ?').get(userId) as UserRow | undefined
    if (!userRow) return undefined

    const positions = (
      this.db.prepare('select * from positions where user_id = ?').all(userId) as PositionRow[]
    ).map(rowToPosition)

    const positionIds = positions.map((position) => position.id)
    const standingTerms = positionIds.length === 0 ? [] : this.rowsForPositions('standing_terms', positionIds).map(rowToStandingTerms)
    const payments = positionIds.length === 0 ? [] : this.rowsForPositions('payments', positionIds).map(rowToPayment)

    const achievements = (
      this.db.prepare('select * from achievements where user_id = ?').all(userId) as AchievementRow[]
    ).map(rowToAchievement)

    const applications = (
      this.db.prepare('select * from applications where user_id = ?').all(userId) as ApplicationRow[]
    ).map(rowToApplication)

    const applicationIds = applications.map((application) => application.id)
    const applicationEvents =
      applicationIds.length === 0
        ? []
        : (
            this.db
              .prepare(
                // `order by rowid` — same-day Events are ordinary (applying and landing
                // the same day, say), and domain/applications.ts's tie-break trusts array
                // order to mean creation order. `rowid` is SQLite's own implicit
                // insertion-order column; asking for it explicitly is what makes that
                // trust correct rather than an assumption about how a scan happens to run.
                `select * from application_events where application_id in (${applicationIds.map(() => '?').join(', ')}) order by rowid`,
              )
              .all(...applicationIds) as ApplicationEventRow[]
          ).map(rowToApplicationEvent)

    const rounds =
      applicationIds.length === 0
        ? []
        : (
            this.db
              .prepare(
                `select * from rounds where application_id in (${applicationIds.map(() => '?').join(', ')}) order by rowid`,
              )
              .all(...applicationIds) as RoundRow[]
          ).map(rowToRound)

    // Every column except `bytes` — the metadata a record listing needs, at none of the
    // cost of the files behind it.
    const documents = (
      this.db
        .prepare(
          'select id, user_id, label, filename, mime_type, size_bytes, created_at from documents where user_id = ?',
        )
        .all(userId) as DocumentMetaRow[]
    ).map(rowToDocumentMeta)

    return {
      user: rowToUser(userRow),
      positions,
      standingTerms,
      payments,
      achievements,
      applications,
      applicationEvents,
      rounds,
      documents,
    }
  }

  /** Rows of `table` belonging to any of `positionIds` — `better-sqlite3` has no array binding. */
  private rowsForPositions(table: 'standing_terms' | 'payments', positionIds: string[]): (StandingTermsRow & PaymentRow)[] {
    const placeholders = positionIds.map(() => '?').join(', ')
    return this.db
      .prepare(`select * from ${table} where position_id in (${placeholders})`)
      .all(...positionIds) as (StandingTermsRow & PaymentRow)[]
  }

  async createUser(user: User): Promise<void> {
    const existing = this.db.prepare('select 1 from users where id = ?').get(user.id)
    if (existing) throw new StorageError(`a User with id "${user.id}" already exists`)
    this.db
      .prepare(
        `insert into users (id, display_name, is_admin, fold_threshold_days, stall_threshold_days, ai_api_key, compensation_display)
         values (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        user.id,
        user.displayName,
        user.isAdmin ? 1 : 0,
        user.foldThresholdDays,
        user.stallThresholdDays,
        user.aiApiKey,
        user.compensationDisplay,
      )
  }

  async writeUser(user: User): Promise<void> {
    const result = this.db
      .prepare(
        `update users set display_name = ?, is_admin = ?, fold_threshold_days = ?, stall_threshold_days = ?,
           ai_api_key = ?, compensation_display = ?
         where id = ?`,
      )
      .run(
        user.displayName,
        user.isAdmin ? 1 : 0,
        user.foldThresholdDays,
        user.stallThresholdDays,
        user.aiApiKey,
        user.compensationDisplay,
        user.id,
      )
    if (result.changes === 0) throw new StorageError(`no User "${user.id}" is stored`)
  }

  // ── auth (plan § Users and access) ───────────────────────────────────────

  /** Whether any User exists yet — closes the first-run setup window for good. */
  async hasAnyUser(): Promise<boolean> {
    return this.db.prepare('select 1 from users limit 1').get() !== undefined
  }

  async findUserByDisplayName(displayName: string): Promise<User | undefined> {
    const row = this.db.prepare('select * from users where display_name = ?').get(displayName) as UserRow | undefined
    return row ? rowToUser(row) : undefined
  }

  async allUsers(): Promise<User[]> {
    return (this.db.prepare('select * from users').all() as UserRow[]).map(rowToUser)
  }

  async setPasswordHash(userId: UserId, passwordHash: string): Promise<void> {
    const result = this.db.prepare('update users set password_hash = ? where id = ?').run(passwordHash, userId)
    if (result.changes === 0) throw new StorageError(`no User "${userId}" is stored`)
  }

  async passwordHashFor(userId: UserId): Promise<string | undefined> {
    const row = this.db.prepare('select password_hash from users where id = ?').get(userId) as
      | { password_hash: string | null }
      | undefined
    return row?.password_hash ?? undefined
  }

  async createSession(session: Session): Promise<void> {
    this.db
      .prepare('insert into sessions (token, user_id, created_at, expires_at) values (?, ?, ?, ?)')
      .run(session.token, session.userId, session.createdAt, session.expiresAt)
  }

  async session(token: string): Promise<Session | undefined> {
    const row = this.db.prepare('select * from sessions where token = ?').get(token) as SessionRow | undefined
    return row ? rowToSession(row) : undefined
  }

  async deleteSession(token: string): Promise<void> {
    this.db.prepare('delete from sessions where token = ?').run(token)
  }

  /** Every session for a User — run after a password change, so an old session outlives it nowhere. */
  async deleteSessionsForUser(userId: UserId): Promise<void> {
    this.db.prepare('delete from sessions where user_id = ?').run(userId)
  }

  async createInvite(invite: Invite): Promise<void> {
    this.db
      .prepare('insert into invites (code, created_by, created_at) values (?, ?, ?)')
      .run(invite.code, invite.createdBy, invite.createdAt)
  }

  async invite(code: string): Promise<Invite | undefined> {
    const row = this.db.prepare('select * from invites where code = ?').get(code) as InviteRow | undefined
    return row ? rowToInvite(row) : undefined
  }

  async invites(): Promise<Invite[]> {
    return (this.db.prepare('select * from invites').all() as InviteRow[]).map(rowToInvite)
  }

  async deleteInvite(code: string): Promise<void> {
    this.db.prepare('delete from invites where code = ?').run(code)
  }

  async writePosition(position: Position): Promise<void> {
    this.db
      .prepare(
        `insert into positions
           (id, user_id, company, currency_code, currency_symbol, currency_decimals, start_date, departure_date, departure_reason)
         values (@id, @userId, @company, @currencyCode, @currencySymbol, @currencyDecimals, @startDate, @departureDate, @departureReason)
         on conflict(id) do update set
           user_id = excluded.user_id, company = excluded.company,
           currency_code = excluded.currency_code, currency_symbol = excluded.currency_symbol,
           currency_decimals = excluded.currency_decimals, start_date = excluded.start_date,
           departure_date = excluded.departure_date, departure_reason = excluded.departure_reason`,
      )
      .run({
        id: position.id,
        userId: position.userId,
        company: position.company,
        currencyCode: position.currency.code,
        currencySymbol: position.currency.symbol,
        currencyDecimals: position.currency.decimals,
        startDate: position.startDate,
        departureDate: position.departure?.date ?? null,
        departureReason: position.departure?.reason ?? null,
      })
  }

  async deletePosition(userId: UserId, positionId: PositionId): Promise<void> {
    const attached = this.db
      .prepare('select count(*) as n from achievements where position_id = ?')
      .get(positionId) as { n: number }
    if (attached.n > 0) {
      throw new StorageError(
        `cannot delete this Position while ${attached.n} Achievement${attached.n === 1 ? '' : 's'} still ${attached.n === 1 ? 'belongs' : 'belong'} to it`,
      )
    }
    // Standing Terms and Payments cascade — the same rule the localStorage adapter
    // applies by hand. Achievements do not: their foreign key has no ON DELETE clause,
    // so SQLite itself would refuse this exact case even without the check above; the
    // check exists to answer with Hyperion's own words rather than a raw FK error.
    this.db.prepare('delete from positions where id = ? and user_id = ?').run(positionId, userId)
  }

  async writeStandingTerms(terms: StandingTerms): Promise<void> {
    this.requirePositionOwner(terms.positionId)
    this.db
      .prepare(
        `insert into standing_terms
           (id, position_id, effective_date, title, employment_type, base_salary_minor, target_bonus_minor)
         values (@id, @positionId, @effectiveDate, @title, @employmentType, @baseSalaryMinor, @targetBonusMinor)
         on conflict(id) do update set
           position_id = excluded.position_id, effective_date = excluded.effective_date,
           title = excluded.title, employment_type = excluded.employment_type,
           base_salary_minor = excluded.base_salary_minor, target_bonus_minor = excluded.target_bonus_minor`,
      )
      .run({
        id: terms.id,
        positionId: terms.positionId,
        effectiveDate: terms.effectiveDate,
        title: terms.title,
        employmentType: terms.employmentType,
        baseSalaryMinor: terms.baseSalaryMinor,
        targetBonusMinor: terms.targetBonusMinor,
      })
  }

  async deleteStandingTerms(userId: UserId, id: StandingTermsId): Promise<void> {
    this.db
      .prepare(
        `delete from standing_terms where id = ? and position_id in
           (select id from positions where user_id = ?)`,
      )
      .run(id, userId)
  }

  async writePayment(payment: Payment): Promise<void> {
    this.requirePositionOwner(payment.positionId)
    this.db
      .prepare(
        `insert into payments (id, position_id, date, amount_minor, label)
         values (@id, @positionId, @date, @amountMinor, @label)
         on conflict(id) do update set
           position_id = excluded.position_id, date = excluded.date,
           amount_minor = excluded.amount_minor, label = excluded.label`,
      )
      .run({
        id: payment.id,
        positionId: payment.positionId,
        date: payment.date,
        amountMinor: payment.amountMinor,
        label: payment.label,
      })
  }

  async deletePayment(userId: UserId, id: PaymentId): Promise<void> {
    this.db
      .prepare(
        `delete from payments where id = ? and position_id in
           (select id from positions where user_id = ?)`,
      )
      .run(id, userId)
  }

  async writeAchievement(achievement: Achievement): Promise<void> {
    this.db
      .prepare(
        `insert into achievements (id, user_id, position_id, date, text, impact)
         values (@id, @userId, @positionId, @date, @text, @impact)
         on conflict(id) do update set
           user_id = excluded.user_id, position_id = excluded.position_id,
           date = excluded.date, text = excluded.text, impact = excluded.impact`,
      )
      .run({
        id: achievement.id,
        userId: achievement.userId,
        positionId: achievement.positionId,
        date: achievement.date,
        text: achievement.text,
        impact: achievement.impact,
      })
  }

  async deleteAchievement(userId: UserId, id: AchievementId): Promise<void> {
    this.db.prepare('delete from achievements where id = ? and user_id = ?').run(id, userId)
  }

  async writeApplication(application: Application): Promise<void> {
    this.db
      .prepare(
        `insert into applications
           (id, user_id, company, title, source, posting_url,
            advertised_min_minor, advertised_max_minor, advertised_currency_code,
            advertised_currency_symbol, advertised_currency_decimals,
            offered_base_salary_minor, offered_target_bonus_minor, offered_employment_type,
            offered_start_date, offered_currency_code, offered_currency_symbol, offered_currency_decimals,
            document_id, prior_application_id)
         values
           (@id, @userId, @company, @title, @source, @postingUrl,
            @advertisedMinMinor, @advertisedMaxMinor, @advertisedCurrencyCode,
            @advertisedCurrencySymbol, @advertisedCurrencyDecimals,
            @offeredBaseSalaryMinor, @offeredTargetBonusMinor, @offeredEmploymentType,
            @offeredStartDate, @offeredCurrencyCode, @offeredCurrencySymbol, @offeredCurrencyDecimals,
            @documentId, @priorApplicationId)
         on conflict(id) do update set
           user_id = excluded.user_id, company = excluded.company, title = excluded.title,
           source = excluded.source, posting_url = excluded.posting_url,
           advertised_min_minor = excluded.advertised_min_minor, advertised_max_minor = excluded.advertised_max_minor,
           advertised_currency_code = excluded.advertised_currency_code,
           advertised_currency_symbol = excluded.advertised_currency_symbol,
           advertised_currency_decimals = excluded.advertised_currency_decimals,
           offered_base_salary_minor = excluded.offered_base_salary_minor,
           offered_target_bonus_minor = excluded.offered_target_bonus_minor,
           offered_employment_type = excluded.offered_employment_type,
           offered_start_date = excluded.offered_start_date,
           offered_currency_code = excluded.offered_currency_code,
           offered_currency_symbol = excluded.offered_currency_symbol,
           offered_currency_decimals = excluded.offered_currency_decimals,
           document_id = excluded.document_id, prior_application_id = excluded.prior_application_id`,
      )
      .run({
        id: application.id,
        userId: application.userId,
        company: application.company,
        title: application.title,
        source: application.source,
        postingUrl: application.postingUrl,
        advertisedMinMinor: application.advertisedRange?.minMinor ?? null,
        advertisedMaxMinor: application.advertisedRange?.maxMinor ?? null,
        advertisedCurrencyCode: application.advertisedRange?.currency.code ?? null,
        advertisedCurrencySymbol: application.advertisedRange?.currency.symbol ?? null,
        advertisedCurrencyDecimals: application.advertisedRange?.currency.decimals ?? null,
        offeredBaseSalaryMinor: application.offeredTerms?.baseSalaryMinor ?? null,
        offeredTargetBonusMinor: application.offeredTerms?.targetBonusMinor ?? null,
        offeredEmploymentType: application.offeredTerms?.employmentType ?? null,
        offeredStartDate: application.offeredTerms?.startDate ?? null,
        offeredCurrencyCode: application.offeredTerms?.currency.code ?? null,
        offeredCurrencySymbol: application.offeredTerms?.currency.symbol ?? null,
        offeredCurrencyDecimals: application.offeredTerms?.currency.decimals ?? null,
        documentId: application.documentId,
        priorApplicationId: application.priorApplicationId,
      })
  }

  async deleteApplication(userId: UserId, id: ApplicationId): Promise<void> {
    // Application Events and Rounds cascade; nothing refuses this the way Achievements do
    // for a Position — an Application's history is its own, and deleting it loses nothing else.
    this.db.prepare('delete from applications where id = ? and user_id = ?').run(id, userId)
  }

  async writeApplicationEvent(event: ApplicationEvent): Promise<void> {
    this.requireApplicationOwner(event.applicationId)
    this.db
      .prepare(
        `insert into application_events (id, application_id, stage, date, note)
         values (@id, @applicationId, @stage, @date, @note)
         on conflict(id) do update set
           application_id = excluded.application_id, stage = excluded.stage,
           date = excluded.date, note = excluded.note`,
      )
      .run({ id: event.id, applicationId: event.applicationId, stage: event.stage, date: event.date, note: event.note })
  }

  async deleteApplicationEvent(userId: UserId, id: ApplicationEventId): Promise<void> {
    this.db
      .prepare(
        `delete from application_events where id = ? and application_id in
           (select id from applications where user_id = ?)`,
      )
      .run(id, userId)
  }

  async writeRound(round: Round): Promise<void> {
    this.requireApplicationOwner(round.applicationId)
    this.db
      .prepare(
        `insert into rounds (id, application_id, date, kind, person, notes)
         values (@id, @applicationId, @date, @kind, @person, @notes)
         on conflict(id) do update set
           application_id = excluded.application_id, date = excluded.date,
           kind = excluded.kind, person = excluded.person, notes = excluded.notes`,
      )
      .run({
        id: round.id,
        applicationId: round.applicationId,
        date: round.date,
        kind: round.kind,
        person: round.person,
        notes: round.notes,
      })
  }

  async deleteRound(userId: UserId, id: RoundId): Promise<void> {
    this.db
      .prepare(
        `delete from rounds where id = ? and application_id in
           (select id from applications where user_id = ?)`,
      )
      .run(id, userId)
  }

  async writeDocument(meta: DocumentMeta, bytes: Uint8Array): Promise<void> {
    this.db
      .prepare(
        `insert into documents (id, user_id, label, filename, mime_type, size_bytes, created_at, bytes)
         values (@id, @userId, @label, @filename, @mimeType, @sizeBytes, @createdAt, @bytes)
         on conflict(id) do update set
           user_id = excluded.user_id, label = excluded.label, filename = excluded.filename,
           mime_type = excluded.mime_type, size_bytes = excluded.size_bytes,
           created_at = excluded.created_at, bytes = excluded.bytes`,
      )
      .run({
        id: meta.id,
        userId: meta.userId,
        label: meta.label,
        filename: meta.filename,
        mimeType: meta.mimeType,
        sizeBytes: meta.sizeBytes,
        createdAt: meta.createdAt,
        bytes: Buffer.from(bytes),
      })
  }

  async readDocumentBytes(userId: UserId, id: DocumentId): Promise<Uint8Array | undefined> {
    const row = this.db.prepare('select bytes from documents where id = ? and user_id = ?').get(id, userId) as
      | { bytes: Buffer }
      | undefined
    return row ? new Uint8Array(row.bytes) : undefined
  }

  async deleteDocument(userId: UserId, id: DocumentId): Promise<void> {
    // Any Application naming this Document has that reference cleared by its own foreign
    // key (`on delete set null`) — the same mechanism `prior_application_id` already
    // relies on, rather than a second query here to do by hand what the schema already
    // guarantees.
    this.db.prepare('delete from documents where id = ? and user_id = ?').run(id, userId)
  }

  private requirePositionOwner(positionId: PositionId): void {
    const exists = this.db.prepare('select 1 from positions where id = ?').get(positionId)
    if (!exists) throw new StorageError(`no Position "${positionId}" is stored`)
  }

  private requireApplicationOwner(applicationId: ApplicationId): void {
    const exists = this.db.prepare('select 1 from applications where id = ?').get(applicationId)
    if (!exists) throw new StorageError(`no Application "${applicationId}" is stored`)
  }
}
