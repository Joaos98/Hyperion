import { yearOf, type IsoDate } from './date.js'
import type { Currency, Money } from './money.js'
import { standingTermsAsOf, standingTermsHistory } from './position.js'
import { isPromotion, percentChange } from './position.js'
import { convert, findRate, type FoundRate } from './rates.js'
import type {
  OfferedTerms,
  User,
  Payment,
  Position,
  PositionId,
  RecordedRate,
  StandingTerms,
} from './types.js'

/**
 * A percentage change Hyperion could, or could not, compute — never a fabricated `0%`.
 * Switch Premium and Stay Premium both need at least two data points on a common
 * footing; a Position with only Starting Terms, or a career with only one Position,
 * has nothing to compare and says so rather than rendering a number with no basis
 * (the same suppression Atlas already applies to an undated goal with no progress yet).
 */
export type Premium =
  | { kind: 'available'; percent: number; from: Money; to: Money; conversions: FoundRate[] }
  | { kind: 'needs-rate'; fromCode: string; toCode: string; on: IsoDate }
  | { kind: 'unavailable'; reason: string }

/**
 * The currency this User's comparisons resolve to (CONTEXT.md § Display Currency), and the
 * scale a chart spanning two currencies is drawn against. Their own setting when they have
 * made one; otherwise the earliest Position's currency — which for a career that never
 * crossed a border is simply *the* currency, so a single-currency record needs no setting
 * and is never asked for one. `undefined` only before there is any Position at all, when
 * there is nothing to compare either.
 */
export function displayCurrency(user: User, positions: readonly Position[]): Currency | undefined {
  if (user.displayCurrency) return user.displayCurrency
  const earliest = [...positions].sort((a, b) => a.startDate.localeCompare(b.startDate))[0]
  return earliest?.currency
}

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

/**
 * The step from one figure to another as a percentage, with both sides read in `into` —
 * the User's Display Currency (CONTEXT.md § Display Currency), so every comparison on a
 * screen resolves to the same units rather than each pair picking its own.
 *
 * No rate on file is not the same as no answer: `needs-rate` names the pair and the date,
 * so the one place a rate is missing is the one place a User is asked for it (CONTEXT.md
 * § Recorded Rate — Hyperion asks only when a comparison actually needs one). Two rates
 * can be wanted at once, when neither side is already in the Display Currency; the first
 * missing one is asked for, and answering it surfaces the other.
 */
function percentOrUnavailable(
  from: Money,
  to: Money,
  into: Currency,
  rates: readonly RecordedRate[],
  on: IsoDate,
): Premium {
  const conversions: FoundRate[] = []
  const read = (money: Money): Money | Premium => {
    if (money.currency.code === into.code) return money
    const found = findRate(rates, money.currency.code, into.code, on)
    if (!found) {
      return { kind: 'needs-rate', fromCode: money.currency.code, toCode: into.code, on }
    }
    // One rate can serve both sides — naming it twice would read as two assumptions
    // where the figure rests on one.
    if (!conversions.some((seen) => seen.recorded.id === found.recorded.id)) conversions.push(found)
    return convert(money, into, found.rate)
  }

  const before = read(from)
  if ('kind' in before) return before
  const after = read(to)
  if ('kind' in after) return after

  if (before.minor === 0) {
    return { kind: 'unavailable', reason: 'the earlier figure is zero' }
  }
  const percent = ((after.minor - before.minor) / before.minor) * 100
  return { kind: 'available', percent, from: before, to: after, conversions }
}

/**
 * The Switch Premium between two Positions (CONTEXT.md § Switch Premium): the step from
 * `from`'s last Standing Terms to `to`'s Starting Terms. What changing jobs paid.
 */
export function switchPremium(
  from: { position: Position; terms: readonly StandingTerms[] },
  to: { position: Position; terms: readonly StandingTerms[] },
  into: Currency,
  rates: readonly RecordedRate[] = [],
): Premium {
  const last = standingTermsHistory(from.terms)[0]
  const starting = standingTermsHistory(to.terms).at(-1)
  if (!last || !starting) {
    return { kind: 'unavailable', reason: 'one of the two Positions has no Standing Terms yet' }
  }
  return percentOrUnavailable(
    totalOfTerms(last, from.position.currency),
    totalOfTerms(starting, to.position.currency),
    into,
    rates,
    to.position.startDate,
  )
}

