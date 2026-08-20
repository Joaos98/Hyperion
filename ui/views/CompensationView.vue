<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import {
  averageStayPremiumPercent,
  averageSwitchPremiumPercent,
  compensationLines,
  convert,
  describeRate,
  displayCurrency,
  findRate,
  formatAmount,
  stayPremium,
  switchPremiums,
  type Payment,
  type Position,
  type FoundRate,
  type RecordedRate,
  type StandingTerms,
  type User,
} from '../../domain/index.js'
import { record, today } from '../record.js'
import RatePrompt from '../components/RatePrompt.vue'

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

const rates = computed(() => record.recordedRates as RecordedRate[])

/**
 * The units every comparison on this page resolves to (CONTEXT.md § Display Currency) —
 * this User's own setting, or the earliest Position's currency when they have not made
 * one. One currency for the whole screen: a chart drawn against one scale and a premium
 * measured in another would be two answers to the same question.
 */
const display = computed(() =>
  record.user ? displayCurrency(record.user as User, positions.value) : undefined,
)

const avgSwitch = computed(() =>
  display.value ? averageSwitchPremiumPercent(positions.value, termsByPosition.value, display.value, rates.value) : undefined,
)
const avgStay = computed(() => averageStayPremiumPercent(positions.value, termsByPosition.value))

/**
 * Every job change, newest first. A switch across a currency boundary is not dropped
 * from this list for want of a rate — it is exactly where the rate gets asked for, since
 * nowhere else in Hyperion knows which pair and which date a comparison needed
 * (plan § 8).
 */
const switches = computed(() =>
  display.value ? switchPremiums(positions.value, termsByPosition.value, display.value, rates.value).reverse() : [],
)

/** How many switches the average had to leave out, so the figure above it is not read as covering them. */
const awaitingRate = computed(() => switches.value.filter((entry) => entry.premium.kind === 'needs-rate').length)

/**
 * The chart's geometry, in one computed rather than scattered across the template: a
 * shared time axis, and one panel per currency the career was paid in.
 *
 * A panel per currency rather than one shared vertical scale, because two currencies have
 * no common height — R$300,000 drawn beside $120,000 would read as two-and-a-half times
 * something, and the rate that would make them comparable belongs to the comparisons
 * below, not to a record of what each job paid (plan § 8). Time is shared across panels,
 * so a reader still sees when one currency gave way to the next.
 */
const CHART = { width: 720, panelHeight: 108, panelGap: 44, axisHeight: 24, topPad: 30, headroom: 1.18 }

