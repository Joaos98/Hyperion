<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  currentStandingTerms,
  daysSinceLastAchievement,
  formatAmount,
  foldTimeline,
  isCurrent,
  isOpen,
  isStalled,
  perMonth,
  positionSpans,
  status,
  stayPremium,
  tenure,
  timelineEvents,
  totalOfTerms,
  type Achievement,
  type Application,
  type ApplicationEvent,
  type Money,
  type Payment,
  type Position,
  type Stage,
  type StandingTerms,
  type TimelineEvent,
} from '../../domain/index.js'
import { record, saveUser, today } from '../record.js'
import LogAchievementModal from '../components/LogAchievementModal.vue'

function byPosition<T extends { positionId: string }>(rows: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) map.set(row.positionId, [...(map.get(row.positionId) ?? []), row])
  return map
}

const termsByPosition = computed(() => byPosition(record.standingTerms as StandingTerms[]))
const paymentsByPosition = computed(() => byPosition(record.payments as Payment[]))
const positions = computed(() => record.positions as Position[])
const spans = computed(() => positionSpans(positions.value))

const events = computed(() => timelineEvents(positions.value, termsByPosition.value, paymentsByPosition.value))

const threshold = computed(() => record.user?.foldThresholdDays ?? 90)
const rows = computed(() => foldTimeline(events.value, spans.value, threshold.value))

const showLogModal = ref(false)

/**
 * How a point-in-time salary figure renders — `User.compensationDisplay`, defended with
 * the same `?? 'annual'` fallback `foldThresholdDays` already uses for a record from
 * before this field existed. A one-off Payment is never run through this: it is not an
 * annual rate to begin with, so dividing it by twelve would misrepresent it rather than
 * just redisplay it.
 */
const period = computed(() => record.user?.compensationDisplay ?? 'annual')
const periodUnit = computed(() => (period.value === 'monthly' ? 'mo' : 'yr'))

async function setPeriod(value: 'annual' | 'monthly'): Promise<void> {
  if (!record.user || period.value === value) return
  await saveUser({ ...record.user, compensationDisplay: value })
}

/** A Standing Terms figure (never a Payment), shown at whichever period the User chose. */
function fmtTerms(minor: number, position: Position): string {
  const annual = money(minor, position)
  return formatAmount(period.value === 'monthly' ? perMonth(annual) : annual)
}

// ── sidebar: Current Position ──────────────────────────────────────────
const currentPosition = computed(() => positions.value.find(isCurrent))
const currentTerms = computed(() =>
  currentPosition.value ? currentStandingTerms(termsByPosition.value.get(currentPosition.value.id) ?? [], today()) : undefined,
)
const currentTotal = computed(() => {
  if (!currentTerms.value || !currentPosition.value) return undefined
  const annual = totalOfTerms(currentTerms.value, currentPosition.value.currency)
  return period.value === 'monthly' ? perMonth(annual) : annual
})
const currentStay = computed(() =>
  currentPosition.value ? stayPremium(currentPosition.value, termsByPosition.value.get(currentPosition.value.id) ?? []) : undefined,
)

function sinceLabel(date: string): string {
  return `${MONTH_ABBREV[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`
}

// ── sidebar: Log an achievement ──────────────────────────────────────────
const staleness = computed(() => daysSinceLastAchievement(record.achievements as Achievement[], today()))

// ── sidebar: Applications ──────────────────────────────────────────────
const applications = computed(() => record.applications as Application[])

const eventsByApplication = computed(() => {
  const map = new Map<string, ApplicationEvent[]>()
  for (const event of record.applicationEvents as ApplicationEvent[]) map.set(event.applicationId, [...(map.get(event.applicationId) ?? []), event])
  return map
})

function statusOf(application: Application): Stage | undefined {
  return status(eventsByApplication.value.get(application.id) ?? [])
}

function latestEventDate(application: Application): number {
  const dates = (eventsByApplication.value.get(application.id) ?? []).map((event) => Date.parse(event.date))
  return dates.length === 0 ? 0 : Math.max(...dates)
}

// Stalled first (CONTEXT.md § Stalled: "being visible when you open the app is the whole
// mechanism" — this is the page you open, so this is where that has to be true), then the
// ordinary recency order. Three rows can't be the signal on their own, so the count in the
// foot carries it: the card points, /applications lists.
const stallThresholdDays = computed(() => record.user?.stallThresholdDays ?? 21)
function stalled(application: Application): boolean {
  return isStalled(eventsByApplication.value.get(application.id) ?? [], today(), stallThresholdDays.value)
}

