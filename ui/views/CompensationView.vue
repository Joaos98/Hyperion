<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
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
  perMonth,
  stayPremium,
  switchPremiums,
  type Payment,
  type Position,
  type Currency,
  type FoundRate,
  type RecordedRate,
  type StandingTerms,
  type User,
} from '../../domain/index.js'
import { record, saveUser, today } from '../record.js'
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
 * `User.compensationDisplay`, the same setting the Timeline, Positions and Position views
 * already read and write — one preference flipped from wherever it is being read, rather
 * than a control this chart owns privately and could disagree with them about.
 *
 * It applies to the line, which plots a rate a job pays. It deliberately does not apply to
 * the Payment marks: a bonus arrived once and is not a twelfth of anything.
 */
const period = computed(() => record.user?.compensationDisplay ?? 'annual')

async function setPeriod(value: 'annual' | 'monthly'): Promise<void> {
  if (!record.user || period.value === value) return
  await saveUser({ ...record.user, compensationDisplay: value })
}

const asShown = (annual: { minor: number; currency: Currency }) =>
  period.value === 'monthly' ? perMonth(annual) : annual

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
 * nowhere else in Hyperion knows which pair and which date a comparison needed.
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
 * below, not to a record of what each job paid. Time is shared across panels,
 * so a reader still sees when one currency gave way to the next.
 */
const CHART = {
  /*
   * The viewBox scales to whatever width the column gives it, so this number sets the
   * aspect ratio rather than a size: too narrow and the chart renders tall and its text
   * renders shrunk, since font sizes below are in these same units. 1080 against a panel
   * of 150 is roughly the proportion the section actually occupies now.
   */
  width: 1080,
  panelHeight: 150,
  /** Between stacked panels: enough for the next one's company and currency labels. */
  panelGap: 44,
  /** Below the last panel, before the year row — which needs far less than a panel does. */
  axisGap: 20,
  axisHeight: 22,
  topPad: 30,
  headroom: 1.12,
}

/**
 * A figure on the chart, at the precision a chart can carry: an annual salary's cents are
 * noise at this size, and carrying them costs three characters per label — which is most
 * of the difference between labels that fit and labels that collide. The exact amount is
 * never lost; it sits in the point's own tooltip, and every other view still shows it in
 * full.
 */
function chartAmount(money: { minor: number; currency: Currency }): string {
  const whole = Math.round(money.minor / Math.pow(10, money.currency.decimals))
  return `${money.currency.symbol}${String(whole).replace(/\B(?=(\d{3})+$)/g, ',')}`
}

/** What each kind of pay change is called where a reader sees it. */
const CHANGE_LABEL: Record<string, string> = {
  starting: 'Starting terms',
  raise: 'Raise',
  promotion: 'Promotion',
  cut: 'Reduction',
  level: 'Unchanged',
}

/**
 * Label widths are estimated to decide which ones fit, so the estimate has to track the
 * size actually in effect — the narrow-screen bump below makes labels wider in viewBox
 * units, and an estimate stuck at the wide-screen size let two of them collide again.
 * Tracked rather than assumed, so resizing the window re-lays the labels out.
 */
const NARROW = '(max-width: 1000px)'
const narrow = ref(false)
let watcher: MediaQueryList | undefined

function syncNarrow(): void {
  narrow.value = watcher?.matches ?? false
}

onMounted(() => {
  watcher = window.matchMedia(NARROW)
  syncNarrow()
  watcher.addEventListener('change', syncNarrow)
})

onUnmounted(() => watcher?.removeEventListener('change', syncNarrow))

/** IBM Plex Mono is about 0.61em per character at either size. */
const charWidth = computed(() => (narrow.value ? 13 : 10) * 0.61)

/**
 * Which points get to show their figure, and how each one is anchored.
 *
 * Two raises close together put their labels on top of one another — on a real record the
 * first two points collided by 32px and rendered as mush. A label is dropped rather than
 * shrunk or angled: the point, the step in the line and the tooltip all still carry it,
 * and an unreadable label communicates less than none. The newest figure always survives,
 * since it is the one a reader came for; where it would collide, the label before it goes
 * instead.
 *
 * Anchoring keeps the first and last labels inside the frame — centred on their point,
 * they would hang off both ends.
 */
