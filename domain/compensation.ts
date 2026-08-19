import { yearOf, type IsoDate } from './date.js'
import type { Currency, Money } from './money.js'
import { standingTermsAsOf, standingTermsHistory } from './position.js'
import type { Payment, Position, PositionId, StandingTerms } from './types.js'

/**
 * A percentage change Hyperion could, or could not, compute — never a fabricated `0%`.
 * Switch Premium and Stay Premium both need at least two data points on a common
 * footing; a Position with only Starting Terms, or a career with only one Position,
 * has nothing to compare and says so rather than rendering a number with no basis
 * (the same suppression Atlas already applies to an undated goal with no progress yet).
 */
export type Premium =
  | { kind: 'available'; percent: number; from: Money; to: Money }
  | { kind: 'unavailable'; reason: string }

/** Base salary plus Target Bonus of one Standing Terms row, in its Position's currency. */
export function totalOfTerms(terms: StandingTerms, currency: Currency): Money {
  return { minor: terms.baseSalaryMinor + terms.targetBonusMinor, currency }
}

/**
 * An annual figure divided evenly across twelve months, for a User who reads
 * `User.compensationDisplay` as `'monthly'` — a display-time choice only. Every Standing
 * Terms figure, and everything derived from one, stays stored and computed at annual
 * scale regardless of this; only the rendered text changes.
 */
export function perMonth(annual: Money): Money {
  return { minor: Math.round(annual.minor / 12), currency: annual.currency }
}

/**
 * The Standing Terms a Total Compensation figure for `year` is read from: the Position's
 * Departure if it left within that year, today if `year` is still running, otherwise the
 * last instant of that year — deliberately not time-weighted across a mid-year change, so
 * a promotion in March is what next year's bar reflects rather than a blended fiction.
 */
function yearEndCutoff(position: Position, year: number, today: IsoDate): IsoDate {
  const departureYear = position.departure ? yearOf(position.departure.date) : undefined
  if (departureYear !== undefined && year >= departureYear) return position.departure!.date
  const currentYear = yearOf(today)
  if (year >= currentYear) return today
  return `${year}-12-31`
}

/**
 * Total Compensation for one Position in one calendar year (CONTEXT.md § Total
 * Compensation): the Standing Terms in force at the year's cutoff, plus every Payment
 * actually dated within that year. `undefined` before the Position's first Standing
 * Terms takes effect, or outside the year range the Position covers at all.
 */
export function totalCompensationForYear(
  position: Position,
  terms: readonly StandingTerms[],
  payments: readonly Payment[],
  year: number,
  today: IsoDate,
): Money | undefined {
  if (year < yearOf(position.startDate)) return undefined
  const cutoff = yearEndCutoff(position, year, today)
  const standing = standingTermsAsOf(terms, cutoff)
  if (!standing) return undefined

  const paid = payments
    .filter((payment) => yearOf(payment.date) === year)
    .reduce((sum, payment) => sum + payment.amountMinor, 0)

  const base = totalOfTerms(standing, position.currency)
  return { minor: base.minor + paid, currency: position.currency }
}

/** Every calendar year a Position has Total Compensation for, oldest first. */
export function yearsCovered(position: Position, terms: readonly StandingTerms[], today: IsoDate): number[] {
  if (terms.length === 0) return []
  const first = standingTermsHistory(terms).at(-1)!
  const startYear = yearOf(first.effectiveDate)
  const endYear = yearOf(position.departure?.date ?? today)
  const years: number[] = []
  for (let year = startYear; year <= endYear; year++) years.push(year)
  return years
}

function percentOrUnavailable(from: Money, to: Money): Premium {
  if (from.currency.code !== to.currency.code) {
    return { kind: 'unavailable', reason: 'needs a Recorded Rate to compare currencies' }
  }
  if (from.minor === 0) {
    return { kind: 'unavailable', reason: 'the earlier figure is zero' }
  }
  const percent = ((to.minor - from.minor) / from.minor) * 100
  return { kind: 'available', percent, from, to }
}

/**
 * The Switch Premium between two Positions (CONTEXT.md § Switch Premium): the step from
 * `from`'s last Standing Terms to `to`'s Starting Terms. What changing jobs paid.
 */
export function switchPremium(
  from: { position: Position; terms: readonly StandingTerms[] },
  to: { position: Position; terms: readonly StandingTerms[] },
): Premium {
  const last = standingTermsHistory(from.terms)[0]
  const starting = standingTermsHistory(to.terms).at(-1)
  if (!last || !starting) {
    return { kind: 'unavailable', reason: 'one of the two Positions has no Standing Terms yet' }
  }
  return percentOrUnavailable(
    totalOfTerms(last, from.position.currency),
    totalOfTerms(starting, to.position.currency),
  )
}

/**
 * The Stay Premium within one Position (CONTEXT.md § Stay Premium): compound annual
 * growth from its Starting Terms to its latest Standing Terms. What staying paid,
 * expressed the same way a raise is always spoken of — per year.
 */
export function stayPremium(position: Position, terms: readonly StandingTerms[]): Premium {
  const history = standingTermsHistory(terms)
  if (history.length < 2) {
    return { kind: 'unavailable', reason: 'needs a second Standing Terms to show growth' }
  }
  const first = history.at(-1)!
  const last = history[0]!

  const years = daysApart(first.effectiveDate, last.effectiveDate) / 365.25
  if (years <= 0) {
    return { kind: 'unavailable', reason: 'the two Standing Terms share an effective date' }
  }

  const firstTotal = totalOfTerms(first, position.currency)
  const lastTotal = totalOfTerms(last, position.currency)
  if (firstTotal.minor === 0) {
    return { kind: 'unavailable', reason: 'the earlier figure is zero' }
  }

  const cagr = (Math.pow(lastTotal.minor / firstTotal.minor, 1 / years) - 1) * 100
  return { kind: 'available', percent: cagr, from: firstTotal, to: lastTotal }
}

function daysApart(from: IsoDate, to: IsoDate): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
}

/**
 * The average Switch Premium across a whole career: one figure per consecutive pair of
 * Positions, ordered by start date. `undefined` with fewer than two Positions, or when
 * every pair happens to be unavailable — never a zero standing in for "no data".
 */
export function averageSwitchPremiumPercent(
  positions: readonly Position[],
  termsByPosition: ReadonlyMap<PositionId, readonly StandingTerms[]>,
): number | undefined {
  const chronological = [...positions].sort((a, b) => a.startDate.localeCompare(b.startDate))
  const percents: number[] = []
  for (let i = 1; i < chronological.length; i++) {
    const from = chronological[i - 1]!
    const to = chronological[i]!
    const result = switchPremium(
      { position: from, terms: termsByPosition.get(from.id) ?? [] },
      { position: to, terms: termsByPosition.get(to.id) ?? [] },
    )
    if (result.kind === 'available') percents.push(result.percent)
  }
  return average(percents)
}

/** The average Stay Premium across every Position that has one. */
export function averageStayPremiumPercent(
  positions: readonly Position[],
  termsByPosition: ReadonlyMap<PositionId, readonly StandingTerms[]>,
): number | undefined {
  const percents: number[] = []
  for (const position of positions) {
    const result = stayPremium(position, termsByPosition.get(position.id) ?? [])
    if (result.kind === 'available') percents.push(result.percent)
  }
  return average(percents)
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  return values.reduce((sum, value) => sum + value, 0) / values.length
}