const chart = computed(() => {
  const into = display.value
  const lines = compensationLines(positions.value, termsByPosition.value, today())
  if (!into || lines.length === 0) return undefined

  const days = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000
  const firstYear = new Date(Math.min(...lines.map((line) => days(line.points[0]!.date))) * 86_400_000).getUTCFullYear()
  const lastYear = new Date(Math.max(...lines.map((line) => days(line.endsAt))) * 86_400_000).getUTCFullYear()
  const from = days(`${firstYear}-01-01`)
  const span = Math.max(1, days(`${lastYear + 1}-01-01`) - from)
  const x = (date: string) => ((days(date) - from) / span) * CHART.width

  /**
   * One rate per currency, never one per point. A rate looked up at each point's own date
   * would let the line's slope move because the currency moved, and a salary that never
   * changed would draw as a rise or a fall — the chart would stop being a record of pay.
   * A single factor rescales a whole currency's figures as a block, so the shape inside it
   * stays exactly what happened, and the rate is named on screen (CONTEXT.md § Converted).
   *
   * Anchored at the first date both currencies are on the record — the moment they meet,
   * which is also the date the Switch Premium across that boundary asks about. Anchoring
   * instead at each currency's own first date would have this view and the switches below
   * it asking for the same rate under two different dates.
   */
  const anchors = new Map<string, string>()
  for (const line of lines) {
    const code = line.position.currency.code
    const at = line.points[0]!.date
    if (!anchors.has(code) || at < anchors.get(code)!) anchors.set(code, at)
  }

  const factors = new Map<string, FoundRate>()
  let missing: { fromCode: string; toCode: string; on: string } | undefined
  for (const [code, first] of anchors) {
    if (code === into.code) continue
    const meets = anchors.get(into.code)
    const on = meets && meets > first ? meets : first
    const found = findRate(rates.value, code, into.code, on)
    if (found) factors.set(code, found)
    else missing ??= { fromCode: code, toCode: into.code, on }
  }

  // Every currency placeable on one scale: one shape, which is what this view is for.
  // Otherwise fall back to a lane per currency — honest, just not yet one line — and ask
  // for the one rate that would join them.
  const unified = !missing
  const heightOf = (line: (typeof lines)[number], minor: number) => {
    const code = line.position.currency.code
    if (!unified || code === into.code) return minor
    const found = factors.get(code)
    return found ? convert({ minor, currency: line.position.currency }, into, found.rate).minor : minor
  }

  const groups: { key: string; label: string; lines: typeof lines }[] = unified
    ? [{ key: into.code, label: into.code, lines }]
    : []
  if (!unified) {
    for (const line of lines) {
      const open = groups.at(-1)
      if (open && open.key === line.position.currency.code) open.lines.push(line)
      else groups.push({ key: line.position.currency.code, label: line.position.currency.code, lines: [line] })
    }
  }

  const panels = groups.map((group, index) => {
    const top = CHART.topPad + index * (CHART.panelHeight + CHART.panelGap)
    const ceiling =
      Math.max(...group.lines.flatMap((line) => line.points.map((point) => heightOf(line, point.money.minor)))) *
      CHART.headroom
    const y = (minor: number) => top + CHART.panelHeight - (minor / ceiling) * CHART.panelHeight

    // Where one currency gives way to the next, on a scale that now spans both.
    const crossings = unified
      ? group.lines
          .map((line, at) => ({ line, previous: group.lines[at - 1] }))
          .filter(({ line, previous }) => previous && previous.position.currency.code !== line.position.currency.code)
          .map(({ line, previous }) => ({
            key: line.position.id,
            x: x(line.points[0]!.date),
            label: `${previous!.position.currency.code} → ${line.position.currency.code}`,
          }))
      : []

    return {
      key: group.key + index,
      label: group.label,
      top,
      baseline: top + CHART.panelHeight,
      crossings,
      runs: group.lines.map((line) => {
        const at = (point: { money: { minor: number } }) => y(heightOf(line, point.money.minor))
        const steps = line.points.flatMap((point, index) =>
          index === 0
            ? [`M ${x(point.date)} ${at(point)}`]
            : [`L ${x(point.date)} ${at(line.points[index - 1]!)}`, `L ${x(point.date)} ${at(point)}`],
        )
        steps.push(`L ${x(line.endsAt)} ${at(line.points.at(-1)!)}`)

        return {
          id: line.position.id,
          company: line.position.company,
          current: !line.position.departure,
          path: steps.join(' '),
          labelX: x(line.points[0]!.date),
          marks: line.points.map((point) => ({
            key: point.terms.id,
            x: x(point.date),
            y: at(point),
            change: point.change,
            // Always the figure actually paid, in the currency it was paid in: the rate
            // moves where a point sits, never what it says.
            label: formatAmount(point.money),
            title: `${point.date} · ${formatAmount(point.money)}${
              point.percent === undefined ? '' : ` · ${point.percent >= 0 ? '+' : ''}${point.percent.toFixed(1)}%`
            } · ${point.terms.title}`,
          })),
          // Payments sit on the baseline rather than on the line: a bonus that arrived once
          // is not a rate the job pays, and giving it a height on this scale would invite a
          // comparison against the salary above it that means nothing (CONTEXT.md § Payment
          // — treating the two alike is how a compensation history stops adding up).
          payments: (paymentsByPosition.value.get(line.position.id) ?? []).map((payment) => ({
            key: payment.id,
            x: x(payment.date),
            title: `${payment.date} · ${payment.label} · ${formatAmount({ minor: payment.amountMinor, currency: line.position.currency })}`,
          })),
        }
      }),
    }
  })

  const height = CHART.topPad + panels.length * (CHART.panelHeight + CHART.panelGap) + CHART.axisHeight
  const every = Math.ceil((lastYear - firstYear + 1) / 12)
  const ticks: { year: number; x: number }[] = []
  for (let year = firstYear; year <= lastYear; year++) {
    if ((year - firstYear) % every === 0) ticks.push({ year, x: x(`${year}-01-01`) })
  }

  return {
    panels,
    ticks,
    height,
    axisY: height - CHART.axisHeight,
    into,
    unified,
    missing,
    // Keyed by the currency actually being placed, not by the rate's stored direction:
    // a rate entered as "1 EUR = 1.16 USD" answers both ways round (FoundRate.inverted),
    // so `recorded.fromCode` names whichever way it was typed rather than which figures
    // this factor moved.
    conversions: [...factors.entries()].map(([code, found]) => ({ code, found })),
  }
})

