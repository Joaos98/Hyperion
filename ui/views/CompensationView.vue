<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import {
  averageStayPremiumPercent,
  averageSwitchPremiumPercent,
  formatAmount,
  stayPremium,
  totalCompensationForYear,
  yearsCovered,
  type Payment,
  type Position,
  type StandingTerms,
} from '../../domain/index.js'
import { record, today } from '../record.js'

const positions = computed(() => [...(record.positions as Position[])].sort((a, b) => a.startDate.localeCompare(b.startDate)))

const termsByPosition = computed(() => {
  const map = new Map<string, StandingTerms[]>()
  for (const row of record.standingTerms as StandingTerms[]) map.set(row.positionId, [...(map.get(row.positionId) ?? []), row])
  return map
})
const paymentsByPosition = computed(() => {
  const map = new Map<string, Payment[]>()
  for (const row of record.payments as Payment[]) map.set(row.positionId, [...(map.get(row.positionId) ?? []), row])
  return map
})

const avgSwitch = computed(() => averageSwitchPremiumPercent(positions.value, termsByPosition.value))
const avgStay = computed(() => averageStayPremiumPercent(positions.value, termsByPosition.value))

/**
 * Total comp per year, most recent year first. When a job switch falls inside a single
 * year, both Positions technically "cover" it — but summing their independent year-end
 * figures would double-count the switch rather than reconstruct what was actually
 * earned. So a shared year is not blended: it takes the later Position's figure only,
 * the same rule `totalCompensationForYear` already applies to a mid-year promotion
 * within one Position, extended across the boundary between two.
 */
const yearly = computed(() => {
  const byYear = new Map<number, { minor: number; startDate: string }>()
  for (const position of positions.value) {
    const terms = termsByPosition.value.get(position.id) ?? []
    const payments = paymentsByPosition.value.get(position.id) ?? []
    for (const year of yearsCovered(position, terms, today())) {
      const figure = totalCompensationForYear(position, terms, payments, year, today())
      if (!figure) continue
      const existing = byYear.get(year)
      if (!existing || position.startDate > existing.startDate) {
        byYear.set(year, { minor: figure.minor, startDate: position.startDate })
      }
    }
  }
  const currency = positions.value[0]?.currency
  if (!currency) return []
  return [...byYear.entries()]
    .sort(([a], [b]) => b - a)
    .map(([year, { minor }]) => ({ year, minor, label: formatAmount({ minor, currency }) }))
})

const maxMinor = computed(() => Math.max(1, ...yearly.value.map((row) => row.minor)))
const currentYear = computed(() => new Date(today()).getUTCFullYear())

const perPosition = computed(() =>
  positions.value
    .map((position) => ({ position, stay: stayPremium(position, termsByPosition.value.get(position.id) ?? []) }))
    .reverse(),
)
</script>

<template>
  <div class="board">
    <div v-if="positions.length === 0" class="empty">
      <b>No Positions yet.</b>
      Compensation history has nothing to reconstruct until there is at least one.
    </div>

    <template v-else>
      <div class="stats">
        <div class="stat">
          <template v-if="avgSwitch !== undefined">
            <div class="figures" :class="avgSwitch >= 0 ? 'up' : 'down'">{{ avgSwitch >= 0 ? '+' : '' }}{{ avgSwitch.toFixed(1) }}%</div>
          </template>
          <template v-else>
            <div class="suppressed">Switch Premium needs two Positions.</div>
          </template>
          <small>switch premium · avg</small>
        </div>
        <div class="stat">
          <template v-if="avgStay !== undefined">
            <div class="figures" :class="avgStay >= 0 ? 'up' : 'down'">{{ avgStay >= 0 ? '+' : '' }}{{ avgStay.toFixed(1) }}%</div>
          </template>
          <template v-else>
            <div class="suppressed">Stay Premium needs a second Standing Terms.</div>
          </template>
          <small>stay premium · avg/yr</small>
        </div>
      </div>

      <div class="section">
        <h3>Total compensation by year</h3>
        <div v-for="row in yearly" :key="row.year" class="bar" :class="{ cur: row.year === currentYear }">
          <span class="y">{{ row.year }}</span>
          <span class="t"><i :style="{ width: (row.minor / maxMinor) * 100 + '%' }"></i></span>
          <span class="n figures">{{ row.label }}</span>
        </div>
        <p class="note">
          Base plus target bonus plus bonuses actually paid, at the Standing Terms in force
          when each year ended. No inflation adjustment and no currency conversion — a figure
          from 2021 and one from today are shown as what they were, not as what they are worth
          now.
        </p>
      </div>

      <div class="section">
        <h3>By Position</h3>
        <RouterLink v-for="entry in perPosition" :key="entry.position.id" :to="`/positions/${entry.position.id}`" class="row">
          <div class="l">
            {{ entry.position.company }}
            <small>{{ entry.position.startDate }} — {{ entry.position.departure?.date ?? 'present' }}</small>
          </div>
          <div class="r figures">
            <template v-if="entry.stay.kind === 'available'">
              <span :class="entry.stay.percent >= 0 ? 'up' : 'down'">
                {{ entry.stay.percent >= 0 ? '+' : '' }}{{ entry.stay.percent.toFixed(1) }}%/yr
              </span>
            </template>
            <span v-else class="muted">—</span>
          </div>
        </RouterLink>
      </div>
    </template>
  </div>
</template>

<style scoped>
.board {
  display: flex;
  flex-direction: column;
  gap: 30px;
  max-width: 72ch;
}

.empty {
  color: var(--muted);
  font-size: 13.5px;
  line-height: 1.6;
}

.empty b {
  display: block;
  color: var(--text);
  font-weight: 600;
  margin-bottom: 4px;
}

.stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}

.stat .figures {
  font-size: 24px;
  letter-spacing: -0.015em;
}

.stat small {
  display: block;
  font-size: 10.5px;
  color: var(--faint);
  letter-spacing: 0.07em;
  text-transform: uppercase;
  margin-top: 4px;
}

.suppressed {
  font-size: 12px;
  color: var(--faint);
  max-width: 22ch;
  line-height: 1.4;
}

.section h3 {
  font-size: 13px;
  margin-bottom: 14px;
  color: var(--muted);
}

.bar {
  display: grid;
  grid-template-columns: 46px 1fr 130px;
  gap: 12px;
  align-items: center;
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--muted);
  padding: 5px 0;
}

.bar .t {
  height: 9px;
  border-radius: 2px;
  background: var(--held);
  position: relative;
  display: block;
}

.bar .t i {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 2px;
  background: #3f4658;
  display: block;
}

.bar.cur .t i {
  background: var(--selene);
}

.bar.cur .y {
  color: var(--selene);
}

.bar .n {
  text-align: right;
  color: var(--text);
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid var(--hairline);
  font-size: 13.5px;
  text-decoration: none;
  color: inherit;
}

.row:last-child {
  border-bottom: none;
}

.row:hover .l {
  color: var(--selene);
}

.row .l small {
  display: block;
  color: var(--faint);
  font-size: 11px;
  margin-top: 2px;
}

.row .muted {
  color: var(--faint);
}

.note {
  color: var(--faint);
  font-size: 12px;
  margin-top: 12px;
  line-height: 1.5;
}
</style>