/**
 * What an offer on the table is worth against what you are paid now (CONTEXT.md § Offered
 * Terms — "read beside the Current Position's Standing Terms, there is nothing left for a
 * dedicated feature to add"): the step from the Current Position's latest Standing Terms
 * to the Offered Terms, converted into the currency you are paid in today when the two
 * differ.
 *
 * The offer-time half of Switch Premium, and the more useful half — this figure can still
 * change something while an offer is being negotiated, where the same number after
 * Landing can only be read. Deliberately reads the offer as base plus target bonus, the
 * same two components `totalOfTerms` compares everywhere else, so an offer is never
 * flattered by a definition the record does not use.
 */
export function offerPremium(
  current: { position: Position; terms: readonly StandingTerms[] },
  offered: OfferedTerms,
  into: Currency,
  rates: readonly RecordedRate[] = [],
): Premium {
  const latest = standingTermsHistory(current.terms)[0]
  if (!latest) {
    return { kind: 'unavailable', reason: 'your Current Position has no Standing Terms to compare against' }
  }
  return percentOrUnavailable(
    totalOfTerms(latest, current.position.currency),
    { minor: offered.baseSalaryMinor + offered.targetBonusMinor, currency: offered.currency },
    into,
    rates,
    offered.startDate,
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
  // Never converted: a Stay Premium lives inside one Position, which has one currency.
  return { kind: 'available', percent: cagr, from: firstTotal, to: lastTotal, conversions: [] }
}

function daysApart(from: IsoDate, to: IsoDate): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
}

/** One consecutive pair of Positions and what changing between them paid. */
export interface Switch {
  from: Position
  to: Position
  premium: Premium
}

/**
 * The Position a switch into `to` came *from*: the one whose Departure is the most recent
 * on or before `to` began. Not simply the previous Position by start date — that pairing
 * treats a second job taken alongside the first as though the first had ended, and
 * reports changing jobs where nobody changed jobs (CONTEXT.md § Switch Premium: "what
 * changing jobs paid you"; § Current Position: holding two at once is ordinary). A
 * Position nobody had left yet is not something you switched away from.
 */
function leftFor(to: Position, positions: readonly Position[]): Position | undefined {
  let best: Position | undefined
  for (const candidate of positions) {
    if (candidate.id === to.id) continue
    const left = candidate.departure?.date
    if (!left || left > to.startDate) continue
    if (!best || left > best.departure!.date) best = candidate
  }
  return best
}

/**
 * Every job change in a career, oldest first, with its Switch Premium. Returned as the
 * pairs rather than only their average because a pair that is waiting on a Recorded Rate
 * has somewhere to be asked about, which an averaged-away number does not.
 *
 * At most one switch per Position, and only where a job was actually left: a career with
 * two Positions running at once produces no switch between them, and neither asks for a
 * rate to compare currencies that were never swapped for one another.
 */
export function switchPremiums(
  positions: readonly Position[],
  termsByPosition: ReadonlyMap<PositionId, readonly StandingTerms[]>,
  into: Currency,
  rates: readonly RecordedRate[] = [],
): Switch[] {
  const chronological = [...positions].sort((a, b) => a.startDate.localeCompare(b.startDate))
  const switches: Switch[] = []
  for (const to of chronological) {
    const from = leftFor(to, chronological)
    if (!from) continue
    switches.push({
      from,
      to,
      premium: switchPremium(
        { position: from, terms: termsByPosition.get(from.id) ?? [] },
        { position: to, terms: termsByPosition.get(to.id) ?? [] },
        into,
        rates,
      ),
    })
  }
  return switches
}

/**
 * The average Switch Premium across a whole career. `undefined` with fewer than two
 * Positions, or when every pair happens to be unavailable — never a zero standing in for
 * "no data", and never quietly averaging over a switch that is only missing a rate: the
 * view shows how many were left out (CONTEXT.md § Converted, an aggregation that cannot
 * honestly include something says so).
 */
