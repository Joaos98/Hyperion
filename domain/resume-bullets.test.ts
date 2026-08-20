import { describe, expect, it } from 'vitest'
import { DomainError } from './errors.js'
import { buildResumeBulletsPrompt } from './resume-bullets.js'
import type { SelfAssessmentEntry } from './self-assessment.js'

describe('buildResumeBulletsPrompt', () => {
  it('refuses to draft from an empty log rather than send an empty prompt', () => {
    expect(() => buildResumeBulletsPrompt([])).toThrow(DomainError)
  })

  it('includes every entry, its date and its position label', () => {
    const entries: SelfAssessmentEntry[] = [
      { date: '2026-02-12', text: 'Rewrote the reconciliation job.', impact: '90m to 6m', position: 'Kestrel Systems' },
      { date: '2026-01-04', text: 'Onboarded a new engineer.', impact: null, position: null },
    ]
    const prompt = buildResumeBulletsPrompt(entries)
    expect(prompt).toContain('2026-02-12 (Kestrel Systems): Rewrote the reconciliation job. Impact: 90m to 6m.')
    expect(prompt).toContain('2026-01-04: Onboarded a new engineer.')
  })

  it('omits the Impact clause entirely when Impact is absent, rather than a placeholder', () => {
    const prompt = buildResumeBulletsPrompt([{ date: '2026-01-04', text: 'Onboarded a new engineer.', impact: null, position: null }])
    expect(prompt).not.toContain('Impact:')
  })

  it('instructs the model not to invent a metric where none was recorded', () => {
    const prompt = buildResumeBulletsPrompt([{ date: '2026-01-04', text: 'Did a thing.', impact: null, position: null }])
    expect(prompt.toLowerCase()).toContain('do not')
    expect(prompt.toLowerCase()).toContain('invent')
  })

  it('asks for one plain line per bullet, no markup, so the output can be split on newlines', () => {
    const prompt = buildResumeBulletsPrompt([{ date: '2026-01-04', text: 'Did a thing.', impact: null, position: null }])
    expect(prompt.toLowerCase()).toContain('one line per bullet')
    expect(prompt.toLowerCase()).toContain('bullet characters')
  })
})
