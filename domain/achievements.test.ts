import { describe, expect, it } from 'vitest'
import { achievementsSince, daysSinceLastAchievement, newestFirst, search } from './achievements.js'
import type { Achievement } from './types.js'

function achievement(date: string, id = date, text = 'Did a thing.', impact: string | null = null): Achievement {
  return { id, userId: 'user-1', positionId: 'pos-1', date, text, impact }
}

describe('newestFirst', () => {
  it('orders achievements newest first', () => {
    const ordered = newestFirst([achievement('2026-01-01'), achievement('2026-06-01'), achievement('2026-03-01')])
    expect(ordered.map((a) => a.date)).toEqual(['2026-06-01', '2026-03-01', '2026-01-01'])
  })
})

describe('daysSinceLastAchievement', () => {
  it('is undefined with nothing logged yet — day one is not a large number', () => {
    expect(daysSinceLastAchievement([], '2026-08-18')).toBeUndefined()
  })

  it('counts from the most recent entry', () => {
    const days = daysSinceLastAchievement(
      [achievement('2026-01-01'), achievement('2026-07-07')],
      '2026-08-18',
    )
    expect(days).toBe(42)
  })
})

describe('search', () => {
  const entries = [
    achievement('2026-01-01', 'a1', 'Rewrote the reconciliation job.', '90m to 6m'),
    achievement('2026-02-01', 'a2', 'Onboarded two new engineers.'),
    achievement('2026-03-01', 'a3', 'Migrated off the legacy billing provider.'),
  ]

  it('returns everything, newest first, for an empty query', () => {
    expect(search(entries, '').map((a) => a.id)).toEqual(['a3', 'a2', 'a1'])
  })

  it('matches case-insensitively against the text', () => {
    expect(search(entries, 'RECONCILIATION').map((a) => a.id)).toEqual(['a1'])
  })

  it('matches against Impact as well as text', () => {
    expect(search(entries, '6m').map((a) => a.id)).toEqual(['a1'])
  })

  it('is empty when nothing matches', () => {
    expect(search(entries, 'nonexistent')).toEqual([])
  })
})

describe('achievementsSince', () => {
  const entries = [
    achievement('2025-11-01', 'a1'),
    achievement('2026-01-15', 'a2'),
    achievement('2026-06-01', 'a3'),
  ]

  it('excludes entries before the cutoff, newest first', () => {
    expect(achievementsSince(entries, '2026-01-01').map((a) => a.id)).toEqual(['a3', 'a2'])
  })

  it('includes an entry dated exactly on the cutoff', () => {
    expect(achievementsSince(entries, '2026-01-15').map((a) => a.id)).toEqual(['a3', 'a2'])
  })

  it('is empty when nothing falls in range', () => {
    expect(achievementsSince(entries, '2027-01-01')).toEqual([])
  })
})
