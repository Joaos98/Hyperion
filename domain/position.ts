import { daysBetween, elapsed, type IsoDate } from './date.js'
import { DomainError } from './errors.js'
import type { Payment, Position, StandingTerms } from './types.js'

/** A Position with no Departure (CONTEXT.md § Current Position). */
export function isCurrent(position: Position): boolean {
  return position.departure === null
}

/**
 * `terms`, newest first — the order a Position's history is always read in, since the
 * most recent Standing Terms is what a résumé and a position header both show.
 */
export function standingTermsHistory(terms: readonly StandingTerms[]): StandingTerms[] {
  return [...terms].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
}

/**
 * What a Position paid on `asOf`: the latest Standing Terms whose effective date has not
 * yet arrived. `undefined` before the first Standing Terms takes effect — a Position with
 * no terms in force yet has nothing to report, not a zero.
 */
export function standingTermsAsOf(
  terms: readonly StandingTerms[],
  asOf: IsoDate,
): StandingTerms | undefined {
  const inForce = terms.filter((row) => row.effectiveDate <= asOf)
  if (inForce.length === 0) return undefined
  return inForce.reduce((latest, row) => (row.effectiveDate > latest.effectiveDate ? row : latest))
}

/** The Standing Terms currently in force for a Position, as of today. */
export function currentStandingTerms(
  terms: readonly StandingTerms[],
  today: IsoDate,
): StandingTerms | undefined {
  return standingTermsAsOf(terms, today)
}

/** How long a Position has run: its start date to its Departure, or to today while current. */
export function tenure(position: Position, today: IsoDate): { years: number; months: number } {
  const end = position.departure?.date ?? today
  return elapsed(position.startDate, end)
}

/**
 * A Position Event (CONTEXT.md § Position Event): either a Standing Terms row taking
 * effect, or a Payment landing. The umbrella is assembled here rather than stored,
 * exactly as the timeline itself is assembled rather than stored — Standing Terms and
 * Payments stay in separate tables because they are superseded and accumulated by
 * opposite arithmetic, and merging them is a read-time concern, not a write-time one.
 */
export type PositionEvent =
  | { kind: 'standing-terms'; date: IsoDate; terms: StandingTerms; previous: StandingTerms | undefined }
  | { kind: 'payment'; date: IsoDate; payment: Payment }

/** Every Position Event for one Position, oldest first. */
export function positionEvents(
  terms: readonly StandingTerms[],
  payments: readonly Payment[],
): PositionEvent[] {
  const byDate = standingTermsHistory(terms).slice().reverse() // oldest first
  const termEvents: PositionEvent[] = byDate.map((row, index) => ({
    kind: 'standing-terms',
    date: row.effectiveDate,
    terms: row,
    previous: byDate[index - 1],
  }))
  const paymentEvents: PositionEvent[] = payments.map((payment) => ({
    kind: 'payment',
    date: payment.date,
    payment,
  }))
  return [...termEvents, ...paymentEvents].sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * The Switch Premium and Stay Premium arithmetic both need a percentage change between
 * two base figures — thrown, rather than returning `Infinity` or `NaN`, when the earlier
 * figure is zero and a percentage genuinely has no meaning.
 */
export function percentChange(from: number, to: number): number {
  if (from === 0) {
    throw new DomainError('cannot express a percentage change from a base of zero')
  }
  return ((to - from) / from) * 100
}

/**
 * A Standing Terms row that carries both a new title and new compensation is a Promotion
 * (CONTEXT.md § Promotion); a title change with no money and a raise with no title are
 * each ordinary Standing Terms. There is no first Standing Terms to compare against, so
 * Starting Terms is never a Promotion.
 */
export function isPromotion(terms: StandingTerms, previous: StandingTerms | undefined): boolean {
  if (!previous) return false
  const titleChanged = terms.title !== previous.title
  const payChanged =
    terms.baseSalaryMinor !== previous.baseSalaryMinor ||
    terms.targetBonusMinor !== previous.targetBonusMinor
  return titleChanged && payChanged
}

/** Days since a Position's most recent event, for a staleness or attention signal. */
export function daysSinceLastEvent(events: readonly PositionEvent[], today: IsoDate): number | undefined {
  if (events.length === 0) return undefined
  const last = events.reduce((latest, event) => (event.date > latest.date ? event : latest))
  return daysBetween(last.date, today)
}
