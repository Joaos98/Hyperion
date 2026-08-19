import { describe, expect, it } from 'vitest'
import { DomainError } from './errors.js'
import { eventsNewestFirst, isOpen, isTerminalStage, landApplication, status } from './applications.js'
import type { Currency } from './money.js'
import type { Application, ApplicationEvent } from './types.js'

const EUR: Currency = { code: 'EUR', symbol: '€', decimals: 2 }

function event(applicationId: string, stage: ApplicationEvent['stage'], date: string, id = `${stage}-${date}`): ApplicationEvent {
  return { id, applicationId, stage, date, note: null }
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