const anyPayments = computed(() => (record.payments as Payment[]).length > 0)


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
          <template v-else-if="awaitingRate > 0">
            <div class="suppressed">
              Waiting on a rate for {{ awaitingRate === 1 ? 'the switch' : 'every switch' }} below.
            </div>
          </template>
          <template v-else-if="positions.length >= 2 && switches.length === 0">
            <div class="suppressed">No job change yet — every Position here is one you still hold.</div>
          </template>
          <template v-else>
            <div class="suppressed">Switch Premium needs two Positions.</div>
          </template>
          <small>switch premium · avg</small>
          <p v-if="avgSwitch !== undefined && awaitingRate > 0" class="excluded">
            {{ awaitingRate }} {{ awaitingRate === 1 ? 'switch is' : 'switches are' }} not in this figure, below.
          </p>
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
        <h3>What you were paid, as it changed</h3>
        <svg v-if="chart" class="chart" :viewBox="`-16 0 752 ${chart.height}`" role="img">
          <g v-for="panel in chart.panels" :key="panel.key">
            <text class="cur-label" x="720" :y="panel.top - 12">{{ panel.label }}</text>
            <g v-for="crossing in panel.crossings" :key="crossing.key">
              <line class="crossing" :x1="crossing.x" :y1="panel.top - 6" :x2="crossing.x" :y2="panel.baseline" />
              <text class="crossing-label" :x="crossing.x" :y="panel.top - 14">{{ crossing.label }}</text>
            </g>
            <line class="base" x1="0" :y1="panel.baseline" x2="720" :y2="panel.baseline" />
            <g v-for="run in panel.runs" :key="run.id">
              <path class="run" :class="{ cur: run.current }" :d="run.path" />
              <text class="company" :x="run.labelX" :y="panel.top - 12">{{ run.company }}</text>
              <g v-for="mark in run.marks" :key="mark.key">
                <circle class="pt" :class="mark.change" :cx="mark.x" :cy="mark.y" r="3.5">
                  <title>{{ mark.title }}</title>
                </circle>
                <text class="amt" :x="mark.x" :y="mark.y - 9">{{ mark.label }}</text>
              </g>
              <line
                v-for="payment in run.payments"
                :key="payment.key"
                class="pay"
                :x1="payment.x"
                :y1="panel.baseline - 5"
                :x2="payment.x"
                :y2="panel.baseline"
              >
                <title>{{ payment.title }}</title>
              </line>
            </g>
          </g>
          <g v-for="tick in chart.ticks" :key="tick.year">
            <text class="tick" :x="tick.x" :y="chart.axisY + 14">{{ tick.year }}</text>
          </g>
        </svg>
        <p v-else class="note">No Standing Terms recorded yet — there is nothing to draw until a Position has some.</p>

        <template v-if="chart && chart.conversions.length > 0">
          <p v-for="entry in chart.conversions" :key="entry.code" class="converted">
            Heights in {{ chart.into.code }} — {{ entry.code }} figures placed at
            {{ describeRate(entry.found.recorded) }}, {{ entry.found.recorded.date }}. Every figure
            below is what was actually paid, in the currency it was paid in.
          </p>
        </template>

        <div v-if="chart && chart.missing" class="unify">
          <p class="note">
            This career crosses a currency, so it is drawn as one lane each rather than one
            shape. A rate joins them<template v-if="awaitingRate > 0"> — and it is the same rate the
            switch below needs</template>.
          </p>
          <RatePrompt
            :from-code="chart.missing.fromCode"
            :to-code="chart.missing.toCode"
            :on="chart.missing.on"
          />
        </div>
        <p class="note">
          Base plus target bonus, at every date it moved. A year in which nothing changed is
          not drawn, because it is the same figure restated. Each job is its own run: the
          stretch between two of them is an absence of compensation, not a compensation of
          zero.<template v-if="anyPayments"> Ticks on the baseline are Payments — money that
          arrived once, held off the scale because a bonus is not a rate the job pays.</template>
          No inflation adjustment<template v-if="!chart || chart.conversions.length === 0">, and no currency
          conversion</template>.
        </p>
      </div>

      <div v-if="switches.length > 0" class="section">
        <h3>What each switch paid</h3>
        <div v-for="entry in switches" :key="entry.to.id" class="switch">
          <div class="row">
            <div class="l">
              {{ entry.from.company }} → {{ entry.to.company }}
              <small>{{ entry.to.startDate }}</small>
            </div>
            <div class="r figures">
              <template v-if="entry.premium.kind === 'available'">
                <span :class="entry.premium.percent >= 0 ? 'up' : 'down'">
                  {{ entry.premium.percent >= 0 ? '+' : '' }}{{ entry.premium.percent.toFixed(1) }}%
                </span>
              </template>
              <span v-else-if="entry.premium.kind === 'needs-rate'" class="muted">needs a rate</span>
              <span v-else class="muted">—</span>
            </div>
          </div>
          <p v-if="entry.premium.kind === 'available' && entry.premium.conversions.length > 0" class="converted">
            Converted — {{ formatAmount(entry.premium.to) }} at
            <template v-for="(found, at) in entry.premium.conversions" :key="found.recorded.id"
              >{{ at > 0 ? ' and ' : '' }}{{ describeRate(found.recorded) }}, {{ found.recorded.date }}</template
            >.
          </p>
          <RatePrompt
            v-if="entry.premium.kind === 'needs-rate'"
            :from-code="entry.premium.fromCode"
            :to-code="entry.premium.toCode"
            :on="entry.premium.on"
          />
        </div>
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