export function averageSwitchPremiumPercent(
  positions: readonly Position[],
  termsByPosition: ReadonlyMap<PositionId, readonly StandingTerms[]>,
  into: Currency,
  rates: readonly RecordedRate[] = [],
): number | undefined {
  const percents = switchPremiums(positions, termsByPosition, into, rates)
    .map((entry) => entry.premium)
    .filter((premium) => premium.kind === 'available')
    .map((premium) => premium.percent)
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

/**
 * What one Standing Terms did to what a Position pays. `level` never appears in a series
 * — a Standing Terms that moved the title and nothing else is not a point on a
 * compensation chart, and is dropped rather than drawn flat — but the kind is named so
 * the reason for dropping it is stated rather than implied by a filter.
 */
export type PayChange = 'starting' | 'promotion' | 'raise' | 'cut' | 'level'

/** One moment a Position's pay changed, and what it changed to. */
export interface CompensationPoint {
  date: IsoDate
  money: Money
  terms: StandingTerms
  change: PayChange
  /** Against the previous point of the same Position. Absent on Starting Terms, which has nothing behind it. */
  percent?: number
}

/**
 * One Position's pay over time: the points at which it changed, and the date the line
 * stops. Drawn as its own run rather than joined to the next Position's, because the
 * stretch between two jobs is not a compensation of zero — it is an absence of one, and a
 * line dipping to the axis and back would assert a figure nobody recorded. Overlapping
 * Positions (contract work beside a salaried job, CONTEXT.md § Current Position) are
 * likewise two runs rather than a sum.
 */
export interface CompensationLine {
  position: Position
  points: CompensationPoint[]
  /** Departure, or today while the Position is current — where the last flat stretch ends. */
  endsAt: IsoDate
}

function classify(terms: StandingTerms, previous: StandingTerms | undefined, moved: number): PayChange {
  if (!previous) return 'starting'
  if (moved === 0) return 'level'
  if (isPromotion(terms, previous)) return 'promotion'
  return moved > 0 ? 'raise' : 'cut'
}

/**
 * Every Position's pay as a series of the moments it moved (CONTEXT.md § Standing Terms:
 * terms are carried forward unchanged until a later event supersedes them, so the moments
 * between two events hold no information a line does not already show by being flat).
 *
 * A calendar year is not one of those moments. A year in which nothing happened is not a
 * data point — it is the same figure restated — and a series built from years spends most
 * of its width redrawing what the reader already knows while hiding the month a raise
 * actually landed. Standing Terms already carry the only dates that mean anything here.
 *
 * Points are dropped where pay did not move: a Standing Terms recording a title change
 * alone belongs to the Timeline, not to a chart of what a job paid. Starting Terms is
 * always kept, including where a new Position starts at exactly the old one's figure —
 * moving jobs for no money is itself worth seeing, and the run has to begin somewhere.
 */
export function compensationLines(
  positions: readonly Position[],
  termsByPosition: ReadonlyMap<PositionId, readonly StandingTerms[]>,
  today: IsoDate,
): CompensationLine[] {
  const chronological = [...positions].sort((a, b) => a.startDate.localeCompare(b.startDate))
  const lines: CompensationLine[] = []

  for (const position of chronological) {
    const history = standingTermsHistory(termsByPosition.get(position.id) ?? [])
      .slice()
      .reverse() // oldest first

    const points: CompensationPoint[] = []
    let previous: StandingTerms | undefined
    let previousTotal: Money | undefined

    for (const terms of history) {
      const money = totalOfTerms(terms, position.currency)
      const moved = previousTotal ? money.minor - previousTotal.minor : 0
      const change = classify(terms, previous, moved)
      previous = terms
      if (change === 'level') continue

      points.push({
        date: terms.effectiveDate,
        money,
        terms,
        change,
        percent:
          previousTotal && previousTotal.minor !== 0
            ? percentChange(previousTotal.minor, money.minor)
            : undefined,
      })
      previousTotal = money
    }

    if (points.length > 0) {
      lines.push({ position, points, endsAt: position.departure?.date ?? today })
    }
  }

  return lines
}
