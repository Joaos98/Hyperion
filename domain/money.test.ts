import { describe, expect, it } from 'vitest'
import { DomainError } from './errors.js'
import { addMoney, formatAmount, plainAmount, sumMoney, toMinor, type Currency } from './money.js'

const EUR: Currency = { code: 'EUR', symbol: '€', decimals: 2 }
const BRL: Currency = { code: 'BRL', symbol: 'R$', decimals: 2 }
const JPY: Currency = { code: 'JPY', symbol: '¥', decimals: 0 }

describe('toMinor', () => {
  it('reads a plain amount into minor units', () => {
    expect(toMinor('91500', EUR)).toBe(9150000)
  })

  it('reads a decimal amount', () => {
    expect(toMinor('91500.50', EUR)).toBe(9150050)
  })

  it('reads a comma as the decimal separator', () => {
    expect(toMinor('91500,50', EUR)).toBe(9150050)
  })

  it('reads a negative amount', () => {
    expect(toMinor('-500', EUR)).toBe(-50000)
  })

  it('refuses more precision than the currency holds, rather than rounding', () => {
    expect(() => toMinor('91500.505', EUR)).toThrow(DomainError)
  })

  it('holds a zero-decimal currency to whole units', () => {
    expect(toMinor('91500', JPY)).toBe(91500)
    expect(() => toMinor('91500.5', JPY)).toThrow(DomainError)
  })

  it('refuses text that is not an amount', () => {
    expect(() => toMinor('ninety', EUR)).toThrow(DomainError)
  })
})

describe('formatAmount / plainAmount', () => {
  it('groups thousands and applies the currency symbol', () => {
    expect(formatAmount({ minor: 9150000, currency: EUR })).toBe('€91,500.00')
  })

  it('renders a zero-decimal currency with no fraction', () => {
    expect(formatAmount({ minor: 91500, currency: JPY })).toBe('¥91,500')
  })

  it('renders a negative amount with a leading sign', () => {
    expect(formatAmount({ minor: -50000, currency: EUR })).toBe('-€500.00')
  })

  it('plainAmount round-trips through toMinor', () => {
    const money = { minor: 9150050, currency: EUR }
    expect(toMinor(plainAmount(money), EUR)).toBe(money.minor)
  })
})

describe('addMoney', () => {
  it('adds two amounts in the same currency', () => {
    expect(addMoney({ minor: 100, currency: EUR }, { minor: 250, currency: EUR })).toEqual({
      minor: 350,
      currency: EUR,
    })
  })

  it('refuses to mix currencies rather than coercing', () => {
    expect(() => addMoney({ minor: 100, currency: EUR }, { minor: 100, currency: BRL })).toThrow(
      DomainError,
    )
  })
})

describe('sumMoney', () => {
  it('is undefined for an empty list, never a fabricated zero', () => {
    expect(sumMoney([])).toBeUndefined()
  })

  it('sums a single currency', () => {
    const result = sumMoney([
      { minor: 100, currency: EUR },
      { minor: 200, currency: EUR },
    ])
    expect(result).toEqual({ kind: 'amount', money: { minor: 300, currency: EUR } })
  })

  it('reports mixed currencies instead of coercing', () => {
    const result = sumMoney([
      { minor: 100, currency: EUR },
      { minor: 100, currency: BRL },
    ])
    expect(result).toEqual({ kind: 'mixed', currencies: ['EUR', 'BRL'] })
  })
})
