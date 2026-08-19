import { describe, expect, it } from 'vitest'
import type { Currency } from './money.js'
import {
  currentStandingTerms,
  isCurrent,
  isPromotion,
  positionEvents,
  standingTermsAsOf,
  standingTermsHistory,
  tenure,
} from './position.js'
import type { Position, StandingTerms } from './types.js'

const EUR: Currency = { code: 'EUR', symbol: '€', decimals: 2 }

const kestrel: Position = {
  id: 'pos-1',
  userId: 'user-1',
  company: 'Kestrel Systems',
  currency: EUR,
  startDate: '2021-05-01',
  departure: null,
}

const starting: StandingTerms = {
  id: 'st-1',
  positionId: 'pos-1',
  effectiveDate: '2021-05-01',
  title: 'Backend Engineer',
  employmentType: 'pj',
  baseSalaryMinor: 6_400_000,
  targetBonusMinor: 0,
}

const raise: StandingTerms = {
  id: 'st-2',
  positionId: 'pos-1',
  effectiveDate: '2024-11-01',
  title: 'Backend Engineer',
  employmentType: 'clt',
  baseSalaryMinor: 7_800_000,
  targetBonusMinor: 0,
}

const promotion: StandingTerms = {
  id: 'st-3',
  positionId: 'pos-1',
  effectiveDate: '2026-03-01',
  title: 'Senior Backend Engineer',
  employmentType: 'clt',
  baseSalaryMinor: 9_150_000,
  targetBonusMinor: 900_000,
}

describe('standingTermsHistory', () => {
  it('orders newest first', () => {
    const history = standingTermsHistory([starting, promotion, raise])
    expect(history.map((row) => row.id)).toEqual(['st-3', 'st-2', 'st-1'])
  })
})

describe('standingTermsAsOf / currentStandingTerms', () => {
  const terms = [starting, raise, promotion]

  it('is undefined before the first Standing Terms takes effect', () => {
    expect(standingTermsAsOf(terms, '2021-01-01')).toBeUndefined()
  })

  it('returns the terms in force on the effective date itself', () => {
    expect(standingTermsAsOf(terms, '2021-05-01')?.id).toBe('st-1')
  })

  it('supersedes to the later terms once they take effect', () => {
    expect(standingTermsAsOf(terms, '2024-11-01')?.id).toBe('st-2')
    expect(standingTermsAsOf(terms, '2025-06-01')?.id).toBe('st-2')
  })

  it('reflects the current terms as of today', () => {
    expect(currentStandingTerms(terms, '2026-08-18')?.id).toBe('st-3')
  })
})

describe('tenure', () => {
  it('runs to today for a Current Position', () => {
    expect(isCurrent(kestrel)).toBe(true)
    expect(tenure(kestrel, '2026-08-01')).toEqual({ years: 5, months: 3 })
  })

  it('runs to the Departure date once the Position has ended', () => {
    const ended: Position = { ...kestrel, departure: { date: '2023-01-15', reason: 'resigned' } }
    expect(isCurrent(ended)).toBe(false)
    expect(tenure(ended, '2026-08-01')).toEqual({ years: 1, months: 8 })
  })
})

describe('isPromotion', () => {
  it('is false for Starting Terms, which has nothing to compare against', () => {
    expect(isPromotion(starting, undefined)).toBe(false)
  })

  it('is false for a raise with no title change', () => {
    expect(isPromotion(raise, starting)).toBe(false)
  })

  it('is true only when both title and compensation change', () => {
    expect(isPromotion(promotion, raise)).toBe(true)
  })

  it('is false for a title change with no compensation change', () => {
    const titleOnly: StandingTerms = { ...starting, id: 'st-x', title: 'Backend Engineer II' }
    expect(isPromotion(titleOnly, starting)).toBe(false)
  })
})

describe('positionEvents', () => {
  it('merges Standing Terms and Payments in date order, oldest first', () => {
    const events = positionEvents(
      [starting, raise],
      [{ id: 'pay-1', positionId: 'pos-1', date: '2023-08-01', amountMinor: 300_000, label: 'Retention bonus' }],
    )
    expect(events.map((event) => event.date)).toEqual(['2021-05-01', '2023-08-01', '2024-11-01'])
    expect(events[1]).toMatchObject({ kind: 'payment' })
  })

  it('carries the previous Standing Terms alongside each one, oldest having none', () => {
    const events = positionEvents([starting, raise], [])
    const terms = events.filter((event) => event.kind === 'standing-terms')
    expect(terms[0]?.previous).toBeUndefined()
    expect(terms[1]?.previous?.id).toBe('st-1')
  })
})