.chart {
  width: 100%;
  height: auto;
  overflow: visible;
}

.chart .base {
  stroke: var(--hairline);
  stroke-width: 1;
}

.chart .run {
  fill: none;
  stroke: #3f4658;
  stroke-width: 2;
  stroke-linejoin: round;
}

.chart .run.cur {
  stroke: var(--selene);
}

.chart .pt {
  fill: var(--page);
  stroke: #3f4658;
  stroke-width: 2;
}

.chart .pt.promotion {
  fill: var(--selene);
  stroke: var(--selene);
}

.chart .pt.cut {
  fill: var(--fall);
  stroke: var(--fall);
}

.chart .pay {
  stroke: var(--muted);
  stroke-width: 2;
}

.chart text {
  font-family: var(--mono);
  fill: var(--faint);
}

.chart .amt {
  font-size: 10px;
  fill: var(--text);
  text-anchor: middle;
}

.chart .company {
  font-size: 10.5px;
  fill: var(--muted);
}

.chart .crossing {
  stroke: var(--selene-dim);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}

.chart .crossing-label {
  font-size: 9px;
  letter-spacing: 0.08em;
  fill: var(--selene);
  text-anchor: middle;
}

.chart .cur-label {
  font-size: 9.5px;
  letter-spacing: 0.08em;
  text-anchor: end;
}

.chart .tick {
  font-size: 9.5px;
  text-anchor: middle;
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

.excluded {
  font-size: 11px;
  color: var(--faint);
  margin-top: 6px;
  max-width: 26ch;
  line-height: 1.4;
}

.break {
  font-size: 11px;
  color: var(--faint);
  line-height: 1.4;
  margin: 12px 0 10px;
  padding-top: 10px;
  border-top: 1px solid var(--hairline);
  max-width: 52ch;
}

.switch {
  border-bottom: 1px solid var(--hairline);
  padding-bottom: 10px;
  margin-bottom: 4px;
}

.switch:last-child {
  border-bottom: none;
}

.switch .row {
  border-bottom: none;
}

.unify {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
}

.converted {
  font-size: 11.5px;
  color: var(--faint);
  font-family: var(--mono);
  padding-bottom: 8px;
}

.note {
  color: var(--faint);
  font-size: 12px;
  margin-top: 12px;
  line-height: 1.5;
}
</style>