function labelled<T extends { x: number; label: string }>(marks: T[], perChar: number) {
  const width = (mark: T) => mark.label.length * perChar
  const placed = marks.map((mark, index) => {
    const half = width(mark) / 2
    const anchor: 'start' | 'middle' | 'end' =
      mark.x - half < 0 ? 'start' : mark.x + half > CHART.width ? 'end' : 'middle'
    const left = anchor === 'start' ? mark.x : anchor === 'end' ? mark.x - width(mark) : mark.x - half
    return { ...mark, anchor, show: true, left, right: left + width(mark), last: index === marks.length - 1 }
  })

  let lastShown: (typeof placed)[number] | undefined
  for (const mark of placed) {
    if (!lastShown) {
      lastShown = mark
      continue
    }
    if (mark.left >= lastShown.right + 6) {
      lastShown = mark
      continue
    }
    // Collides. The newest figure wins its place; anything else yields to what came before.
    if (mark.last) {
      lastShown.show = false
      lastShown = mark
    } else {
      mark.show = false
    }
  }

  return placed
}

/**
 * Whatever the pointer (or the keyboard) is on. Held here rather than in a native
 * `<title>`, which waits a second, cannot be styled and cannot show the exact figure
 * beside the rounded one — the whole reason a point is worth hovering.
 */
interface Hovered {
  key: string
  x: number
  y: number
  detail: {
    date: string
    amount: string
    per: string
    change: string
    percent?: string
    rising: boolean
    role: string
    company: string
  }
}

const hovered = ref<Hovered | undefined>()

function show(mark: Hovered): void {
  hovered.value = mark
}

function hide(mark: Hovered): void {
  if (hovered.value?.key === mark.key) hovered.value = undefined
}

/**
 * Positioned in percentages of the frame rather than pixels: the SVG scales to its column,
 * so the only stable coordinates are the viewBox's own. Cards near the right edge hang off
 * it otherwise, so past two-thirds across they anchor by their right edge instead.
 */
