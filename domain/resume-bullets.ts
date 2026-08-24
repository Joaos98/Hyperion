import { DomainError } from './errors.js'
import type { SelfAssessmentEntry } from './self-assessment.js'

/**
 * The prompt for résumé bullets — the same log slice `buildSelfAssessmentPrompt` reads, turned
 * into short, résumé-ready lines instead of prose. A Suggestion (CONTEXT.md § Suggestion): drafted,
 * never applied — the person copies, edits or discards each line themselves.
 */
export function buildResumeBulletsPrompt(entries: readonly SelfAssessmentEntry[]): string {
  if (entries.length === 0) {
    throw new DomainError('cannot draft résumé bullets from an empty Achievement log')
  }

  const lines = entries.map((entry) => {
    const where = entry.position ? ` (${entry.position})` : ''
    const impact = entry.impact ? ` Impact: ${entry.impact}.` : ''
    return `- ${entry.date}${where}: ${entry.text}${impact}`
  })

  return [
    "Below are dated notes from someone's own work log, oldest first is not guaranteed —",
    'read every entry regardless of order. Write résumé bullet points from these notes:',
    'one line per bullet, action-verb-led, specific, no longer than a single line each.',
    '',
    "Use only what the notes actually say. Quantify a bullet only where the entry's own",
    'Impact states a number — do not invent one to fill the gap; describe the work itself',
    'instead. Output one bullet per line and nothing else: no headers, no numbering, no',
    'bullet characters, no blank lines between them, so each line can be used as-is.',
    '',
    'ENTRIES:',
    ...lines,
  ].join('\n')
}
