import type { IsoDate } from './date.js'
import { DomainError } from './errors.js'
import type { Currency, Minor, Money } from './money.js'
import type { RecordedRate } from './types.js'

/**
 * The scale a rate is held at: `minor` is the rate multiplied by 10^`decimals`, so
 * "1 USD = 5.4231 BRL" is `{ minor: 54231, decimals: 4 }`. Precision travels with the
 * rate rather than being assumed from either currency, the same call `Currency` makes
 * for amounts — rates are quoted to four or five places where salaries are held to two,
 * and rounding one to the other costs real money on a six-figure figure.
 */
export interface Rate {
  minor: Minor
  decimals: number
}

const RATE = /^(\d+)(?:[.,](\d+))?$/

/** Reads a rate as typed. Refuses zero and anything non-numeric rather than coercing. */
export function toRate(entered: string): Rate {
  const match = RATE.exec(entered.trim())
  if (!match) throw new DomainError(`"${entered}" is not a rate`)

  const [, whole, fraction = ''] = match
  const magnitude = Number(`${whole}${fraction}`)
  if (!Number.isSafeInteger(magnitude)) {
    throw new DomainError(`"${entered}" is finer than a rate Hyperion can hold`)
  }
  if (magnitude === 0) throw new DomainError('a rate cannot be zero')
  return { minor: magnitude, decimals: fraction.length }
}

/** Renders a rate as it was typed — what `toRate` will read again. */
export function formatRate(rate: Rate): string {
  const digits = String(rate.minor).padStart(rate.decimals + 1, '0')
  const whole = digits.slice(0, digits.length - rate.decimals)
  const fraction = rate.decimals === 0 ? '' : digits.slice(digits.length - rate.decimals)
  return fraction ? `${whole}.${fraction}` : whole
}

/** "1 USD = 5.4231 BRL" — how a Recorded Rate reads wherever one is shown. */
export function describeRate(recorded: RecordedRate): string {
  const rate: Rate = { minor: recorded.rateMinor, decimals: recorded.rateDecimals }
  return `1 ${recorded.fromCode} = ${formatRate(rate)} ${recorded.toCode}`
}

function daysApart(from: IsoDate, to: IsoDate): number {
  return Math.abs(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
}

/**
 * A Recorded Rate found for one pair, oriented so it reads `from` → `to`. A rate entered
 * one way answers the other: "1 USD = 5.42 BRL" is the same fact as "1 BRL = 1/5.42 USD",
 * and asking a User to type both would be asking twice for one answer. `inverted` says
 * which way it was stored, so a figure can name the rate the User actually entered rather
 * than a reciprocal they never saw.
 */
export interface FoundRate {
  recorded: RecordedRate
  rate: Rate
  inverted: boolean
}

/**
 * The Recorded Rate to use for `from` → `to` at `on`: the one whose date is nearest,
 * either direction of the pair. Nearest rather than on-or-before, because a rate is
 * remembered to be reused (CONTEXT.md § Recorded Rate) and re-asking for a rate already
 * on file would defeat that — what keeps it honest is not narrowing the match but
 * showing which rate was used and when (CONTEXT.md § Converted), which every caller does.
 */
export function findRate(
  rates: readonly RecordedRate[],
  from: string,
  to: string,
  on: IsoDate,
): FoundRate | undefined {
  if (from === to) return undefined
  const candidates = rates.filter(
    (rate) =>
      (rate.fromCode === from && rate.toCode === to) || (rate.fromCode === to && rate.toCode === from),
  )
  if (candidates.length === 0) return undefined

  const nearest = candidates.reduce((best, rate) =>
    daysApart(rate.date, on) < daysApart(best.date, on) ? rate : best,
  )
  const inverted = nearest.fromCode !== from
  return {
    recorded: nearest,
    rate: inverted ? invert(nearest) : { minor: nearest.rateMinor, decimals: nearest.rateDecimals },
    inverted,
  }
}

/**
 * The reciprocal, held to enough places that converting by it and converting back lands
 * on the amount you started from rather than a cent away. Twelve is far past any quoted
 * rate's own precision; the arithmetic below is exact at any size, so the only cost of
 * more places is a longer integer.
 */
const INVERSE_DECIMALS = 12

function invert(recorded: RecordedRate): Rate {
  const scale = 10n ** BigInt(recorded.rateDecimals + INVERSE_DECIMALS)
  return { minor: Number(divideRounding(scale, BigInt(recorded.rateMinor))), decimals: INVERSE_DECIMALS }
}

/** Integer division rounded to nearest, halves away from zero. */
function divideRounding(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n
  const [a, b] = [abs(numerator), abs(denominator)]
  const rounded = (2n * a + b) / (2n * b)
  return negative ? -rounded : rounded
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value
}

/**
 * `amount` expressed in `into`, at `rate`. The result is a plain `Money` — nothing here
 * marks it as Converted, because that mark belongs to the figure as shown, beside the
 * rate and its date (CONTEXT.md § Converted), and the domain has no say in what a view
 * writes. Refuses rather than approximates when the arithmetic would leave the range
 * integers hold exactly, the same guard `toMinor` applies to an amount typed too large.
 */
export function convert(amount: Money, into: Currency, rate: Rate): Money {
  if (amount.currency.code === into.code) return amount

  // Exact at any size: the intermediate product of an amount and a twelve-place rate
  // leaves the range a double holds exactly long before either operand does, and a
  // converted salary that drifted by a cent per round trip would be its own small lie.
  const scaled = BigInt(amount.minor) * BigInt(rate.minor)
  const shift = into.decimals - amount.currency.decimals - rate.decimals
  const exact = shift >= 0 ? scaled * 10n ** BigInt(shift) : divideRounding(scaled, 10n ** BigInt(-shift))

  const minor = Number(exact)
  if (!Number.isSafeInteger(minor)) {
    throw new DomainError(
      `converting ${amount.minor} ${amount.currency.code} at this rate exceeds what Hyperion can hold exactly`,
    )
  }
  return { minor, currency: into }
}