function cardStyle(mark: Hovered, height: number) {
  const across = (mark.x + 16) / (CHART.width + 32)
  const flip = across > 0.66
  return {
    left: `${across * 100}%`,
    top: `${(mark.y / height) * 100}%`,
    transform: `translate(${flip ? '-100%' : '0'}, -100%) translate(${flip ? '-10px' : '10px'}, -10px)`,
  }
}

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

    // No marker where one currency gives way to the next: it lands on the same x as the
    // incoming job's own label and collided with it. The line beneath the chart already
    // names which figures were placed and at what rate, which is the part that has to be
    // said (CONTEXT.md § Converted).

    return {
      key: group.key + index,
      label: group.label,
      top,
      baseline: top + CHART.panelHeight,
      runs: group.lines.map((line) => {
        const at = (point: { money: { minor: number } }) => y(heightOf(line, point.money.minor))
        const steps = line.points.flatMap((point, index) =>
          index === 0
            ? [`M ${x(point.date)} ${at(point)}`]
            : [`L ${x(point.date)} ${at(line.points[index - 1]!)}`, `L ${x(point.date)} ${at(point)}`],
        )
        steps.push(`L ${x(line.endsAt)} ${at(line.points.at(-1)!)}`)

        // The same shape closed down to the zero line. The scale is not truncated — a
        // compensation record that started its axis at the lowest figure would make every
        // career look steeper than it was — so the space under the line is real, and
        // filling it reads as the level being held rather than as a void.
        const area = `${steps.join(' ')} L ${x(line.endsAt)} ${top + CHART.panelHeight} L ${x(line.points[0]!.date)} ${top + CHART.panelHeight} Z`

        return {
          id: line.position.id,
          company: line.position.company,
          current: !line.position.departure,
          path: steps.join(' '),
          area,
          labelX: x(line.points[0]!.date),
          marks: labelled(
            line.points.map((point) => ({
              key: point.terms.id,
              x: x(point.date),
              y: at(point),
              change: point.change,
              // Always the figure actually paid, in the currency it was paid in: the rate
              // moves where a point sits, never what it says.
              label: chartAmount(asShown(point.money)),
              detail: {
                date: point.date,
                // The chart's own labels are rounded to fit; hovering one is where the
                // exact figure lives, so this is the unrounded amount.
                amount: formatAmount(asShown(point.money)),
                per: period.value === 'monthly' ? 'a month' : 'a year',
                change: CHANGE_LABEL[point.change] ?? '',
                percent:
                  point.percent === undefined
                    ? undefined
                    : `${point.percent >= 0 ? '+' : ''}${point.percent.toFixed(1)}%`,
                rising: (point.percent ?? 0) >= 0,
                role: point.terms.title,
                company: line.position.company,
              },
            })),
            charWidth.value,
          ),
          // Payments sit on the baseline rather than on the line: a bonus that arrived once
          // is not a rate the job pays, and giving it a height on this scale would invite a
          // comparison against the salary above it that means nothing (CONTEXT.md § Payment
          // — treating the two alike is how a compensation history stops adding up).
          payments: (paymentsByPosition.value.get(line.position.id) ?? []).map((payment) => ({
            key: payment.id,
            x: x(payment.date),
            detail: {
              date: payment.date,
              // Never divided by twelve: this arrived once (CONTEXT.md § Payment).
              amount: formatAmount({ minor: payment.amountMinor, currency: line.position.currency }),
              per: 'once',
              change: payment.label,
              percent: undefined,
              rising: true,
              role: '',
              company: line.position.company,
            },
          })),
        }
      }),
    }
  })

  const height =
    CHART.topPad +
    panels.length * CHART.panelHeight +
    Math.max(0, panels.length - 1) * CHART.panelGap +
    CHART.axisGap +
    CHART.axisHeight
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

      <div class="section wide">
        <div class="section-h">
          <h3>What you were paid, as it changed</h3>
          <div class="period-toggle">
            <button type="button" :class="{ on: period === 'monthly' }" @click="setPeriod('monthly')">Monthly</button>
            <button type="button" :class="{ on: period === 'annual' }" @click="setPeriod('annual')">Annual</button>
          </div>
        </div>
        <div v-if="chart" class="plot">
        <svg class="chart" :viewBox="`-16 0 ${CHART.width + 32} ${chart.height}`" role="img">
          <g v-for="panel in chart.panels" :key="panel.key">
            <text class="cur-label" :x="CHART.width" :y="panel.top - 12">{{ panel.label }}</text>
            <line class="base" x1="0" :y1="panel.baseline" :x2="CHART.width" :y2="panel.baseline" />
            <g v-for="run in panel.runs" :key="run.id">
              <path class="area" :class="{ cur: run.current }" :d="run.area" />
              <path class="run" :class="{ cur: run.current }" :d="run.path" />
              <text class="company" :x="run.labelX" :y="panel.top - 12">{{ run.company }}</text>
              <g v-for="mark in run.marks" :key="mark.key">
                <circle class="pt" :class="mark.change" :cx="mark.x" :cy="mark.y" r="3.5" />
                <circle
                  class="hit"
                  :cx="mark.x"
                  :cy="mark.y"
                  r="13"
                  tabindex="0"
                  role="button"
                  :aria-label="`${mark.detail.date}, ${mark.detail.amount} ${mark.detail.per}, ${mark.detail.change}`"
                  @mouseenter="show(mark)"
                  @mouseleave="hide(mark)"
                  @focus="show(mark)"
                  @blur="hide(mark)"
                />
                <text
                  v-if="mark.show"
                  class="amt"
                  :class="mark.anchor"
                  :x="mark.x"
                  :y="mark.y - 10"
                >{{ mark.label }}</text>
              </g>
              <g v-for="payment in run.payments" :key="payment.key">
                <line class="pay" :x1="payment.x" :y1="panel.baseline - 5" :x2="payment.x" :y2="panel.baseline" />
                <rect
                  class="hit"
                  :x="payment.x - 9"
                  :y="panel.baseline - 16"
                  width="18"
                  height="22"
                  tabindex="0"
                  role="button"
                  :aria-label="`${payment.detail.date}, ${payment.detail.change}, ${payment.detail.amount}`"
                  @mouseenter="show({ key: payment.key, x: payment.x, y: panel.baseline - 8, detail: payment.detail })"
                  @mouseleave="hide({ key: payment.key, x: payment.x, y: panel.baseline - 8, detail: payment.detail })"
                  @focus="show({ key: payment.key, x: payment.x, y: panel.baseline - 8, detail: payment.detail })"
                  @blur="hide({ key: payment.key, x: payment.x, y: panel.baseline - 8, detail: payment.detail })"
                />
              </g>
            </g>
          </g>
          <g v-for="tick in chart.ticks" :key="tick.year">
            <text class="tick" :x="tick.x" :y="chart.axisY + 14">{{ tick.year }}</text>
          </g>
        </svg>

        <div v-if="hovered" class="card figures" :style="cardStyle(hovered, chart.height)">
          <div class="card-h">{{ hovered.detail.date }}</div>
          <div class="card-amt">
            {{ hovered.detail.amount }}<span class="per">{{ hovered.detail.per }}</span>
          </div>
          <div class="card-change">
            <span>{{ hovered.detail.change }}</span>
            <span v-if="hovered.detail.percent" :class="hovered.detail.rising ? 'up' : 'down'">
              {{ hovered.detail.percent }}
            </span>
          </div>
          <div class="card-role">
            <template v-if="hovered.detail.role">{{ hovered.detail.role }} · </template>{{ hovered.detail.company }}
          </div>
        </div>
        </div>
        <p v-else class="note">No Standing Terms recorded yet — there is nothing to draw until a Position has some.</p>

        <template v-if="chart && chart.conversions.length > 0">
          <p v-for="entry in chart.conversions" :key="entry.code" class="converted">
            Heights in {{ chart.into.code }}: {{ entry.code }} placed at
            {{ describeRate(entry.found.recorded) }}, {{ entry.found.recorded.date }}. Figures
            are unchanged.
          </p>
        </template>

        <div v-if="chart && chart.missing" class="unify">
          <p class="note">
            Two currencies, so a lane each. One rate joins them into a single
            shape<template v-if="awaitingRate > 0"> — the same rate the switch below needs</template>.
          </p>
          <RatePrompt
            :from-code="chart.missing.fromCode"
            :to-code="chart.missing.toCode"
            :on="chart.missing.on"
          />
        </div>
        <p class="note">
          Base plus target bonus<template v-if="period === 'monthly'">, a twelfth of the
          annual figure</template>, at every date it moved — years where nothing changed are
          not drawn. Each job is its own run.<template v-if="anyPayments"> Baseline ticks are
          Payments, held off the scale because a bonus is not a rate.</template> Hover a point
          for its exact figure.
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
/*
 * The measure belongs to the text, not to the column. 72ch is how wide a line of prose
 * should run before it gets hard to follow — the captions, the empty state, the lists of
 * figures — and the chart has no measure at all: it is a drawing, and capping it at a
 * reading width left it using barely half the page while the space beside it did nothing.
 */
