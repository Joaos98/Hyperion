import { describe, expect, it } from 'vitest'
import {
  averageStayPremiumPercent,
  averageSwitchPremiumPercent,
  perMonth,
  compensationLines,
  displayCurrency,
  offerPremium,
  switchPremiums,
  stayPremium,
  switchPremium,
  totalCompensationForYear,
  yearsCovered,
} from './compensation.js'
import type { Currency } from './money.js'
import type { OfferedTerms, Payment, Position, RecordedRate, StandingTerms, User } from './types.js'

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
      EUR,
    )
    expect(result.kind).toBe('available')
    if (result.kind === 'available') {
      expect(result.percent).toBeCloseTo(0, 5) // 6.4M -> 6.4M
    }
  })

  it('asks for the one rate it needs when the two Positions are in different currencies', () => {
    const brlPosition: Position = { ...kestrel, id: 'pos-brl', currency: BRL }
    const result = switchPremium(
      { position: nordwerk, terms: [nordwerkStarting, nordwerkFinal] },
      { position: brlPosition, terms: [kestrelStarting] },
      EUR,
    )
    expect(result).toEqual({ kind: 'needs-rate', fromCode: 'BRL', toCode: 'EUR', on: '2021-05-01' })
  })

  it('converts the later figure into the earlier currency once a rate is on file', () => {
    // The comparison a career leaving BRL for EUR actually wants: what the new job pays,
    // read in the currency the old one paid in.
    const brlPosition: Position = { ...nordwerk, id: 'pos-brl', currency: BRL }
    const rate: RecordedRate = {
      id: 'rate-1',
      userId: 'user-1',
      fromCode: 'EUR',
      toCode: 'BRL',
      date: '2021-05-01',
      rateMinor: 60000,
      rateDecimals: 4,
    }
    const result = switchPremium(
      { position: brlPosition, terms: [nordwerkStarting, nordwerkFinal] },
      { position: kestrel, terms: [kestrelStarting] },
      BRL,
      [rate],
    )
    expect(result.kind).toBe('available')
    if (result.kind === 'available') {
      // Nordwerk's final terms and Kestrel's starting terms are the same number, so at
      // 6 BRL to the EUR the switch is worth six times what it was — the whole point of
      // converting rather than comparing the bare figures.
      expect(result.percent).toBeCloseTo(500, 5)
      expect(result.to.currency.code).toBe('BRL')
      expect(result.conversions[0]?.recorded.id).toBe('rate-1')
      expect(result.conversions[0]?.inverted).toBe(false)
    }
  })

  it('names the rate a User entered even when the comparison runs the other way', () => {
    const brlPosition: Position = { ...kestrel, id: 'pos-brl', currency: BRL }
    const rate: RecordedRate = {
      id: 'rate-1',
      userId: 'user-1',
      fromCode: 'EUR',
      toCode: 'BRL',
      date: '2021-05-01',
      rateMinor: 60000,
      rateDecimals: 4,
    }
    const result = switchPremium(
      { position: nordwerk, terms: [nordwerkStarting, nordwerkFinal] },
      { position: brlPosition, terms: [kestrelStarting] },
      EUR,
      [rate],
    )
    expect(result.kind).toBe('available')
    if (result.kind === 'available') {
      expect(result.conversions[0]?.inverted).toBe(true)
      expect(result.to.currency.code).toBe('EUR')
    }
  })

  it('is unavailable when either Position has no Standing Terms yet', () => {
    const result = switchPremium(
      { position: nordwerk, terms: [] },
      { position: kestrel, terms: [kestrelStarting] },
      EUR,
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
    const result = averageSwitchPremiumPercent([nordwerk, kestrel], termsByPosition, EUR)
    expect(result).toBeCloseTo(0, 5)
  })

  it('is undefined for Switch Premium with a single Position', () => {
    expect(averageSwitchPremiumPercent([kestrel], termsByPosition, EUR)).toBeUndefined()
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

describe('offerPremium', () => {
  function offer(over: Partial<OfferedTerms> = {}): OfferedTerms {
    return {
      baseSalaryMinor: 12_000_000,
      targetBonusMinor: 0,
      employmentType: 'clt',
      startDate: '2026-09-01',
      currency: EUR,
      ...over,
    }
  }

  it('reads an offer in the same currency against the Current Position', () => {
    const result = offerPremium({ position: kestrel, terms: [kestrelStarting] }, offer(), EUR)
    expect(result.kind).toBe('available')
  })

  it('counts base and target bonus together, as every other comparison does', () => {
    const split = offerPremium(
      { position: kestrel, terms: [kestrelStarting] },
      offer({ baseSalaryMinor: 11_000_000, targetBonusMinor: 1_000_000 }),
      EUR,
    )
    const whole = offerPremium({ position: kestrel, terms: [kestrelStarting] }, offer(), EUR)
    expect(split).toEqual(whole)
  })

  it('asks for a rate when the offer is in a currency the Current Position is not paid in', () => {
    const result = offerPremium({ position: kestrel, terms: [kestrelStarting] }, offer({ currency: BRL }), EUR)
    expect(result).toEqual({ kind: 'needs-rate', fromCode: 'BRL', toCode: 'EUR', on: '2026-09-01' })
  })

  it('reads a foreign offer in the currency you are paid in today', () => {
    const rate: RecordedRate = {
      id: 'rate-1',
      userId: 'user-1',
      fromCode: 'BRL',
      toCode: 'EUR',
      date: '2026-09-01',
      rateMinor: 2000,
      rateDecimals: 4,
    }
    const result = offerPremium(
      { position: kestrel, terms: [kestrelStarting] },
      offer({ currency: BRL, baseSalaryMinor: 60_000_000, targetBonusMinor: 0 }),
      EUR,
      [rate],
    )
    expect(result.kind).toBe('available')
    if (result.kind === 'available') {
      // R$600,000 at 0.20 is EUR 120,000, read against the same currency Kestrel pays in.
      expect(result.to).toEqual({ minor: 12_000_000, currency: EUR })
      expect(result.conversions[0]?.recorded.id).toBe('rate-1')
    }
  })

  it('is unavailable when the Current Position has no Standing Terms to compare against', () => {
    const result = offerPremium({ position: kestrel, terms: [] }, offer(), EUR)
    expect(result.kind).toBe('unavailable')
  })
})

describe('compensationLines', () => {
  function terms(over: Partial<StandingTerms> & Pick<StandingTerms, 'id' | 'effectiveDate'>): StandingTerms {
    return {
      positionId: 'pos-kestrel',
      title: 'Backend Engineer',
      employmentType: 'contract',
      baseSalaryMinor: 6_400_000,
      targetBonusMinor: 0,
      ...over,
    }
  }

  function linesFor(rows: StandingTerms[], position = kestrel, today = '2026-08-20') {
    return compensationLines([position], new Map([[position.id, rows]]), today)
  }

  it('opens a line at Starting Terms', () => {
    const lines = linesFor([terms({ id: 'a', effectiveDate: '2021-05-01' })])
    expect(lines[0]?.points).toHaveLength(1)
    expect(lines[0]?.points[0]?.change).toBe('starting')
    expect(lines[0]?.points[0]?.percent).toBeUndefined()
  })

  it('marks a rise in pay as a raise, with the step it was', () => {
    const lines = linesFor([
      terms({ id: 'a', effectiveDate: '2021-05-01', baseSalaryMinor: 6_000_000 }),
      terms({ id: 'b', effectiveDate: '2023-01-01', baseSalaryMinor: 6_600_000 }),
    ])
    expect(lines[0]?.points[1]?.change).toBe('raise')
    expect(lines[0]?.points[1]?.percent).toBeCloseTo(10, 5)
  })

  it('marks a rise carrying a new title as a promotion', () => {
    const lines = linesFor([
      terms({ id: 'a', effectiveDate: '2021-05-01', baseSalaryMinor: 6_000_000 }),
      terms({ id: 'b', effectiveDate: '2023-01-01', baseSalaryMinor: 6_600_000, title: 'Senior Backend Engineer' }),
    ])
    expect(lines[0]?.points[1]?.change).toBe('promotion')
  })

  it('marks a fall in pay as a cut rather than hiding it', () => {
    const lines = linesFor([
      terms({ id: 'a', effectiveDate: '2021-05-01', baseSalaryMinor: 6_600_000 }),
      terms({ id: 'b', effectiveDate: '2023-01-01', baseSalaryMinor: 6_000_000 }),
    ])
    expect(lines[0]?.points[1]?.change).toBe('cut')
    expect(lines[0]?.points[1]?.percent).toBeLessThan(0)
  })

  it('drops a Standing Terms that moved the title and not the pay', () => {
    const lines = linesFor([
      terms({ id: 'a', effectiveDate: '2021-05-01' }),
      terms({ id: 'b', effectiveDate: '2022-01-01', title: 'Backend Engineer II' }),
    ])
    expect(lines[0]?.points).toHaveLength(1)
  })

  it('counts base and target bonus together, so a bonus-only change is still a change', () => {
    const lines = linesFor([
      terms({ id: 'a', effectiveDate: '2021-05-01', baseSalaryMinor: 6_000_000, targetBonusMinor: 0 }),
      terms({ id: 'b', effectiveDate: '2023-01-01', baseSalaryMinor: 6_000_000, targetBonusMinor: 400_000 }),
    ])
    expect(lines[0]?.points).toHaveLength(2)
    expect(lines[0]?.points[1]?.money.minor).toBe(6_400_000)
  })

  it('measures a step against the last point that moved, not the row before it', () => {
    const lines = linesFor([
      terms({ id: 'a', effectiveDate: '2021-05-01', baseSalaryMinor: 6_000_000 }),
      terms({ id: 'b', effectiveDate: '2022-01-01', baseSalaryMinor: 6_000_000, title: 'Backend Engineer II' }),
      terms({ id: 'c', effectiveDate: '2023-01-01', baseSalaryMinor: 6_600_000, title: 'Backend Engineer II' }),
    ])
    expect(lines[0]?.points).toHaveLength(2)
    expect(lines[0]?.points[1]?.percent).toBeCloseTo(10, 5)
  })

  it('ends a line at its Departure, and a current one at today', () => {
    const departed: Position = { ...kestrel, departure: { date: '2024-06-30', reason: 'resigned' } }
    expect(linesFor([terms({ id: 'a', effectiveDate: '2021-05-01' })], departed)[0]?.endsAt).toBe('2024-06-30')
    expect(linesFor([terms({ id: 'a', effectiveDate: '2021-05-01' })])[0]?.endsAt).toBe('2026-08-20')
  })

  it('keeps each Position as its own run rather than joining them across a gap', () => {
    const earlier: Position = { ...kestrel, id: 'pos-earlier', startDate: '2018-01-01', departure: { date: '2020-12-31', reason: 'resigned' } }
    const lines = compensationLines(
      [kestrel, earlier],
      new Map([
        [kestrel.id, [terms({ id: 'a', effectiveDate: '2021-05-01' })]],
        [earlier.id, [terms({ id: 'b', positionId: 'pos-earlier', effectiveDate: '2018-01-01' })]],
      ]),
      '2026-08-20',
    )
    expect(lines.map((line) => line.position.id)).toEqual(['pos-earlier', 'pos-kestrel'])
    expect(lines.every((line) => line.points.length === 1)).toBe(true)
  })

  it('leaves out a Position with no Standing Terms rather than drawing an empty run', () => {
    expect(linesFor([])).toEqual([])
  })
})

describe('switchPremiums', () => {
  function terms(positionId: string, id: string, baseSalaryMinor: number): StandingTerms {
    return {
      id,
      positionId,
      effectiveDate: '2020-01-01',
      title: 'Backend Engineer',
      employmentType: 'contract',
      baseSalaryMinor,
      targetBonusMinor: 0,
    }
  }

  const salaried: Position = {
    id: 'pos-salaried',
    userId: 'user-1',
    company: 'Nubank',
    currency: BRL,
    startDate: '2022-02-01',
    departure: null,
  }

  it('reports no switch between two Positions held at the same time', () => {
    // Contract work beside a salaried job (CONTEXT.md § Current Position) is not a job
    // change, and must not ask for a rate to compare two currencies nobody swapped.
    const contract: Position = {
      id: 'pos-contract',
      userId: 'user-1',
      company: 'Anchor',
      currency: EUR,
      startDate: '2024-06-01',
      departure: null,
    }
    const result = switchPremiums(
      [salaried, contract],
      new Map([
        [salaried.id, [terms(salaried.id, 'a', 24_000_000)]],
        [contract.id, [terms(contract.id, 'b', 4_800_000)]],
      ]),
      BRL,
    )
    expect(result).toEqual([])
  })

  it('reports a switch once the earlier Position has been left', () => {
    const left: Position = { ...salaried, departure: { date: '2025-02-28', reason: 'resigned' } }
    const next: Position = { ...salaried, id: 'pos-next', company: 'Stripe', startDate: '2025-03-01', departure: null }
    const result = switchPremiums(
      [left, next],
      new Map([
        [left.id, [terms(left.id, 'a', 24_000_000)]],
        [next.id, [terms(next.id, 'b', 30_000_000)]],
      ]),
      BRL,
    )
    expect(result).toHaveLength(1)
    expect(result[0]?.from.id).toBe('pos-salaried')
    expect(result[0]?.to.id).toBe('pos-next')
  })

  it('switches from the job most recently left, not the one that merely started before', () => {
    // A long-running contract that began first, then a salaried job left, then the next
    // one: the switch is from the job actually departed.
    const longContract: Position = { ...salaried, id: 'pos-long', company: 'Anchor', startDate: '2021-01-01' }
    const left: Position = { ...salaried, id: 'pos-left', startDate: '2022-02-01', departure: { date: '2025-02-28', reason: 'resigned' } }
    const next: Position = { ...salaried, id: 'pos-next', startDate: '2025-03-01', departure: null }
    const result = switchPremiums(
      [longContract, left, next],
      new Map([
        [longContract.id, [terms(longContract.id, 'a', 5_000_000)]],
        [left.id, [terms(left.id, 'b', 24_000_000)]],
        [next.id, [terms(next.id, 'c', 30_000_000)]],
      ]),
      BRL,
    )
    expect(result).toHaveLength(1)
    expect(result[0]?.from.id).toBe('pos-left')
  })

  it('reports no switch into the first Position of a career', () => {
    const result = switchPremiums([salaried], new Map([[salaried.id, [terms(salaried.id, 'a', 24_000_000)]]]), BRL)
    expect(result).toEqual([])
  })

  it('counts a gap between jobs as a switch, since one was still left for the other', () => {
    const left: Position = { ...salaried, departure: { date: '2024-01-31', reason: 'laid off' } }
    const next: Position = { ...salaried, id: 'pos-next', startDate: '2024-09-01', departure: null }
    const result = switchPremiums(
      [left, next],
      new Map([
        [left.id, [terms(left.id, 'a', 24_000_000)]],
        [next.id, [terms(next.id, 'b', 26_000_000)]],
      ]),
      BRL,
    )
    expect(result).toHaveLength(1)
  })
})

describe('displayCurrency', () => {
  function user(over: Partial<User> = {}): User {
    return {
      id: 'user-1',
      displayName: 'You',
      isAdmin: true,
      foldThresholdDays: 90,
      stallThresholdDays: 21,
      compensationDisplay: 'annual',
      displayCurrency: null,
      aiBaseUrl: null,
      aiApiKey: null,
      aiModel: null,
      ...over,
    }
  }

  const older: Position = { ...kestrel, id: 'pos-older', currency: BRL, startDate: '2018-01-01' }

  it('takes the currency of the earliest Position when the User has set none', () => {
    expect(displayCurrency(user(), [kestrel, older])).toEqual(BRL)
  })

  it('prefers the currency the User set over the derived one', () => {
    expect(displayCurrency(user({ displayCurrency: EUR }), [kestrel, older])).toEqual(EUR)
  })

  it('is simply the currency for a record that never crossed one', () => {
    expect(displayCurrency(user(), [kestrel])).toEqual(EUR)
  })

  it('has nothing to derive from before any Position exists', () => {
    expect(displayCurrency(user(), [])).toBeUndefined()
  })
})
