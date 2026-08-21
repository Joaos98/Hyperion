<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  formatAmount,
  isCurrent,
  perMonth,
  standingTermsHistory,
  tenure,
  totalOfTerms,
  type Position,
  type StandingTerms,
} from '../../domain/index.js'
import { record, saveUser, today } from '../record.js'
import AddPositionModal from '../components/AddPositionModal.vue'

const positions = computed(() => record.positions as Position[])

const termsByPosition = computed(() => {
  const map = new Map<string, StandingTerms[]>()
  for (const row of record.standingTerms as StandingTerms[]) map.set(row.positionId, [...(map.get(row.positionId) ?? []), row])
  return map
})

const current = computed(() => positions.value.filter(isCurrent).sort((a, b) => b.startDate.localeCompare(a.startDate)))
const past = computed(() => positions.value.filter((position) => !isCurrent(position)).sort((a, b) => b.startDate.localeCompare(a.startDate)))

function latestTerms(position: Position): StandingTerms | undefined {
  return standingTermsHistory(termsByPosition.value.get(position.id) ?? [])[0]
}

function tenureLabel(position: Position): string {
  const { years, months } = tenure(position, today())
  const parts = [years > 0 ? `${years}y` : undefined, `${months}m`].filter(Boolean)
  return parts.join(' ')
}

const MONTH_ABBREV = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthYear(date: string): string {
  return `${MONTH_ABBREV[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`
}

function rangeLabel(position: Position): string {
  const end = position.departure ? monthYear(position.departure.date) : 'present'
  return `${monthYear(position.startDate)} — ${end} · ${tenureLabel(position)}`
}

/** `User.compensationDisplay`, defended the same way `foldThresholdDays` already is. */
const period = computed(() => record.user?.compensationDisplay ?? 'annual')
const periodUnit = computed(() => (period.value === 'monthly' ? 'mo' : 'yr'))

async function setPeriod(value: 'annual' | 'monthly'): Promise<void> {
  if (!record.user || period.value === value) return
  await saveUser({ ...record.user, compensationDisplay: value })
}

/** The latest Standing Terms total for a Position, at whichever period the User chose. */
function figure(position: Position): string | undefined {
  const terms = latestTerms(position)
  if (!terms) return undefined
  const annual = totalOfTerms(terms, position.currency)
  return formatAmount(period.value === 'monthly' ? perMonth(annual) : annual)
}

const showAddModal = ref(false)
</script>

<template>
  <div class="board">
    <div class="page-h">
      <h1>Positions</h1>
      <div class="page-h-r">
        <div class="period-toggle">
          <button type="button" :class="{ on: period === 'monthly' }" @click="setPeriod('monthly')">Monthly</button>
          <button type="button" :class="{ on: period === 'annual' }" @click="setPeriod('annual')">Annual</button>
        </div>
        <button class="toggle" @click="showAddModal = true">+ Add Position</button>
      </div>
    </div>

    <div v-if="positions.length === 0" class="empty">
      <p><b>No Positions yet.</b></p>
      <p class="note">The Timeline, Compensation and your Achievement log all have nothing to show until one exists.</p>
    </div>

    <template v-else>
      <section v-if="current.length > 0">
        <h3>Current <span class="count">{{ current.length }}</span></h3>
        <RouterLink v-for="position in current" :key="position.id" :to="`/positions/${position.id}`" class="pos-row">
          <div class="pos-l">
            <div class="pos-title">{{ latestTerms(position)?.title ?? '(untitled)' }} <span class="pos-co">· {{ position.company }}</span></div>
            <div class="pos-range">{{ rangeLabel(position) }}</div>
          </div>
          <div class="pos-r">
            <span class="tick">NOW</span>
            <span v-if="figure(position)" class="pos-figure">{{ figure(position) }}<span class="u">/{{ periodUnit }}</span></span>
          </div>
        </RouterLink>
      </section>

      <section v-if="past.length > 0">
        <h3>Past <span class="count">{{ past.length }}</span></h3>
        <RouterLink v-for="position in past" :key="position.id" :to="`/positions/${position.id}`" class="pos-row past">
          <div class="pos-l">
            <div class="pos-title">{{ latestTerms(position)?.title ?? '(untitled)' }} <span class="pos-co">· {{ position.company }}</span></div>
            <div class="pos-range">{{ rangeLabel(position) }}</div>
          </div>
          <div class="pos-r">
            <span v-if="figure(position)" class="pos-figure">{{ figure(position) }}<span class="u">/{{ periodUnit }}</span></span>
          </div>
        </RouterLink>
      </section>
    </template>

    <AddPositionModal v-if="showAddModal" @close="showAddModal = false" />
  </div>
</template>

<style scoped>
.board {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 760px;
}

.page-h {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.page-h h1 {
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0;
}

.page-h-r {
  display: flex;
  align-items: center;
  gap: 14px;
}

.period-toggle {
  display: flex;
  gap: 4px;
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

.toggle {
  background: transparent;
  border: 1px dashed var(--hairline);
  border-radius: var(--radius-control);
  color: var(--muted);
  padding: 9px 14px;
  font-size: 13px;
  cursor: pointer;
}

.toggle:hover {
  color: var(--selene);
  border-color: var(--selene);
}

.empty {
  color: var(--muted);
  font-size: 13.5px;
}

.empty b {
  color: var(--text);
  font-weight: 600;
}

.empty .note {
  color: var(--faint);
  font-size: 12.5px;
  margin-top: 6px;
  max-width: 60ch;
}

section {
  margin-bottom: 28px;
}

h3 {
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 8px;
}

.count {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--faint);
}

.pos-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  padding: 13px 16px;
  margin-bottom: 8px;
  text-decoration: none;
  color: inherit;
}

.pos-row:hover {
  border-color: var(--selene);
}

.pos-row.past {
  opacity: 0.72;
}

.pos-title {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.pos-co {
  color: var(--muted);
  font-weight: 400;
}

.pos-range {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--faint);
  margin-top: 3px;
}

.pos-r {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
}

.tick {
  display: inline-block;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--selene);
  border: 1px solid var(--selene-dim);
  background: var(--selene-wash);
  border-radius: 4px;
  padding: 2px 6px;
  letter-spacing: 0.05em;
  font-weight: 500;
}

.pos-figure {
  font-family: var(--mono);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.pos-figure .u {
  font-size: 10.5px;
  color: var(--faint);
  margin-left: 3px;
}
</style>