const openApplications = computed(() =>
  applications.value
    .filter((application) => isOpen(eventsByApplication.value.get(application.id) ?? []))
    .sort((a, b) => Number(stalled(b)) - Number(stalled(a)) || latestEventDate(b) - latestEventDate(a)),
)
const quietCount = computed(() => openApplications.value.filter(stalled).length)
const latestApplications = computed(() => openApplications.value.slice(0, 3))

function daysAgo(application: Application): number | undefined {
  const events = eventsByApplication.value.get(application.id) ?? []
  if (events.length === 0) return undefined
  return Math.round((Date.parse(today()) - latestEventDate(application)) / 86_400_000)
}

function chipClass(stage: Stage | undefined): string {
  if (stage === 'landed') return 'ok'
  if (stage === 'rejected' || stage === 'withdrawn') return 'no'
  return 'q'
}

/**
 * Whether the rule is thick and whose colour it takes at `date`: `current` for a Position
 * still open (the gradient down to Selene), `held` for one that has ended (a flat grey),
 * `none` where nothing was held.
 */
function railState(date: string): 'current' | 'held' | 'none' {
  const covering = spans.value.find(
    (span) => !span.alongside && span.start <= date && (span.end === undefined || date <= span.end),
  )
  if (!covering) return 'none'
  return covering.end === undefined ? 'current' : 'held'
}

function isCurrentTerms(event: Extract<TimelineEvent, { kind: 'standing-terms' }>): boolean {
  if (!isCurrent(event.position)) return false
  const terms = termsByPosition.value.get(event.position.id) ?? []
  return currentStandingTerms(terms, today())?.id === event.terms.id
}

function tenureLabel(position: Position): string {
  const { years, months } = tenure(position, today())
  const parts = [years > 0 ? `${years}y` : undefined, `${months}m`].filter(Boolean)
  return parts.join(' ')
}

function money(minor: number, position: Position): Money {
  return { minor, currency: position.currency }
}

function fmt(minor: number, position: Position): string {
  return formatAmount(money(minor, position))
}

const MONTH_ABBREV = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The gutter label for each row in `rows`, same index — "Mon YYYY" for every dated row,
 * the same format the Current Position card's `sinceLabel` already uses. An earlier
 * version compacted this to a bare year the first time it appeared and just the month
 * after that, but that read as ambiguous once a Fold sat between two same-year events —
 * every row restating its own year outright removes the ambiguity. Fold rows carry no
 * label of their own; a Fold already states its span in words.
 */
const dateLabels = computed(() => rows.value.map((row) => (row.kind === 'fold' ? '' : sinceLabel(row.event.date))))

function foldLabel(days: number): string {
  if (days < 60) return `${days}d`
  const months = Math.round(days / 30.44)
  if (months < 24) return `${months}mo`
  return `${Math.round(months / 12)}y`
}

/** Which dot style a mark takes — a raise or promotion rises, a departure ends. */
function markClass(event: TimelineEvent): 'up' | 'end' | undefined {
  if (event.kind === 'departure') return 'end'
  if (event.kind === 'standing-terms' && event.previous) {
    const before = event.previous.baseSalaryMinor + event.previous.targetBonusMinor
    const after = event.terms.baseSalaryMinor + event.terms.targetBonusMinor
    if (after > before) return 'up'
  }
  return undefined
}

type StandingTermsEvent = Extract<TimelineEvent, { kind: 'standing-terms' }>

/**
 * A changed Standing Terms is labelled by what actually happened: a title change with a pay
 * change is a Promotion (`isPromotion`'s own definition); a pay change alone is a Raise; a
 * title-only or lateral change falls back to the generic label rather than claiming either.
 */
function standingTermsLabel(event: StandingTermsEvent): string {
  if (!event.previous) return 'Standing Terms'
  if (event.isPromotion) return 'Promotion'
  const before = event.previous.baseSalaryMinor + event.previous.targetBonusMinor
  const after = event.terms.baseSalaryMinor + event.terms.targetBonusMinor
  return after > before ? 'Raise' : 'Standing Terms'
}

/** The percent change a changed Standing Terms represents, `undefined` with nothing to divide by. */
function deltaPercent(event: StandingTermsEvent): number | undefined {
  if (!event.previous) return undefined
  const before = event.previous.baseSalaryMinor + event.previous.targetBonusMinor
  if (before === 0) return undefined
  const after = event.terms.baseSalaryMinor + event.terms.targetBonusMinor
  return ((after - before) / before) * 100
}
</script>

