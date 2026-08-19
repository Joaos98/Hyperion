import { DomainError } from './errors.js'
import type { IsoDate } from './date.js'

/**
 * One Achievement's worth of context for a self-assessment draft — pulled out of the
 * domain type rather than passed as a whole `Achievement`, since `position` here is
 * already resolved to a label (or none) and the prompt has no use for ids.
 */
export interface SelfAssessmentEntry {
  date: IsoDate
  text: string
  impact: string | null
  position: string | null
}

/**
 * The prompt for a self-assessment draft (plan § Self-assessment draft): turns a
 * stretch of the achievement log into a first-person write-up a User could hand to a
 * manager. Pure string construction, no I/O — the network call itself is a `ui/`
 * concern, exactly as calling a storage adapter is.
 *
 * Two things this is careful to say, because Hyperion is a record and not an advisor
 * (CONTEXT.md's own line): only what is in the log may be used, and Impact is often
 * absent by design (CONTEXT.md § Impact — "not everything worth recording is
 * measurable") rather than an omission to paper over with an invented number.
 */
export function buildSelfAssessmentPrompt(entries: readonly SelfAssessmentEntry[]): string {
  if (entries.length === 0) {
    throw new DomainError('cannot draft a self-assessment from an empty Achievement log')
  }

  const lines = entries.map((entry) => {
    const where = entry.position ? ` (${entry.position})` : ''
    const impact = entry.impact ? ` Impact: ${entry.impact}.` : ''
    return `- ${entry.date}${where}: ${entry.text}${impact}`
  })

  return [
    "Below are dated notes from someone's own work log, oldest first is not guaranteed —",
    'read every entry regardless of order. Write a first-person self-assessment draft',
    'suitable for a performance review: professional, specific, and organised by theme',
    '(impact, collaboration, growth) rather than repeating the entries in a list.',
    '',
    'Use only what the notes actually say. Where an entry has no stated Impact, do not',
    'invent a metric or outcome to fill the gap — describe the work itself instead. This',
    'is a draft the person will edit before using, not a finished document.',
    '',
    'ENTRIES:',
    ...lines,
  ].join('\n')
}
