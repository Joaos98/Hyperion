import { DomainError } from './errors.js'

/** An amount, always an integer number of minor units of its currency. */
export type Minor = number

/**
 * A currency an amount is denominated in. `decimals` is its minor-unit precision:
 * amounts are integers of 10^-decimals. Stored on the Position that chose it, never
 * assumed from a lookup table — JPY and BRL both have to be representable in the same
 * career, and only the Position that pays in one knows which it is.
 */
export interface Currency {
  code: string
  symbol: string
  decimals: number
}

/**
 * An amount, always carried with the currency it is denominated in. Never a bare number
 * anywhere in the domain: a figure without its currency attached is exactly the shape
 * that turns currency conversion, when it arrives, into a rewrite of every function that
 * touches compensation rather than an addition to one.
 */
export interface Money {
  minor: Minor
  currency: Currency
}

const AMOUNT = /^(-)?(\d+)(?:[.,](\d+))?$/

/**
 * Reads an amount as typed into integer minor units of the currency. Anything finer than
 * the currency's precision is refused rather than rounded, so no amount in Hyperion ever
 * comes from a floating-point value.
 */
export function toMinor(entered: string, currency: Currency): Minor {
  const match = AMOUNT.exec(entered.trim())
  if (!match) throw new DomainError(`"${entered}" is not an amount`)

  const [, sign, whole, fraction = ''] = match
  if (fraction.length > currency.decimals) {
    throw new DomainError(
      `${currency.code} is held to ${currency.decimals} decimals, so "${entered}" cannot be stored exactly`,
    )
  }

  const padded = fraction.padEnd(currency.decimals, '0')
  const magnitude = Number(`${whole}${padded}`)
  if (!Number.isSafeInteger(magnitude)) {
    throw new DomainError(`"${entered}" is larger than an amount Hyperion can hold`)
  }
  return sign === '-' && magnitude !== 0 ? -magnitude : magnitude
}

/** Every third digit from the right, which is where a thousands separator goes. */
const THOUSANDS = /\B(?=(\d{3})+$)/g

function digitsOf(minor: Minor, currency: Currency) {
  const digits = String(Math.abs(minor)).padStart(currency.decimals + 1, '0')
  return {
    sign: minor < 0 ? '-' : '',
    whole: digits.slice(0, digits.length - currency.decimals),
    fraction: currency.decimals === 0 ? '' : digits.slice(digits.length - currency.decimals),
  }
}

/** Renders an amount at its currency's own precision, thousands grouped. */
export function formatAmount(money: Money): string {
  const { sign, whole, fraction } = digitsOf(money.minor, money.currency)
  const grouped = whole.replace(THOUSANDS, ',')
  return `${sign}${money.currency.symbol}${grouped}${fraction ? `.${fraction}` : ''}`
}

/** The same amount as typed: no symbol, no grouping — what `toMinor` will read again. */
export function plainAmount(money: Money): string {
  const { sign, whole, fraction } = digitsOf(money.minor, money.currency)
  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`
}

/**
 * Adds two amounts. Refuses rather than coerces when the currencies differ — the
 * Recorded Rate this would need does not exist yet, and a total that silently mixed
 * currencies would be a number nobody could trust.
 */
export function addMoney(a: Money, b: Money): Money {
  if (a.currency.code !== b.currency.code) {
    throw new DomainError(
      `cannot combine ${a.currency.code} and ${b.currency.code} without a Recorded Rate`,
    )
  }
  return { minor: a.minor + b.minor, currency: a.currency }
}

/**
 * An amount that may or may not exist in a single currency. What every aggregation in
 * Hyperion returns rather than a bare `Money`, so that the day a figure spans two
 * currencies — a mid-year switch from a BRL position to a EUR one — it says so instead
 * of quietly answering the wrong number. Nothing produces `mixed` yet; the shape is what
 * makes adding a Recorded Rate later an addition rather than a rewrite.
 */
export type MoneyOrMixed = { kind: 'amount'; money: Money } | { kind: 'mixed'; currencies: string[] }

/** Sums a list of amounts, or `undefined` if the list is empty — never a fabricated zero. */
export function sumMoney(amounts: Money[]): MoneyOrMixed | undefined {
  if (amounts.length === 0) return undefined
  const currencies = [...new Set(amounts.map((money) => money.currency.code))]
  if (currencies.length > 1) return { kind: 'mixed', currencies }
  return { kind: 'amount', money: amounts.reduce(addMoney) }
}
