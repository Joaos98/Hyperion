import { daysBetween, type IsoDate } from './date.js'
import { isPromotion, standingTermsHistory } from './position.js'
import type { Departure, Payment, Position, StandingTerms } from './types.js'

/**
 * One Position's run on the Timeline (CONTEXT.md § Timeline). `end` absent means still
 * running. `alongside` is true when this Position started while an earlier-started
 * Position was still open — contract work beside a salaried job, the one case the Pillar
 * does not draw on its own spine.
 */
export interface Span {
  position: Position
  start: IsoDate
  end: IsoDate | undefined
  alongside: boolean
}

/**
 * Every Position as a Span, oldest first. A Position is `alongside` another rather than
 * primary when, at the moment it started, an earlier-started Position was already open
 * and still is — a rule computed from dates alone, so which Position gets the spine is
 * never a UI guess.
 */
export function positionSpans(positions: readonly Position[]): Span[] {
  const chronological = [...positions].sort((a, b) => a.startDate.localeCompare(b.startDate))
  return chronological.map((position) => {
    const overlapsEarlier = chronological.some((other) => {
      if (other === position) return false
      if (other.startDate >= position.startDate) return false
      const otherEnd = other.departure?.date
      return otherEnd === undefined || otherEnd > position.startDate
    })
    return {
      position,
      start: position.startDate,
      end: position.departure?.date,
      alongside: overlapsEarlier,
    }
  })
}

/** Whether some primary (non-alongside) Span covers `[start, end]` in full. */
function heldThroughout(spans: readonly Span[], start: IsoDate, end: IsoDate): boolean {
  return spans.some((span) => {
    if (span.alongside) return false
    const spanEnd = span.end ?? '9999-12-31'
    return span.start <= start && end <= spanEnd
  })
}

/**
 * One dated mark on the Timeline. Positions only (CONTEXT.md § Timeline) — an Achievement is
 * a personal record, not a change to a Position, and belongs on the Achievements log instead;
 * putting it here as well repeated the same entry on two screens for no reader's benefit.
 */
export type TimelineEvent =
  | {
      kind: 'standing-terms'
      date: IsoDate
      position: Position
      terms: StandingTerms
      previous: StandingTerms | undefined
      isPromotion: boolean
    }
  | { kind: 'payment'; date: IsoDate; position: Position; payment: Payment }
  | { kind: 'departure'; date: IsoDate; position: Position; departure: Departure }

const KIND_PRIORITY: Record<TimelineEvent['kind'], number> = {
  'standing-terms': 0,
  departure: 1,
  payment: 2,
}

/** Every mark across every Position, newest first. */
export function timelineEvents(
  positions: readonly Position[],
  termsByPosition: ReadonlyMap<string, readonly StandingTerms[]>,
  paymentsByPosition: ReadonlyMap<string, readonly Payment[]>,
): TimelineEvent[] {
  const events: TimelineEvent[] = []

  for (const position of positions) {
    const terms = standingTermsHistory(termsByPosition.get(position.id) ?? []).slice().reverse()
    terms.forEach((row, index) => {
      events.push({
        kind: 'standing-terms',
        date: row.effectiveDate,
        position,
        terms: row,
        previous: terms[index - 1],
        isPromotion: isPromotion(row, terms[index - 1]),
      })
    })

    for (const payment of paymentsByPosition.get(position.id) ?? []) {
      events.push({ kind: 'payment', date: payment.date, position, payment })
    }

    if (position.departure) {
      events.push({ kind: 'departure', date: position.departure.date, position, departure: position.departure })
    }
  }

  return events.sort((a, b) => b.date.localeCompare(a.date) || KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind])
}

/**
 * A stretch of Timeline with no events in it, collapsed to one row (CONTEXT.md § Fold).
 * `held` says whether the rule stays thick through it — inside a Position — or thins to a
 * hairline — between Positions — so a Fold never breaks the continuity it is compressing.
 */
export interface FoldedGap {
  kind: 'fold'
  start: IsoDate
  end: IsoDate
  days: number
  held: boolean
}

export type TimelineRow = { kind: 'event'; event: TimelineEvent } | FoldedGap

/**
 * Events with the quiet stretches between them collapsed once they exceed `thresholdDays`.
 * The rule is not a ruler: everything here is either an exact mark or an explicitly
 * labelled Fold, never silently compressed.
 */
export function foldTimeline(
  events: readonly TimelineEvent[],
  spans: readonly Span[],
  thresholdDays: number,
): TimelineRow[] {
  const sorted = [...events].sort((a, b) => b.date.localeCompare(a.date))
  if (sorted.length === 0) return []

  const rows: TimelineRow[] = [{ kind: 'event', event: sorted[0]! }]
  for (let i = 1; i < sorted.length; i++) {
    const newer = sorted[i - 1]!
    const older = sorted[i]!
    const gapDays = daysBetween(older.date, newer.date)
    if (gapDays > thresholdDays) {
      rows.push({
        kind: 'fold',
        start: older.date,
        end: newer.date,
        days: gapDays,
        held: heldThroughout(spans, older.date, newer.date),
      })
    }
    rows.push({ kind: 'event', event: older })
  }
  return rows
}
