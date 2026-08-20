import { describe, expect, it } from 'vitest'
import { DomainError } from './errors.js'
import type { Currency } from './money.js'
import { convert, describeRate, findRate, formatRate, toRate } from './rates.js'
import type { RecordedRate } from './types.js'

const BRL: Currency = { code: 'BRL', symbol: 'R$', decimals: 2 }
const USD: Currency = { code: 'USD', symbol: '$', decimals: 2 }
const JPY: Currency = { code: 'JPY', symbol: '¥', decimals: 0 }

function rate(over: Partial<RecordedRate> = {}): RecordedRate {
  return {
    id: 'rate-1',
    userId: 'user-1',
    fromCode: 'USD',
    toCode: 'BRL',
    date: '2025-03-01',
    rateMinor: 54231,
    rateDecimals: 4,
    ...over,
  }
}

describe('toRate', () => {
  it('reads a rate at the precision it was typed to', () => {
    expect(toRate('5.4231')).toEqual({ minor: 54231, decimals: 4 })
  })

  it('reads a whole-number rate', () => {
    expect(toRate('5')).toEqual({ minor: 5, decimals: 0 })
  })

  it('reads a comma as the decimal separator', () => {
    expect(toRate('5,42')).toEqual({ minor: 542, decimals: 2 })
  })

  it('refuses a zero rate, which no conversion could use', () => {
    expect(() => toRate('0')).toThrow(DomainError)
  })

  it('refuses a negative rate', () => {
    expect(() => toRate('-5.42')).toThrow(DomainError)
  })

  it('refuses text', () => {
    expect(() => toRate('five')).toThrow(DomainError)
  })
})

describe('formatRate', () => {
  it('renders a rate as it was typed', () => {
    expect(formatRate({ minor: 54231, decimals: 4 })).toBe('5.4231')
  })

  it('renders a whole-number rate without a point', () => {
    expect(formatRate({ minor: 5, decimals: 0 })).toBe('5')
  })

  it('keeps a leading zero on a rate below one', () => {
    expect(formatRate({ minor: 1844, decimals: 4 })).toBe('0.1844')
  })

  it('round-trips through toRate', () => {
    expect(formatRate(toRate('5.4231'))).toBe('5.4231')
  })
})

describe('describeRate', () => {
  it('reads as the sentence a User was asked to fill in', () => {
    expect(describeRate(rate())).toBe('1 USD = 5.4231 BRL')
  })
})

describe('convert', () => {
  it('converts at the rate, rounding to the target currency precision', () => {
    // $120,000 at 5.4231 is R$650,772.00 exactly.
    const converted = convert({ minor: 12_000_000, currency: USD }, BRL, toRate('5.4231'))
    expect(converted).toEqual({ minor: 65_077_200, currency: BRL })
  })

  it('converts into a currency with fewer decimals than the source', () => {
    // R$1,000.00 at 25.5 is ¥25,500 — no minor units on the far side.
    const converted = convert({ minor: 100_000, currency: BRL }, JPY, toRate('25.5'))
    expect(converted).toEqual({ minor: 25_500, currency: JPY })
  })

  it('converts out of a currency with fewer decimals than the target', () => {
    const converted = convert({ minor: 25_500, currency: JPY }, BRL, toRate('0.0392'))
    expect(converted).toEqual({ minor: 99_960, currency: BRL })
  })

  it('leaves an amount already in the target currency untouched', () => {
    const same = { minor: 12_000_000, currency: USD }
    expect(convert(same, USD, toRate('5.4231'))).toBe(same)
  })

  it('refuses rather than losing exactness on an amount too large to convert', () => {
    expect(() => convert({ minor: Number.MAX_SAFE_INTEGER, currency: USD }, BRL, toRate('5.4231'))).toThrow(
      DomainError,
    )
  })
})

describe('findRate', () => {
  it('finds a rate recorded in the direction asked for', () => {
    const found = findRate([rate()], 'USD', 'BRL', '2025-03-01')
    expect(found?.inverted).toBe(false)
    expect(found?.rate).toEqual({ minor: 54231, decimals: 4 })
  })

  it('answers the other direction from the same recorded rate', () => {
    const found = findRate([rate()], 'BRL', 'USD', '2025-03-01')
    expect(found?.inverted).toBe(true)
    expect(found?.recorded.id).toBe('rate-1')
  })

  it('inverts closely enough to land back where it started', () => {
    const there = convert({ minor: 12_000_000, currency: USD }, BRL, findRate([rate()], 'USD', 'BRL', '2025-03-01')!.rate)
    const back = convert(there, USD, findRate([rate()], 'BRL', 'USD', '2025-03-01')!.rate)
    expect(back.minor).toBe(12_000_000)
  })

  it('takes the rate nearest the date asked about, not the newest', () => {
    const rates = [
      rate({ id: 'near', date: '2025-04-01', rateMinor: 55000 }),
      rate({ id: 'far', date: '2026-01-01', rateMinor: 60000 }),
    ]
    expect(findRate(rates, 'USD', 'BRL', '2025-03-01')?.recorded.id).toBe('near')
  })

  it('has nothing for a pair no rate was recorded for', () => {
    expect(findRate([rate()], 'EUR', 'BRL', '2025-03-01')).toBeUndefined()
  })

  it('has nothing for a pair that is one currency, which needs no rate', () => {
    expect(findRate([rate()], 'BRL', 'BRL', '2025-03-01')).toBeUndefined()
  })
})
