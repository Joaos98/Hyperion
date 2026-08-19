import { describe, expect, it } from 'vitest'
import type { Currency } from './money.js'
import { foldTimeline, positionSpans, timelineEvents } from './timeline.js'
import type { Payment, Position, StandingTerms } from './types.js'

const EUR: Currency = { code: 'EUR', symbol: '€', decimals: 2 }

const kestrel: Position = {
  id: 'pos-kestrel',
  userId: 'user-1',
  company: 'Kestrel Systems',
  currency: EUR,
  startDate: '2021-05-01',
  departure: null,
}

const halden: Position = {
  id: 'pos-halden',
  userId: 'user-1',
  company: 'Halden & Co',
  currency: EUR,
  startDate: '2023-06-01',
  departure: { date: '2023-08-01', reason: 'contract ended' },
}

const nordwerk: Position = {
  id: 'pos-nordwerk',
  userId: 'user-1',
  company: 'Nordwerk',
  currency: EUR,
  startDate: '2018-01-01',
  departure: { date: '2021-03-31', reason: 'resigned' },
}

describe('positionSpans', () => {
  it('marks a Position started while an earlier one is still open as alongside', () => {
    const spans = positionSpans([kestrel, halden])
    const haldenSpan = spans.find((span) => span.position.id === 'pos-halden')
    const kestrelSpan = spans.find((span) => span.position.id === 'pos-kestrel')
    expect(haldenSpan?.alongside).toBe(true)
    expect(kestrelSpan?.alongside).toBe(false)
  })

  it('does not mark sequential Positions as alongside', () => {
    const spans = positionSpans([nordwerk, kestrel])
    expect(spans.every((span) => !span.alongside)).toBe(true)
  })

  it('orders spans oldest first', () => {
    const spans = positionSpans([kestrel, nordwerk, halden])
    expect(spans.map((span) => span.position.id)).toEqual(['pos-nordwerk', 'pos-kestrel', 'pos-halden'])
  })
})

describe('timelineEvents', () => {
  const starting: StandingTerms = {
    id: 'st-1',
    positionId: 'pos-kestrel',
    effectiveDate: '2021-05-01',
    title: 'Backend Engineer',
    employmentType: 'pj',
    baseSalaryMinor: 6_400_000,
    targetBonusMinor: 0,
  }
  const payment: Payment = {
    id: 'pay-1',
    positionId: 'pos-kestrel',
    date: '2025-02-10',
    amountMinor: 610_000,
    label: 'Annual bonus',
  }

  it('merges Standing Terms, Payments and Departures, newest first', () => {
    const events = timelineEvents(
      [kestrel, nordwerk],
      new Map([['pos-kestrel', [starting]]]),
      new Map([['pos-kestrel', [payment]]]),
    )
    expect(events.map((event) => event.date)).toEqual([
      '2025-02-10', // payment
      '2021-05-01', // kestrel starting terms
      '2021-03-31', // nordwerk departure
    ])
  })
})

describe('foldTimeline', () => {
  const starting: StandingTerms = {
    id: 'st-1',
    positionId: 'pos-kestrel',
    effectiveDate: '2021-05-01',
    title: 'Backend Engineer',
    employmentType: 'pj',
    baseSalaryMinor: 6_400_000,
    targetBonusMinor: 0,
  }
  const promotion: StandingTerms = {
    id: 'st-2',
    positionId: 'pos-kestrel',
    effectiveDate: '2026-03-01',
    title: 'Senior Backend Engineer',
    employmentType: 'clt',
    baseSalaryMinor: 9_150_000,
    targetBonusMinor: 900_000,
  }

  it('does not fold a gap under the threshold', () => {
    const soonAfter: StandingTerms = { ...starting, id: 'st-1b', effectiveDate: '2021-06-01' }
    const events = timelineEvents([kestrel], new Map([['pos-kestrel', [starting, soonAfter]]]), new Map())
    const rows = foldTimeline(events, positionSpans([kestrel]), 90)
    expect(rows.every((row) => row.kind === 'event')).toBe(true)
  })

  it('folds a gap over the threshold, held true when it falls inside one Position', () => {
    const events = timelineEvents([kestrel], new Map([['pos-kestrel', [starting, promotion]]]), new Map())
    const rows = foldTimeline(events, positionSpans([kestrel]), 30)
    const fold = rows.find((row) => row.kind === 'fold')
    expect(fold).toBeDefined()
    expect(fold).toMatchObject({ held: true, start: '2021-05-01', end: '2026-03-01' })
  })

  it('folds a gap between two Positions as unheld — hairline, not thick', () => {
    const events = timelineEvents(
      [nordwerk, kestrel],
      new Map([
        ['pos-nordwerk', [starting]], // reused fixture, only its date matters here
        ['pos-kestrel', [starting]],
      ]),
      new Map(),
    )
    const rows = foldTimeline(events, positionSpans([nordwerk, kestrel]), 10)
    const betweenPositions = rows.find(
      (row) => row.kind === 'fold' && row.start === '2021-03-31',
    )
    expect(betweenPositions).toMatchObject({ held: false })
  })

  it('is empty with no events at all', () => {
    expect(foldTimeline([], [], 90)).toEqual([])
  })
})