<template>
  <div class="board">
    <div class="home-layout">
      <div v-if="rows.length === 0" class="empty">
        <p><b>Nothing recorded yet.</b></p>
        <p class="note">A <RouterLink to="/positions">Position</RouterLink>, once you add one, starts the rule.</p>
      </div>

      <div v-else class="pillar">
      <template v-for="(row, index) in rows" :key="index">
        <!-- fold: a quiet stretch, nothing logged in it -->
        <template v-if="row.kind === 'fold'">
          <div class="yr"></div>
          <div class="rail" :class="railState(row.start)"></div>
          <div class="bd tight">
            <span class="folded">{{ foldLabel(row.days) }} · nothing logged</span>
          </div>
        </template>

        <!-- event: a dated mark -->
        <template v-else>
          <div class="yr" :class="{ now: railState(row.event.date) === 'current' }">
            {{ dateLabels[index] }}
          </div>
          <div class="rail" :class="railState(row.event.date)">
            <span class="mk" :class="markClass(row.event)"></span>
          </div>
          <div class="bd">
            <!-- standing terms: starting terms get the full introduction; a later change
                 (Raise, Promotion, or the generic fallback) is just the delta — the role,
                 company and NOW tick already live in the Current Position card. -->
            <template v-if="row.event.kind === 'standing-terms'">
              <template v-if="!row.event.previous">
                <div class="role">
                  {{ row.event.terms.title }} ·
                  <RouterLink :to="`/positions/${row.event.position.id}`" class="co link">{{ row.event.position.company }}</RouterLink>
                  <span v-if="isCurrentTerms(row.event)" class="tick">NOW · {{ tenureLabel(row.event.position) }}</span>
                </div>
                <div class="terms">
                  {{ fmtTerms(row.event.terms.baseSalaryMinor, row.event.position) }} base ·
                  {{ fmtTerms(row.event.terms.targetBonusMinor, row.event.position) }} target ·
                  {{ row.event.terms.employmentType.toUpperCase() }} ·
                  <span class="unit">/{{ periodUnit }}</span>
                </div>
              </template>
              <div v-else class="ev">
                <b>{{ standingTermsLabel(row.event) }}</b><span v-if="row.event.isPromotion"> — {{ row.event.previous.title }} → {{ row.event.terms.title }}</span>
                <div class="terms">
                  {{ fmtTerms(row.event.previous.baseSalaryMinor + row.event.previous.targetBonusMinor, row.event.position) }}
                  →
                  <b>{{ fmtTerms(row.event.terms.baseSalaryMinor + row.event.terms.targetBonusMinor, row.event.position) }}</b>
                  <span class="unit">/{{ periodUnit }}</span>
                  <span v-if="deltaPercent(row.event) !== undefined" :class="deltaPercent(row.event)! >= 0 ? 'up' : 'down'">
                    {{ deltaPercent(row.event)! >= 0 ? '+' : '' }}{{ deltaPercent(row.event)!.toFixed(1) }}%
                  </span>
                </div>
              </div>
            </template>

            <!-- payment -->
            <template v-else-if="row.event.kind === 'payment'">
              <div class="ev">
                <b>{{ row.event.payment.label }}</b>
                <div class="terms">{{ fmt(row.event.payment.amountMinor, row.event.position) }}</div>
              </div>
            </template>

            <!-- departure -->
            <template v-else-if="row.event.kind === 'departure'">
              <div class="ev">
                <b>Ended</b> at {{ row.event.position.company }} — {{ row.event.departure.reason }}
              </div>
            </template>
          </div>
        </template>
      </template>
      </div>

      <div class="side">
        <div class="card">
          <div class="log-row">
            <span class="log-label">What did you ship?</span>
            <button class="log-btn" :disabled="positions.length === 0" @click="showLogModal = true">+ Log achievement</button>
          </div>
          <p v-if="positions.length === 0" class="card-empty">
            Add a <RouterLink to="/positions">Position</RouterLink> first — an Achievement needs one to belong to.
          </p>
          <template v-else>
            <p v-if="staleness === undefined" class="log-stale">Nothing logged yet.</p>
            <p v-else-if="staleness > 0" class="log-stale">Last logged <b>{{ staleness }}</b> day{{ staleness === 1 ? '' : 's' }} ago</p>
            <p v-else class="log-stale">Logged today.</p>
          </template>
        </div>

        <div class="card">
          <div class="card-h">
            <h3>Current Position</h3>
            <span v-if="currentPosition" class="sub">since {{ sinceLabel(currentPosition.startDate) }}</span>
          </div>
          <template v-if="currentPosition">
            <div class="period-toggle">
              <button type="button" :class="{ on: period === 'monthly' }" @click="setPeriod('monthly')">Monthly</button>
              <button type="button" :class="{ on: period === 'annual' }" @click="setPeriod('annual')">Annual</button>
            </div>
            <div class="cp-role">
              {{ currentTerms?.title }}
              <span class="cp-co">{{ currentPosition.company }} <span class="tick">NOW · {{ tenureLabel(currentPosition) }}</span></span>
            </div>
            <div v-if="currentTotal" class="cp-figure">{{ formatAmount(currentTotal) }}<span class="u">/{{ periodUnit }} total</span></div>
            <div v-if="currentTerms" class="cp-terms">
              {{ fmtTerms(currentTerms.baseSalaryMinor, currentPosition) }} base ·
              {{ fmtTerms(currentTerms.targetBonusMinor, currentPosition) }} target bonus ·
              {{ currentTerms.employmentType.toUpperCase() }} ·
              <span class="unit">/{{ periodUnit }}</span>
            </div>
            <div v-if="currentStay?.kind === 'available'" class="cp-premium">
              <span class="lbl">Stay Premium</span>
              {{ currentStay.percent >= 0 ? '+' : '' }}{{ currentStay.percent.toFixed(1) }}%/yr since Starting Terms
            </div>
            <div class="cp-foot"><RouterLink :to="`/positions/${currentPosition.id}`">View position &rarr;</RouterLink></div>
          </template>
          <p v-else class="card-empty">Nothing yet. Add a <RouterLink to="/positions">Position</RouterLink> and it's summarized here — role, tenure, current total comp.</p>
        </div>

        <div class="card">
          <div class="card-h">
            <h3>Applications</h3>
            <span v-if="applications.length > 0" class="sub">{{ openApplications.length }} open</span>
          </div>
          <template v-if="applications.length > 0">
            <p v-if="latestApplications.length === 0" class="card-empty">Nothing open right now.</p>
            <div class="app-list">
              <div v-for="application in latestApplications" :key="application.id" class="app-row">
                <div class="app-l">
                  <div class="app-title">{{ application.title }}</div>
                  <div class="app-co">{{ application.company }}</div>
                </div>
                <div class="app-r">
                  <span class="chip" :class="chipClass(statusOf(application))">{{ statusOf(application)?.toUpperCase() }}</span>
                  <span v-if="stalled(application)" class="stalled">quiet {{ daysAgo(application) }}d</span>
                  <span v-else-if="daysAgo(application) !== undefined" class="ago">{{ daysAgo(application) }}d ago</span>
                </div>
              </div>
            </div>
            <div class="app-foot">
              <span class="count">
                {{ applications.length }} total<template v-if="quietCount > 0"> · <span class="quiet">{{ quietCount }} quiet</span></template>
              </span>
              <RouterLink to="/applications">View all &rarr;</RouterLink>
            </div>
          </template>
          <p v-else class="card-empty">
            Nothing open yet. Applications you're pursuing will show up here — <RouterLink to="/applications">add one</RouterLink>.
          </p>
        </div>
      </div>
    </div>

    <LogAchievementModal v-if="showLogModal" :default-position-id="currentPosition?.id" @close="showLogModal = false" />
  </div>