.board {
  display: flex;
  flex-direction: column;
  gap: 30px;
}

.board > * {
  max-width: 72ch;
}

.board > .wide {
  max-width: none;
}

/* The drawing takes the width; the prose under it keeps its measure regardless. */
.board > .wide p {
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

.section-h {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.section-h h3 {
  margin-bottom: 0;
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

.plot {
  position: relative;
}

/* Sits above the drawing and never under the pointer, so moving toward it cannot make it flicker. */
.card {
  position: absolute;
  pointer-events: none;
  z-index: 2;
  white-space: nowrap;
  padding: 9px 11px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  background: var(--surface);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
  line-height: 1.4;
}

.card-h {
  font-size: 10.5px;
  color: var(--faint);
}

.card-amt {
  font-size: 15px;
  color: var(--text);
  letter-spacing: -0.01em;
  margin-top: 2px;
}

.card-amt .per {
  font-size: 10.5px;
  color: var(--faint);
  letter-spacing: 0;
  /* Vue trims the leading space out of the template, so the gap is set here instead. */
  margin-left: 5px;
}

.card-change {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 11px;
  color: var(--muted);
  margin-top: 5px;
}

.card-role {
  font-family: var(--sans);
  font-size: 11px;
  color: var(--faint);
  margin-top: 3px;
}

.chart .hit {
  fill: transparent;
  stroke: none;
  cursor: pointer;
  outline: none;
}

.chart .hit:focus-visible {
  stroke: var(--selene);
  stroke-width: 1.5;
}

.chart .base {
  stroke: var(--hairline);
  stroke-width: 1;
}

.chart .area {
  fill: #262b38;
  opacity: 0.55;
  stroke: none;
}

.chart .area.cur {
  fill: var(--selene);
  opacity: 0.1;
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
}

.chart .amt.middle {
  text-anchor: middle;
}

.chart .amt.start {
  text-anchor: start;
}

.chart .amt.end {
  text-anchor: end;
}

.chart .company {
  font-size: 10.5px;
  fill: var(--muted);
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

/*
 * Every size above is in viewBox units, so text shrinks with the frame: the same 10px
 * label renders at 10px in a full-width column and at 6px in a narrow one, which is past
 * reading. These bumps buy it back — coarse, because the scale is continuous and a media
 * query is not, but a legible approximation beats an illegible exact one.
 */
@media (max-width: 1000px) {
  .chart .amt {
    font-size: 13px;
  }

  .chart .company {
    font-size: 13.5px;
  }

  .chart .tick,
  .chart .cur-label {
    font-size: 12px;
  }
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
