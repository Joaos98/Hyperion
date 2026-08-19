import { describe, expect, it } from 'vitest'
import {
  averageStayPremiumPercent,
  averageSwitchPremiumPercent,
  perMonth,
  stayPremium,
  switchPremium,
  totalCompensationForYear,
  yearsCovered,
} from './compensation.js'
import type { Currency } from './money.js'
import type { Payment, Position, StandingTerms } from './types.js'

const EUR: Currency = { code: 'EUR', symbol: '€', decimals: 2 }
const BRL: Currency = { code: 'BRL', symbol: 'R$', decimals: 2 }

const kestrel: Position = {
  id: 'pos-kestrel',
  userId: 'user-1',
  company: 'Kestrel Systems',
  currency: EUR,
  startDate: '2021-05-01',
  departure: null,
}

const kestrelStarting: StandingTerms = {
  id: 'st-1',
  positionId: 'pos-kestrel',
  effectiveDate: '2021-05-01',
  title: 'Backend Engineer',
  employmentType: 'pj',
  baseSalaryMinor: 6_400_000,
  targetBonusMinor: 0,
}

const kestrelPromotion: StandingTerms = {
  id: 'st-2',
  positionId: 'pos-kestrel',
  effectiveDate: '2026-03-01',
  title: 'Senior Backend Engineer',
  employmentType: 'clt',
  baseSalaryMinor: 9_150_000,
  targetBonusMinor: 900_000,
}

const nordwerk: Position = {
  id: 'pos-nordwerk',
  userId: 'user-1',
  company: 'Nordwerk',
  currency: EUR,
  startDate: '2018-01-01',
  departure: { date: '2021-03-31', reason: 'resigned' },
}

const nordwerkStarting: StandingTerms = {
  id: 'st-n1',
  positionId: 'pos-nordwerk',
  effectiveDate: '2018-01-01',
  title: 'Engineer',
  employmentType: 'clt',
  baseSalaryMinor: 5_200_000,
  targetBonusMinor: 0,
}

const nordwerkFinal: StandingTerms = {
  id: 'st-n2',
  positionId: 'pos-nordwerk',
  effectiveDate: '2019-08-01',
  title: 'Engineer',
  employmentType: 'clt',
  baseSalaryMinor: 6_400_000,
  targetBonusMinor: 0,
}

describe('totalCompensationForYear', () => {
  it('is undefined before the Position has started', () => {
    expect(totalCompensationForYear(kestrel, [kestrelStarting], [], 2020, '2026-08-18')).toBeUndefined()
  })

  it('uses the terms in force at year end for a past year', () => {
    const result = totalCompensationForYear(kestrel, [kestrelStarting], [], 2022, '2026-08-18')
    expect(result).toEqual({ minor: 6_400_000, currency: EUR })
  })

  it('reflects a mid-year promotion the year it takes effect', () => {
    const result = totalCompensationForYear(
      kestrel,
      [kestrelStarting, kestrelPromotion],
      [],
      2026,
      '2026-08-18',
    )
    expect(result).toEqual({ minor: 9_150_000 + 900_000, currency: EUR })
  })

  it('adds Payments actually dated within the year', () => {
    const bonus: Payment = {
      id: 'pay-1',
      positionId: 'pos-kestrel',
      date: '2025-02-10',
      amountMinor: 610_000,
      label: 'Annual bonus',
    }
    const result = totalCompensationForYear(kestrel, [kestrelStarting], [bonus], 2025, '2026-08-18')
    expect(result).toEqual({ minor: 6_400_000 + 610_000, currency: EUR })
  })

  it('stops at the Departure date for the year a Position ends', () => {
    const result = totalCompensationForYear(
      nordwerk,
      [nordwerkStarting, nordwerkFinal],
      [],
      2021,
      '2026-08-18',
    )
    expect(result).toEqual({ minor: 6_400_000, currency: EUR })
  })
})

describe('yearsCovered', () => {
  it('spans from the first Standing Terms to the Departure', () => {
    expect(yearsCovered(nordwerk, [nordwerkStarting, nordwerkFinal], '2026-08-18')).toEqual([
      2018, 2019, 2020, 2021,
    ])
  })

  it('is empty with no Standing Terms at all', () => {
    expect(yearsCovered(kestrel, [], '2026-08-18')).toEqual([])
  })
})

describe('switchPremium', () => {
  it('computes the step from the last terms of one Position to the first of the next', () => {
    const result = switchPremium(
      { position: nordwerk, terms: [nordwerkStarting, nordwerkFinal] },
      { position: kestrel, terms: [kestrelStarting] },
    )
    expect(result.kind).toBe('available')
    if (result.kind === 'available') {
      expect(result.percent).toBeCloseTo(0, 5) // 6.4M -> 6.4M
    }
  })

  it('is unavailable across a currency it cannot yet convert', () => {
    const brlPosition: Position = { ...kestrel, id: 'pos-brl', currency: BRL }
    const result = switchPremium(
      { position: nordwerk, terms: [nordwerkStarting, nordwerkFinal] },
      { position: brlPosition, terms: [kestrelStarting] },
    )
    expect(result).toEqual({ kind: 'unavailable', reason: 'needs a Recorded Rate to compare currencies' })
  })

  it('is unavailable when either Position has no Standing Terms yet', () => {
    const result = switchPremium(
      { position: nordwerk, terms: [] },
      { position: kestrel, terms: [kestrelStarting] },
    )
    expect(result.kind).toBe('unavailable')
  })
})

describe('stayPremium', () => {
  it('computes compound annual growth between the first and last Standing Terms', () => {
    const result = stayPremium(nordwerk, [nordwerkStarting, nordwerkFinal])
    expect(result.kind).toBe('available')
    // 5.2M -> 6.4M over ~1.58 years
    if (result.kind === 'available') expect(result.percent).toBeGreaterThan(0)
  })

  it('is unavailable with only Starting Terms', () => {
    const result = stayPremium(kestrel, [kestrelStarting])
    expect(result).toEqual({ kind: 'unavailable', reason: 'needs a second Standing Terms to show growth' })
  })
})

describe('averages across a career', () => {
  const termsByPosition = new Map([
    ['pos-nordwerk', [nordwerkStarting, nordwerkFinal]],
    ['pos-kestrel', [kestrelStarting, kestrelPromotion]],
  ])

  it('averages Switch Premium across consecutive Positions', () => {
    const result = averageSwitchPremiumPercent([nordwerk, kestrel], termsByPosition)
    expect(result).toBeCloseTo(0, 5)
  })

  it('is undefined for Switch Premium with a single Position', () => {
    expect(averageSwitchPremiumPercent([kestrel], termsByPosition)).toBeUndefined()
  })

  it('averages Stay Premium only across Positions that have one', () => {
    const result = averageStayPremiumPercent([nordwerk, kestrel], termsByPosition)
    expect(result).toBeGreaterThan(0)
  })
})

describe('perMonth', () => {
  it('divides an annual figure by twelve', () => {
    expect(perMonth({ minor: 1_200_00, currency: EUR })).toEqual({ minor: 100_00, currency: EUR })
  })

  it('rounds rather than truncating on a remainder', () => {
    expect(perMonth({ minor: 100_00, currency: EUR })).toEqual({ minor: 833, currency: EUR })
  })
})
