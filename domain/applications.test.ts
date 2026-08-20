import { describe, expect, it } from 'vitest'
import { DomainError } from './errors.js'
import {
  averageDaysToResponse,
  daysToResponse,
  eventsNewestFirst,
  funnelCounts,
  hasResponse,
  isOpen,
  isStalled,
  isTerminalStage,
  landApplication,
  priorApplicationFor,
  responseRate,
  status,
} from './applications.js'
import type { Currency } from './money.js'
import type { Application, ApplicationEvent } from './types.js'

const EUR: Currency = { code: 'EUR', symbol: '€', decimals: 2 }

function event(applicationId: string, stage: ApplicationEvent['stage'], date: string, id = `${stage}-${date}`): ApplicationEvent {
  return { id, applicationId, stage, date, note: null }
}

function application(overrides: Partial<Application> & { id: string }): Application {
  return {
    userId: 'user-1',
    company: 'Kestrel Systems',
    title: 'Backend Engineer',
    source: 'Referral',
    postingUrl: null,
    advertisedRange: null,
    offeredTerms: null,
    documentId: null,
    priorApplicationId: null,
    ...overrides,
  }
}

describe('isTerminalStage', () => {
  it('is terminal for Rejected, Withdrawn and Landed', () => {
    expect(isTerminalStage('rejected')).toBe(true)
    expect(isTerminalStage('withdrawn')).toBe(true)
    expect(isTerminalStage('landed')).toBe(true)
  })

  it('is not terminal for anything still in play', () => {
    expect(isTerminalStage('saved')).toBe(false)
    expect(isTerminalStage('applied')).toBe(false)
    expect(isTerminalStage('screen')).toBe(false)
    expect(isTerminalStage('interview')).toBe(false)
    expect(isTerminalStage('offer')).toBe(false)
  })
})

describe('status', () => {
  it('is undefined with no Events at all', () => {
    expect(status([])).toBeUndefined()
  })

  it('is the Stage of the most recent Event, regardless of input order', () => {
    const events = [
      event('app-1', 'applied', '2026-06-01'),
      event('app-1', 'screen', '2026-07-01'),
      event('app-1', 'saved', '2026-05-01'),
    ]
    expect(status(events)).toBe('screen')
  })

  it('breaks a same-day tie by which Event was handed later, not by date alone', () => {
    // Applying and landing the same day is ordinary, not an edge case — an IsoDate has no
    // finer grain than a day, so this is the case that actually exercises the tie-break.
    const events = [event('app-1', 'saved', '2026-08-19'), event('app-1', 'landed', '2026-08-19')]
    expect(status(events)).toBe('landed')
  })
})

describe('eventsNewestFirst', () => {
  it('orders newest first', () => {
    const events = [event('app-1', 'saved', '2026-05-01'), event('app-1', 'applied', '2026-06-01')]
    expect(eventsNewestFirst(events).map((e) => e.stage)).toEqual(['applied', 'saved'])
  })
})

describe('isOpen', () => {
  it('is true while the latest Stage is not terminal', () => {
    expect(isOpen([event('app-1', 'applied', '2026-06-01')])).toBe(true)
  })

  it('is false once the latest Stage is terminal', () => {
    expect(isOpen([event('app-1', 'applied', '2026-06-01'), event('app-1', 'rejected', '2026-07-01')])).toBe(false)
  })

  it('is false with no Events at all', () => {
    expect(isOpen([])).toBe(false)
  })
})

describe('isStalled', () => {
  it('is false while inside the Stall Threshold', () => {
    const events = [event('app-1', 'applied', '2026-08-01')]
    expect(isStalled(events, '2026-08-20', 21)).toBe(false)
  })

  it('is false exactly at the Stall Threshold — only older than it counts', () => {
    const events = [event('app-1', 'applied', '2026-08-01')]
    expect(isStalled(events, '2026-08-22', 21)).toBe(false)
  })

  it('is true once past the Stall Threshold', () => {
    const events = [event('app-1', 'applied', '2026-08-01')]
    expect(isStalled(events, '2026-08-23', 21)).toBe(true)
  })

  it('is false once the Application reaches a Terminal Stage, however old', () => {
    const events = [event('app-1', 'applied', '2026-01-01'), event('app-1', 'rejected', '2026-01-05')]
    expect(isStalled(events, '2026-08-20', 21)).toBe(false)
  })

  it('is false with no Events at all', () => {
    expect(isStalled([], '2026-08-20', 21)).toBe(false)
  })

  it('reads the most recent Event, not the first', () => {
    const events = [event('app-1', 'applied', '2026-01-01'), event('app-1', 'screen', '2026-08-15')]
    expect(isStalled(events, '2026-08-20', 21)).toBe(false)
  })
})

