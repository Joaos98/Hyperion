import { DomainError } from './errors.js'
import type { IsoDate } from './date.js'
import type {
  Application,
  ApplicationEvent,
  ApplicationEventId,
  Position,
  PositionId,
  Stage,
  StandingTerms,
  StandingTermsId,
} from './types.js'

/** A Stage an Application does not leave (CONTEXT.md § Terminal Stage). */
const TERMINAL_STAGES: readonly Stage[] = ['rejected', 'withdrawn', 'landed']

export function isTerminalStage(stage: Stage): boolean {
  return TERMINAL_STAGES.includes(stage)
}

/**
 * Application Events newest first — the order the pipeline history is always read in, and
 * what Status reads its answer from.
 *
 * Dates alone cannot always say which of two Events came later: applying and landing the
 * same day is ordinary, not an edge case, and an IsoDate carries no finer grain than that
 * (the same convention as every other date in the domain). So ties break on the order the
 * caller handed the Events in, treating later-in-the-list as later-in-time — which is
 * exactly true of `record.applicationEvents` as the reactive store appends to it, and of
 * `SqliteStore`'s query, which orders explicitly by insertion rather than leaving it to
 * however SQLite happens to scan the table.
 */
export function eventsNewestFirst(events: readonly ApplicationEvent[]): ApplicationEvent[] {
  return events
    .map((event, insertionIndex) => ({ event, insertionIndex }))
    .sort((a, b) => b.event.date.localeCompare(a.event.date) || b.insertionIndex - a.insertionIndex)
    .map(({ event }) => event)
}

/**
 * An Application's Status (CONTEXT.md § Status): the Stage of its most recent Event.
 * Derived and never stored — `undefined` for an Application with no Events at all, which
 * should not occur in practice since creating one always logs its first Event, but the
 * type says so rather than assuming it.
 */
export function status(events: readonly ApplicationEvent[]): Stage | undefined {
  if (events.length === 0) return undefined
  return eventsNewestFirst(events)[0]!.stage
}

/** An Application whose Status is not a Terminal Stage (CONTEXT.md § Open Application). */
export function isOpen(events: readonly ApplicationEvent[]): boolean {
  const current = status(events)
  return current !== undefined && !isTerminalStage(current)
}

/**
 * Turns an Application into a Position (CONTEXT.md § Landing): its Offered Terms become
 * the new Position's Starting Terms, and the Application is not consumed — the caller
 * still appends the returned Event to its own log, reaching the Landed Stage.
 *
 * Ids are supplied rather than minted here, the same convention as everywhere else new
 * entities are created in this codebase (`mintId` is called at the point of use, keeping
 * domain functions pure and independent of `crypto`).
 */
export function landApplication(
  application: Application,
  ids: { positionId: PositionId; standingTermsId: StandingTermsId; eventId: ApplicationEventId },
  today: IsoDate,
): { position: Position; standingTerms: StandingTerms; event: ApplicationEvent } {
  const offer = application.offeredTerms
  if (!offer) {
    throw new DomainError('cannot Land an Application with no Offered Terms')
  }

  const position: Position = {
    id: ids.positionId,
    userId: application.userId,
    company: application.company,
    currency: offer.currency,
    startDate: offer.startDate,
    departure: null,
  }

  const standingTerms: StandingTerms = {
    id: ids.standingTermsId,
    positionId: ids.positionId,
    effectiveDate: offer.startDate,
    title: application.title,
    employmentType: offer.employmentType,
    baseSalaryMinor: offer.baseSalaryMinor,
    targetBonusMinor: offer.targetBonusMinor,
  }

  const event: ApplicationEvent = {
    id: ids.eventId,
    applicationId: application.id,
    stage: 'landed',
    date: today,
    note: null,
  }

  return { position, standingTerms, event }
}
