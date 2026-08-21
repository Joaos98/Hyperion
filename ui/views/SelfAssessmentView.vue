<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { achievementsSince, buildSelfAssessmentPrompt, type Achievement, type SelfAssessmentEntry } from '../../domain/index.js'
import { AiError, askAi } from '../ai.js'
import { record, today } from '../record.js'

/** Set once, from Settings — every AI feature reads the same three fields from there (plan § AI is additive). */
const isSetUp = computed(() => !!(record.user?.aiBaseUrl && record.user?.aiApiKey && record.user?.aiModel))

// ── which entries feed the draft ─────────────────────────────────────────
function monthsAgo(months: number): string {
  const [year, month, day] = today().split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCMonth(date.getUTCMonth() - months)
  return date.toISOString().slice(0, 10)
}

/**
 * A rolling "last N months" is the common case, but a review cycle usually starts on a
 * fixed date — the semester, the quarter — not on however many months back today happens
 * to be. In November, "last 6 months" reaches into May even if the cycle started in July,
 * so Custom lets the start date be stated directly instead of approximated.
 */
const CUSTOM_RANGE = 'custom'
const rangeChoice = ref<number | typeof CUSTOM_RANGE>(6)
const customSince = ref(monthsAgo(6))

function sinceDate(): string {
  return rangeChoice.value === CUSTOM_RANGE ? customSince.value : monthsAgo(rangeChoice.value)
}

/**
 * A review is written for one employer at a time — an achievement from the job you left
 * four months ago, or a talk logged against no Position at all, has no business in a
 * draft for your current one. So this scopes to a single Position by default rather than
 * the whole log; "All positions" is there for the rarer case of a personal reflection
 * that is not tied to any one manager.
 */
const ALL_POSITIONS = 'all'

function defaultPositionFilter(): string {
  const current = record.positions.find((position) => position.departure === null)
  if (current) return current.id
  const mostRecent = [...record.positions].sort((a, b) => b.startDate.localeCompare(a.startDate))[0]
  return mostRecent ? mostRecent.id : ALL_POSITIONS
}

const positionFilter = ref(defaultPositionFilter())

const positionOptions = computed(() =>
  [...record.positions].sort((a, b) => {
    const aCurrent = a.departure === null
    const bCurrent = b.departure === null
    if (aCurrent !== bCurrent) return aCurrent ? -1 : 1
    return b.startDate.localeCompare(a.startDate)
  }),
)

const entries = computed<SelfAssessmentEntry[]>(() => {
  const positionName = new Map(record.positions.map((position) => [position.id, position.company]))
  const inRange = achievementsSince(record.achievements as Achievement[], sinceDate())
  const scoped =
    positionFilter.value === ALL_POSITIONS
      ? inRange
      : inRange.filter((achievement) => achievement.positionId === positionFilter.value)
  return scoped.map((achievement) => ({
    date: achievement.date,
    text: achievement.text,
    impact: achievement.impact,
    position:
      positionFilter.value === ALL_POSITIONS && achievement.positionId
        ? (positionName.get(achievement.positionId) ?? null)
        : null,
  }))
})

// ── generating the draft ─────────────────────────────────────────────────
const draft = ref('')
const busy = ref(false)
const error = ref('')
const copied = ref(false)