describe('landApplication', () => {
  const application: Application = {
    id: 'app-1',
    userId: 'user-1',
    company: 'Kestrel Systems',
    title: 'Senior Backend Engineer',
    source: 'Referral',
    postingUrl: null,
    advertisedRange: null,
    offeredTerms: {
      baseSalaryMinor: 9_150_000,
      targetBonusMinor: 900_000,
      employmentType: 'clt',
      startDate: '2026-09-01',
      currency: EUR,
    },
    documentId: null,
    priorApplicationId: null,
  }
  const ids = { positionId: 'pos-1', standingTermsId: 'st-1', eventId: 'evt-1' }

  it('mints a Position from the company and the Offered Terms', () => {
    const { position } = landApplication(application, ids, '2026-08-20')
    expect(position).toEqual({
      id: 'pos-1',
      userId: 'user-1',
      company: 'Kestrel Systems',
      currency: EUR,
      startDate: '2026-09-01',
      departure: null,
    })
  })

  it('mints Starting Terms from the title and the Offered Terms', () => {
    const { standingTerms } = landApplication(application, ids, '2026-08-20')
    expect(standingTerms).toEqual({
      id: 'st-1',
      positionId: 'pos-1',
      effectiveDate: '2026-09-01',
      title: 'Senior Backend Engineer',
      employmentType: 'clt',
      baseSalaryMinor: 9_150_000,
      targetBonusMinor: 900_000,
    })
  })

  it('reaches the Landed Stage today, distinct from the Position’s own start date', () => {
    const { event } = landApplication(application, ids, '2026-08-20')
    expect(event).toEqual({ id: 'evt-1', applicationId: 'app-1', stage: 'landed', date: '2026-08-20', note: null })
  })

  it('refuses to Land an Application with no Offered Terms', () => {
    expect(() => landApplication({ ...application, offeredTerms: null }, ids, '2026-08-20')).toThrow(DomainError)
  })
})

describe('priorApplicationFor', () => {
  it('is undefined with no history at all', () => {
    expect(priorApplicationFor({ company: 'Kestrel Systems', title: 'Backend Engineer', postingUrl: null }, [])).toBeUndefined()
  })

  it('matches by company with a similar title, case-insensitively', () => {
    const existing = application({ id: 'app-1', company: 'kestrel systems', title: 'Senior Backend Engineer' })
    const match = priorApplicationFor({ company: 'Kestrel Systems', title: 'Backend Engineer', postingUrl: null }, [existing])
    expect(match?.id).toBe('app-1')
  })

  it('does not match on company alone with an unrelated title', () => {
    const existing = application({ id: 'app-1', company: 'Kestrel Systems', title: 'Sales Director' })
    const match = priorApplicationFor({ company: 'Kestrel Systems', title: 'Backend Engineer', postingUrl: null }, [existing])
    expect(match).toBeUndefined()
  })

  it('matches by posting URL alone, even with an unrelated title', () => {
    const existing = application({ id: 'app-1', company: 'Kestrel Systems', title: 'Sales Director', postingUrl: 'https://kestrel.example/jobs/42' })
    const match = priorApplicationFor(
      { company: 'Kestrel Systems', title: 'Backend Engineer', postingUrl: 'https://kestrel.example/jobs/42' },
      [existing],
    )
    expect(match?.id).toBe('app-1')
  })

  it('picks the most recently added of several matches', () => {
    const older = application({ id: 'app-older', title: 'Backend Engineer' })
    const newer = application({ id: 'app-newer', title: 'Backend Engineer' })
    const match = priorApplicationFor({ company: 'Kestrel Systems', title: 'Backend Engineer', postingUrl: null }, [older, newer])
    expect(match?.id).toBe('app-newer')
  })
})