</template>

<style scoped>
.board {
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.empty {
  color: var(--muted);
  font-size: 13.5px;
}

.empty .note {
  color: var(--faint);
  font-size: 12.5px;
}

.empty .note a {
  color: var(--selene);
  text-decoration: underline;
}

.home-layout {
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: 40px;
  align-items: start;
}

.pillar {
  display: grid;
  grid-template-columns: 84px 32px 1fr;
  column-gap: 4px;
}

.yr {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--faint);
  padding-top: 2px;
  text-align: right;
  padding-right: 10px;
  white-space: nowrap;
}

.yr.now {
  color: var(--selene);
}

.rail {
  position: relative;
  min-height: 26px;
}

.rail::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  transform: translateX(-50%);
  width: 1px;
  background: var(--hairline);
}

.rail.held::before,
.rail.current::before {
  width: 7px;
  border-radius: 1px;
  background: var(--held);
}

.rail.current::before {
  background: linear-gradient(180deg, var(--selene), var(--selene-dim));
}

.mk {
  position: absolute;
  left: 50%;
  top: 9px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  transform: translateX(-50%);
  background: var(--page);
  border: 2px solid var(--muted);
  z-index: 2;
}

.mk.up {
  border-color: var(--rise);
  background: var(--rise);
}

.mk.end {
  border-color: var(--fall);
}