async function generate(): Promise<void> {
  error.value = ''
  if (!isSetUp.value || !record.user?.aiBaseUrl || !record.user.aiApiKey || !record.user.aiModel || entries.value.length === 0) return
  busy.value = true
  try {
    const prompt = buildSelfAssessmentPrompt(entries.value)
    draft.value = await askAi(record.user.aiBaseUrl, record.user.aiApiKey, record.user.aiModel, prompt)
  } catch (cause) {
    error.value = cause instanceof AiError ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}

async function copyDraft(): Promise<void> {
  try {
    await navigator.clipboard.writeText(draft.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    // Clipboard access can be refused by the browser; the text is still selectable by hand.
  }
}
</script>

<template>
  <div class="board">
    <div class="intro">
      <h2>Self-assessment draft</h2>
      <p class="note">
        Your achievement log as a first-person draft for your manager. A
        <b>Suggestion</b>: edit it or bin it — Hyperion never saves it or acts on it.
      </p>
    </div>

    <!-- gated state: visible, inactive, never hidden -->
    <div v-if="!isSetUp" class="panel gated">
      <p><b>Needs your own AI setup.</b></p>
      <p class="note">
        Entries go from your browser straight to your endpoint, with your own key — never
        through this server. <RouterLink to="/settings">Configure it in Settings →</RouterLink>
      </p>
    </div>

    <template v-else>
      <div class="panel">
        <div class="scope">
          <label>
            Position
            <select v-model="positionFilter">
              <option v-for="position in positionOptions" :key="position.id" :value="position.id">
                {{ position.company }}{{ position.departure === null ? ' (current)' : '' }}
              </option>
              <option :value="ALL_POSITIONS">All positions</option>
            </select>
          </label>
          <label>
            Since
            <select v-model="rangeChoice">
              <option :value="3">3 months ago</option>
              <option :value="6">6 months ago</option>
              <option :value="12">12 months ago</option>
              <option :value="CUSTOM_RANGE">a specific date…</option>
            </select>
          </label>
          <input v-if="rangeChoice === CUSTOM_RANGE" v-model="customSince" type="date" :max="today()" />
          <span class="count">{{ entries.length }} entr{{ entries.length === 1 ? 'y' : 'ies' }}</span>
        </div>

        <p v-if="entries.length === 0" class="none">
          Nothing logged for this scope — widen the range, choose a different Position, or
          log something first.
        </p>
        <div v-else class="entries">
          <div v-for="entry in entries" :key="entry.date + entry.text" class="entry">
            <p class="prose">{{ entry.text }}</p>
            <div class="meta">
              {{ entry.date }}<template v-if="entry.position"> · {{ entry.position }}</template>
              <template v-if="entry.impact"> · {{ entry.impact }}</template>
            </div>
          </div>
        </div>

        <button class="primary generate" :disabled="entries.length === 0 || busy" @click="generate">
          {{ busy ? 'Drafting…' : draft ? 'Regenerate' : 'Generate draft' }}
        </button>
        <p v-if="error" class="error">{{ error }}</p>
      </div>

      <div v-if="draft" class="panel">
        <div class="draft-head">
          <h3>Draft</h3>
          <button class="linkbtn" @click="copyDraft">{{ copied ? 'copied' : 'copy' }}</button>
        </div>
        <textarea v-model="draft" rows="16"></textarea>
      </div>
    </template>
  </div>
</template>

<style scoped>
.board {
  display: flex;
  flex-direction: column;
  gap: 22px;
  max-width: 72ch;
}

.intro h2 {
  font-size: 18px;
  margin-bottom: 6px;
}

.note {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.55;
}

.note b {
  color: var(--text);
  font-weight: 500;
}

.panel {
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-card);
  padding: 20px 22px;
}

.panel.gated {
  background: transparent;
  border-style: dashed;
}

.panel.gated p {
  margin: 0 0 8px;
  font-size: 13.5px;
}

.panel.gated .note a {
  color: var(--selene);
}

.linkbtn {
  background: transparent;
  border: none;
  color: var(--faint);
  font-size: 11.5px;
  text-decoration: underline;
  cursor: pointer;
}

.linkbtn:hover {
  color: var(--selene);
}

.scope {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 18px;
  margin: 18px 0 14px;
}

.scope label {
  font-size: 13px;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 8px;
}

.scope select,
.scope input[type='date'] {
  background: var(--page);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  padding: 6px 9px;
  color: var(--text);
  font-size: 13px;
  font-family: var(--sans);
  max-width: 220px;
}

.scope .count {
  margin-left: auto;
}

.count {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--faint);
}

.none {
  color: var(--faint);
  font-size: 12.5px;
  margin: 8px 0 16px;
}

.entries {
  max-height: 320px;
  overflow-y: auto;
  margin-bottom: 16px;
}

.entry {
  padding: 10px 0;
  border-bottom: 1px solid var(--hairline);
}

.entry:last-child {
  border-bottom: none;
}

.entry .prose {
  font-size: 13px;
  margin: 0;
}

.entry .meta {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--faint);
  margin-top: 4px;
}

.generate {
  width: 100%;
}

button.primary {
  background: var(--selene);
  color: var(--page);
  border: none;
  border-radius: var(--radius-control);
  padding: 9px 16px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

button.primary:disabled {
  opacity: 0.5;
  cursor: default;
}

button.ghost {
  background: transparent;
  border: 1px solid var(--hairline);
  color: var(--muted);
  border-radius: var(--radius-control);
  padding: 9px 16px;
  font-size: 13px;
  cursor: pointer;
}

.error {
  color: var(--fall);
  font-size: 12.5px;
  margin-top: 10px;
}

.draft-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 10px;
}

.draft-head h3 {
  font-size: 13px;
  color: var(--muted);
}

textarea {
  width: 100%;
  background: var(--page);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  padding: 14px;
  color: var(--text);
  font-family: var(--serif);
  font-size: 14px;
  line-height: 1.6;
  resize: vertical;
}
</style>