describe('hasResponse', () => {
  it('is true once a Screen, Assessment, Interview, Offer or Landed Event exists', () => {
    expect(hasResponse([event('app-1', 'applied', '2026-06-01'), event('app-1', 'screen', '2026-06-05')])).toBe(true)
  })

  it('is true for a Rejection — a closed loop is still a Response', () => {
    expect(hasResponse([event('app-1', 'applied', '2026-06-01'), event('app-1', 'rejected', '2026-06-05')])).toBe(true)
  })

  it('is false for a bare Withdrawal with nothing between Applied and it', () => {
    expect(hasResponse([event('app-1', 'applied', '2026-06-01'), event('app-1', 'withdrawn', '2026-06-20')])).toBe(false)
  })

  it('is true for an Interview followed by a Withdrawal — the response came first', () => {
    expect(
      hasResponse([
        event('app-1', 'applied', '2026-06-01'),
        event('app-1', 'interview', '2026-06-10'),
        event('app-1', 'withdrawn', '2026-06-20'),
      ]),
    ).toBe(true)
  })

  it('is false with only Saved and Applied', () => {
    expect(hasResponse([event('app-1', 'saved', '2026-06-01'), event('app-1', 'applied', '2026-06-02')])).toBe(false)
  })
})

describe('daysToResponse', () => {
  it('is the days from Applied to the earliest Response', () => {
    const events = [event('app-1', 'applied', '2026-06-01'), event('app-1', 'screen', '2026-06-08')]
    expect(daysToResponse(events)).toBe(7)
  })

  it('is undefined without an Applied Event', () => {
    expect(daysToResponse([event('app-1', 'saved', '2026-06-01')])).toBeUndefined()
  })

  it('is undefined without a Response yet', () => {
    expect(daysToResponse([event('app-1', 'applied', '2026-06-01')])).toBeUndefined()
  })

  it('ignores a bare Withdrawal — that is not a Response', () => {
    expect(daysToResponse([event('app-1', 'applied', '2026-06-01'), event('app-1', 'withdrawn', '2026-06-20')])).toBeUndefined()
  })
})

describe('averageDaysToResponse', () => {
  it('averages only the Applications that got a Response', () => {
    const apps = [application({ id: 'app-1' }), application({ id: 'app-2' }), application({ id: 'app-3' })]
    const byApp = new Map([
      ['app-1', [event('app-1', 'applied', '2026-06-01'), event('app-1', 'screen', '2026-06-05')]], // 4 days
      ['app-2', [event('app-2', 'applied', '2026-06-01'), event('app-2', 'screen', '2026-06-11')]], // 10 days
      ['app-3', [event('app-3', 'applied', '2026-06-01')]], // no Response — excluded
    ])
    expect(averageDaysToResponse(apps, byApp)).toBe(7)
  })

  it('is undefined when nothing has been Responded to', () => {
    const apps = [application({ id: 'app-1' })]
    const byApp = new Map([['app-1', [event('app-1', 'applied', '2026-06-01')]]])
    expect(averageDaysToResponse(apps, byApp)).toBeUndefined()
  })
})

describe('responseRate', () => {
  it('counts how many Applications ever got a Response, out of the total', () => {
    const apps = [application({ id: 'app-1' }), application({ id: 'app-2' }), application({ id: 'app-3' })]
    const byApp = new Map([
      ['app-1', [event('app-1', 'applied', '2026-06-01'), event('app-1', 'screen', '2026-06-05')]],
      ['app-2', [event('app-2', 'applied', '2026-06-01')]],
      ['app-3', [event('app-3', 'applied', '2026-06-01'), event('app-3', 'rejected', '2026-06-10')]],
    ])
    expect(responseRate(apps, byApp)).toEqual({ responded: 2, total: 3 })
  })

  it('is zero-total with no Applications at all', () => {
    expect(responseRate([], new Map())).toEqual({ responded: 0, total: 0 })
  })
})

describe('funnelCounts', () => {
  it('counts an Application toward every Stage it ever reached, not just its current one', () => {
    const apps = [application({ id: 'app-1' })]
    const byApp = new Map([
      [
        'app-1',
        [event('app-1', 'applied', '2026-06-01'), event('app-1', 'interview', '2026-06-10'), event('app-1', 'rejected', '2026-06-20')],
      ],
    ])
    const counts = funnelCounts(apps, byApp)
    expect(counts).toEqual([
      { stage: 'applied', count: 1 },
      { stage: 'screen', count: 0 },
      { stage: 'assessment', count: 0 },
      { stage: 'interview', count: 1 },
      { stage: 'offer', count: 0 },
      { stage: 'landed', count: 0 },
    ])
  })

  it('never counts Rejected or Withdrawn as funnel points', () => {
    const apps = [application({ id: 'app-1' })]
    const byApp = new Map([['app-1', [event('app-1', 'applied', '2026-06-01'), event('app-1', 'rejected', '2026-06-05')]]])
    const counts = funnelCounts(apps, byApp)
    expect(counts.every((row) => row.stage !== 'rejected' && row.stage !== 'withdrawn')).toBe(true)
  })
})
