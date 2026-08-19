/**
 * Where "today" comes from. Every date-dependent rule in Hyperion — tenure, staleness,
 * Fold thresholds, the demo seed — reads the date through this rather than calling `new
 * Date()` directly, so a test can pin it to a fixed reference date and get the same
 * answer every run.
 */
export interface Clock {
  /** Today, as an ISO date (`YYYY-MM-DD`). */
  today(): string
}

/** The real clock. Production's only caller. */
export const systemClock: Clock = {
  today: () => new Date().toISOString().slice(0, 10),
}

/** A clock pinned to one date, for tests. */
export function fixedClock(date: string): Clock {
  return { today: () => date }
}
