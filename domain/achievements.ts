import { daysBetween, type IsoDate } from './date.js'
import type { Achievement } from './types.js'

/** Achievements newest first — the order the log and the Timeline both read in. */
export function newestFirst(achievements: readonly Achievement[]): Achievement[] {
  return [...achievements].sort((a, b) => b.date.localeCompare(a.date))
}

/**
 * Achievements matching `query`, newest first — plain substring matching over the text
 * and Impact of each entry. The plan's own retrieval story for Phase 1 (§ The career
 * record: "retrieval is full-text search"), kept as a pure domain function rather than
 * pushed into SQLite's FTS5, so the `localStorage` adapter and the demo behave exactly
 * like the self-hosted build instead of one search working better than the other. An
 * empty query returns everything, newest first, so the search box and the plain list are
 * the same view.
 */
export function search(achievements: readonly Achievement[], query: string): Achievement[] {
  const needle = query.trim().toLowerCase()
  const ordered = newestFirst(achievements)
  if (!needle) return ordered
  return ordered.filter(
    (achievement) =>
      achievement.text.toLowerCase().includes(needle) ||
      (achievement.impact?.toLowerCase().includes(needle) ?? false),
  )
}

/** Achievements dated on or after `since`, newest first — a self-assessment's raw material. */
export function achievementsSince(achievements: readonly Achievement[], since: IsoDate): Achievement[] {
  return newestFirst(achievements).filter((achievement) => achievement.date >= since)
}

/**
 * Days since the most recent Achievement, for the passive staleness signal — capture being
 * one click away is a design constraint. `undefined` with nothing logged yet — day one is not
 * a large number of days, it is the absence of one.
 */
export function daysSinceLastAchievement(
  achievements: readonly Achievement[],
  today: IsoDate,
): number | undefined {
  if (achievements.length === 0) return undefined
  const mostRecent = newestFirst(achievements)[0]!
  return daysBetween(mostRecent.date, today)
}
