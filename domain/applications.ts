import { DomainError } from './errors.js'
import { daysBetween, type IsoDate } from './date.js'
import type {
  Application,
  ApplicationEvent,
  ApplicationEventId,
  ApplicationId,
  Position,
  PositionId,
  Stage,
  StandingTerms,
  StandingTermsId,
} from './types.js'

function normalized(text: string): string {
  return text.trim().toLowerCase()
}

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
 *
 * Takes `events` in ANY order and sorts internally — pass the raw list, never one already
 * run through `eventsNewestFirst`. That function's same-day tie-break reads position in the
 * array as insertion order; feeding it its own output re-derives that position from the
 * now-reordered array and inverts the tie (a bug this once was, in `ApplicationView.vue`'s
 * `currentStatus` — caught only because two same-day Events happened to exist).
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
 * Whether an Open Application counts as Stalled (CONTEXT.md § Stalled): its most recent
 * Event is older than `stallThresholdDays`. Always false once an Application reaches a
 * Terminal Stage — there is nothing left to have gone quiet. Reported neutrally, a queue to
 * look at rather than an accusation: silence is the normal case in a job search.
 */
export function isStalled(events: readonly ApplicationEvent[], today: IsoDate, stallThresholdDays: number): boolean {
  if (!isOpen(events)) return false
  const latest = eventsNewestFirst(events)[0]!.date
  return daysBetween(latest, today) > stallThresholdDays
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

/**
 * The existing Application `candidate` has history with, if any (CONTEXT.md § Prior
 * Application) — matched by posting URL, or by company with a similar title, since neither
 * signal alone is reliable: the same posting can be re-listed under a slightly different
 * title, and two different roles at one company can otherwise share a title outright. Of
 * everything that matches, the one `existing` places last — the same later-in-the-list-is-
 * later-in-time convention `eventsNewestFirst` already uses for Application Events.
 *
 * Surfaced as context, never a block: applying again once time has passed is legitimate,
 * and Hyperion has no opinion on how much time is enough. The one case worth raising a
 * voice for — an Open Application already sitting at the same posting — is for the caller
 * to check with `isOpen` against the match this returns, not a second function here.
 */
export function priorApplicationFor(
  candidate: { company: string; title: string; postingUrl: string | null },
  existing: readonly Application[],
): Application | undefined {
  const matches = existing.filter((application) => {
    if (candidate.postingUrl && application.postingUrl === candidate.postingUrl) return true
    return normalized(application.company) === normalized(candidate.company) && similarTitle(application.title, candidate.title)
  })
  return matches.length > 0 ? matches[matches.length - 1] : undefined
}

function similarTitle(a: string, b: string): boolean {
  const x = normalized(a)
  const y = normalized(b)
  return x === y || x.includes(y) || y.includes(x)
}

// ── The funnel, response rates and time-to-response (CONTEXT.md § Funnel, § Response) ──

/** A Stage counting as a milestone reached, in the fixed order the Funnel measures. */
const FUNNEL_STAGES: readonly Stage[] = ['applied', 'screen', 'assessment', 'interview', 'offer', 'landed']

/**
 * A Stage counting as evidence an employer actually responded (CONTEXT.md § Response) —
 * every Stage past Applied except Withdrawn itself, which is the applicant's own action and
 * proves nothing about the other side. An Application that reached Interview and was then
 * Withdrawn still counts as having gotten a response; one that went straight from Applied to
 * Withdrawn, with nothing between, does not.
 */
const RESPONSE_STAGES: readonly Stage[] = ['screen', 'assessment', 'interview', 'offer', 'rejected', 'landed']

/**
 * How many Applications ever reached each Stage in `FUNNEL_STAGES`, in order (CONTEXT.md §
 * Funnel). "Reached" means an Event at that Stage exists at some point, not "is currently
 * at or past it" — Stage is not ordinal in the data, so an Application that went straight
 * from Applied to Interview, skipping Screen, correctly never counts toward Screen.
 */
export function funnelCounts(
  applications: readonly Application[],
  eventsByApplication: ReadonlyMap<ApplicationId, readonly ApplicationEvent[]>,
): { stage: Stage; count: number }[] {
  return FUNNEL_STAGES.map((stage) => ({
    stage,
    count: applications.filter((application) => (eventsByApplication.get(application.id) ?? []).some((event) => event.stage === stage))
      .length,
  }))
}

/** Whether an Application ever got a Response, in the sense `RESPONSE_STAGES` defines. */
export function hasResponse(events: readonly ApplicationEvent[]): boolean {
  return events.some((event) => RESPONSE_STAGES.includes(event.stage))
}

/**
 * Days from Applied to the first Response, or `undefined` without both — an Application
 * still waiting, or one Applied to but never actually sent (Saved only), has no answer yet
 * rather than a zero standing in for one.
 */
export function daysToResponse(events: readonly ApplicationEvent[]): number | undefined {
  const applied = events.find((event) => event.stage === 'applied')
  if (!applied) return undefined
  const responses = events.filter((event) => RESPONSE_STAGES.includes(event.stage) && event.date >= applied.date)
  if (responses.length === 0) return undefined
  const earliest = responses.reduce((min, event) => (event.date < min ? event.date : min), responses[0]!.date)
  return daysBetween(applied.date, earliest)
}

/** The average days to first Response across every Application that got one (CONTEXT.md § Response). */
export function averageDaysToResponse(
  applications: readonly Application[],
  eventsByApplication: ReadonlyMap<ApplicationId, readonly ApplicationEvent[]>,
): number | undefined {
  const days = applications
    .map((application) => daysToResponse(eventsByApplication.get(application.id) ?? []))
    .filter((value): value is number => value !== undefined)
  return average(days)
}

/**
 * Response Rate (CONTEXT.md § Response Rate): how many Applications, out of the total, ever
 * got a Response. One overall figure, not broken down by Source — a per-Source split just
 * multiplies the same low-volume noise problem across smaller buckets.
 */
export function responseRate(
  applications: readonly Application[],
  eventsByApplication: ReadonlyMap<ApplicationId, readonly ApplicationEvent[]>,
): { responded: number; total: number } {
  return {
    responded: applications.filter((application) => hasResponse(eventsByApplication.get(application.id) ?? [])).length,
    total: applications.length,
  }
}

function average(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined
  return values.reduce((sum, value) => sum + value, 0) / values.length
}
