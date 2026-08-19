import type { Currency, Minor } from './money.js'
import type { IsoDate } from './date.js'

/** A User's identity, stable for as long as the account exists. */
export type UserId = string

/** A Position's identity, stable for as long as the Position exists. */
export type PositionId = string

/** A Standing Terms row's identity. */
export type StandingTermsId = string

/** A Payment's identity. */
export type PaymentId = string

/** An Achievement's identity. */
export type AchievementId = string

/** An Application's identity, stable for as long as it exists — Landing does not consume it. */
export type ApplicationId = string

/** An Application Event's identity. */
export type ApplicationEventId = string

/** A Document's identity. */
export type DocumentId = string

/**
 * A person with a login and the private set of records behind it (CONTEXT.md § User).
 * Every domain row below belongs to exactly one User; nothing in `domain/` enforces that
 * — scoping is a `storage/` and `server/` concern, so this type carries no access logic.
 */
export interface User {
  id: UserId
  displayName: string
  /** One bit: can invite other Users and reset their passwords. */
  isAdmin: boolean
  /** How long a quiet stretch of Timeline must run before it Folds. */
  foldThresholdDays: number
  /** How long an Open Application may go silent before it counts as Stalled. */
  stallThresholdDays: number
  /**
   * How a point-in-time salary figure (Standing Terms, Current Position) renders —
   * never how one is stored, which stays annual throughout `domain/compensation.ts`
   * regardless of this. A year-over-year total, like the Compensation page's chart,
   * ignores this: dividing a whole year's figure by twelve would misrepresent it, not
   * just redisplay it.
   */
  compensationDisplay: 'annual' | 'monthly'
  /**
   * This User's own key for the AI layer (plan § AI is additive, never load-bearing).
   * `null` until they paste one in; every AI feature stays visible but inactive without
   * it, and nothing is ever sent anywhere on this User's behalf until it is set.
   */
  aiApiKey: string | null
}

/** The legal shape of a Position as of a date (CONTEXT.md § Employment Type). */
export type EmploymentType = 'clt' | 'pj' | 'contract' | 'internship'

/** The end of a Position: a date and a reason, recorded plainly (CONTEXT.md § Departure). */
export interface Departure {
  date: IsoDate
  reason: string
}

/**
 * A job held — one continuous stint at one employer (CONTEXT.md § Position). Titles and
 * Employment Type live on its Standing Terms, not here: a promotion or a PJ→CLT
 * conversion is an event on a Position, never a new one.
 */
export interface Position {
  id: PositionId
  userId: UserId
  company: string
  /** Chosen once, at creation; every Standing Terms and Payment on this Position inherits it. */
  currency: Currency
  startDate: IsoDate
  departure: Departure | null
}

/**
 * What a Position pays as of a given date (CONTEXT.md § Standing Terms) — a state that a
 * later Standing Terms row supersedes, never a delta added to the one before it.
 */
export interface StandingTerms {
  id: StandingTermsId
  positionId: PositionId
  effectiveDate: IsoDate
  title: string
  employmentType: EmploymentType
  baseSalaryMinor: Minor
  targetBonusMinor: Minor
}

/**
 * Money that actually arrived on a date and changed nothing going forward (CONTEXT.md §
 * Payment) — a bonus paid today, an equity Tranche vesting once Phase 2 lands. `label` is
 * free text ("Annual bonus", "Retention bonus") rather than a fixed kind, since the set
 * of reasons money arrives is exactly the kind of detail that belongs in prose.
 */
export interface Payment {
  id: PaymentId
  positionId: PositionId
  date: IsoDate
  amountMinor: Minor
  label: string
}

/**
 * A dated record of something done and what it changed (CONTEXT.md § Achievement).
 * `positionId` is required: every Achievement belongs to the Position it was done under,
 * and Hyperion refuses to delete a Position that still has any (`deletePosition`) rather
 * than orphan them.
 */
export interface Achievement {
  id: AchievementId
  userId: UserId
  positionId: PositionId
  date: IsoDate
  text: string
  impact: string | null
}

/**
 * A named point in the pipeline (CONTEXT.md § Stage): a fixed list, not a user-defined
 * workflow, because a funnel only means something if every Application is measured
 * against the same points.
 */
export type Stage = 'saved' | 'applied' | 'screen' | 'interview' | 'offer' | 'rejected' | 'withdrawn' | 'landed'

/**
 * What a posting claimed the job pays (CONTEXT.md § Advertised Range) — a claim about a
 * market, in its own currency, recorded so it can later be read beside what was actually
 * offered. A single-figure posting is `min === max`.
 */
export interface AdvertisedRange {
  minMinor: Minor
  maxMinor: Minor
  currency: Currency
}

/**
 * What an employer actually put in writing (CONTEXT.md § Offered Terms) — the thing
 * Landing carries across to become a Position's Starting Terms, and the whole of what an
 * offer-comparison feature would have been: read beside the Current Position's Standing
 * Terms, there is nothing left for a dedicated feature to add.
 */
export interface OfferedTerms {
  baseSalaryMinor: Minor
  targetBonusMinor: Minor
  employmentType: EmploymentType
  startDate: IsoDate
  currency: Currency
}

/**
 * A job pursued but not held (CONTEXT.md § Application) — a prospective Position. Not
 * grouped into campaigns: openings arrive continuously, and a date range over
 * Application Events answers whatever a named grouping would.
 */
export interface Application {
  id: ApplicationId
  userId: UserId
  company: string
  title: string
  /** How it arrived — a named board, a referral, a recruiter's message. Free text. */
  source: string
  postingUrl: string | null
  advertisedRange: AdvertisedRange | null
  /** Present once an offer arrives; what Landing needs to mint a Position. */
  offeredTerms: OfferedTerms | null
  /** Which Document, if any, was sent with this Application. */
  documentId: DocumentId | null
  /**
   * Unused until there is a corpus of Applications to check a new one against
   * (plan § When a search starts). The column exists now because it is migration-hostile
   * later and free today.
   */
  priorApplicationId: ApplicationId | null
}

/**
 * The record of an Application entering a Stage on a date (CONTEXT.md § Application
 * Event). The event log is the entire pipeline history — nothing about where an
 * Application stands is stored anywhere else (§ Status).
 */
export interface ApplicationEvent {
  id: ApplicationEventId
  applicationId: ApplicationId
  stage: Stage
  date: IsoDate
  note: string | null
}

/**
 * A résumé or cover letter as it was actually sent (CONTEXT.md § Document): the metadata
 * half. The bytes are not part of this type — they are fetched separately, the same way
 * `HyperionStore.loadUserRecord` never carries them, so listing Documents stays cheap
 * regardless of how large the files behind them are.
 */
export interface DocumentMeta {
  id: DocumentId
  userId: UserId
  label: string
  filename: string
  mimeType: string
  sizeBytes: number
  createdAt: IsoDate
}