.bd {
  padding: 0 0 22px 12px;
  min-height: 26px;
}

.bd.tight {
  padding-bottom: 10px;
}

.role {
  font-size: 14.5px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.co {
  color: var(--muted);
  font-weight: 400;
}

.co.link {
  text-decoration: none;
}

.co.link:hover {
  color: var(--selene);
  text-decoration: underline;
}

.terms {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  margin-top: 3px;
}

.terms b {
  color: var(--text);
  font-weight: 500;
}

.terms .up,
.terms .down {
  margin-left: 6px;
  font-weight: 500;
}

.ev {
  font-size: 13px;
  color: var(--muted);
}

.ev b {
  color: var(--text);
  font-weight: 500;
}

.tick {
  display: inline-block;
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--faint);
  border: 1px solid var(--hairline);
  border-radius: 4px;
  padding: 1px 5px;
  margin-left: 8px;
  vertical-align: 1px;
  letter-spacing: 0.03em;
}

.folded {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--faint);
}

.unit {
  color: var(--faint);
}

/* ── sidebar cards ─────────────────────────────────────────────────── */
.side {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.card {
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-card);
  padding: 18px 20px;
}

.card-h {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 14px;
}

.card-h h3 {
  font-size: 13px;
  font-weight: 600;
  margin: 0;
  letter-spacing: -0.005em;
}

.card-h .sub {
  font-size: 11px;
  color: var(--faint);
  font-family: var(--mono);
}

.card-empty {
  color: var(--muted);
  font-size: 12.5px;
  line-height: 1.55;
  margin: 0;
}

.card-empty :deep(a) {
  color: var(--selene);
  text-decoration: underline;
}

/* log-achievement card */
.log-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.log-label {
  font-size: 13.5px;
  color: var(--muted);
}

.log-btn {
  background: var(--selene);
  color: var(--page);
  border: none;
  border-radius: var(--radius-control);
  padding: 7px 14px;
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}

.log-btn:disabled {
  background: transparent;
  color: var(--faint);
  border: 1px solid var(--hairline);
  cursor: default;
}

.log-stale {
  font-size: 11.5px;
  color: var(--muted);
  margin: 12px 0 0;
}

.log-stale b {
  color: var(--selene);
  font-weight: 500;
}

/* Current Position card */
.period-toggle {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
}

.period-toggle button {
  background: transparent;
  border: 1px solid var(--hairline);
  color: var(--faint);
  border-radius: var(--radius-control);
  font-family: var(--mono);
  font-size: 10.5px;
  padding: 3px 9px;
  cursor: pointer;
}

.period-toggle button.on {
  color: var(--selene);
  border-color: var(--selene);
  background: var(--selene-wash);
}

.cp-role {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.cp-co {
  color: var(--muted);
  font-weight: 400;
  font-size: 14px;
  display: block;
  margin-top: 1px;
}

.cp-figure {
  font-family: var(--mono);
  font-size: 19px;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
  margin-top: 14px;
}

.cp-figure .u {
  font-size: 11.5px;
  color: var(--faint);
  margin-left: 4px;
}

.cp-terms {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--muted);
  margin-top: 5px;
}

.cp-premium {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--rise);
  margin-top: 9px;
}

.cp-premium .lbl {
  color: var(--faint);
  font-family: var(--sans);
}

.cp-foot {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--hairline);
  display: flex;
  justify-content: flex-end;
}

.cp-foot a {
  font-size: 12px;
}

/* Applications card */
.app-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--hairline);
}

.app-row:last-child {
  border-bottom: none;
}

.app-l {
  min-width: 0;
}

.app-title {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app-co {
  font-size: 11.5px;
  color: var(--faint);
  margin-top: 1px;
}

.app-r {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

.chip {
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.05em;
  border-radius: 4px;
  padding: 2px 6px;
  white-space: nowrap;
}

.chip.q {
  border: 1px solid var(--hairline);
  color: var(--faint);
}

.chip.ok {
  border: 1px solid var(--rise);
  color: var(--rise);
}

.chip.no {
  border: 1px solid var(--fall);
  color: var(--fall);
}

.ago {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--faint);
  white-space: nowrap;
}

.app-foot {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--hairline);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.app-foot .count {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--faint);
}

.app-foot .quiet {
  color: var(--quiet);
}

.stalled {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--quiet);
  border: 1px solid color-mix(in srgb, var(--quiet) 35%, transparent);
  border-radius: 4px;
  padding: 2px 7px;
  white-space: nowrap;
}

.app-foot a {
  font-size: 12px;
}
</style>
