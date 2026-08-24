<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  formatAmount,
  isCurrent,
  mintId,
  newestFirst,
  perMonth,
  plainAmount,
  standingTermsHistory,
  tenure,
  toMinor,
  type Achievement,
  type EmploymentType,
  type Payment,
  type StandingTerms,
} from '../../domain/index.js'
import {
  deleteAchievement,
  deletePayment,
  deleteStandingTerms,
  record,
  savePayment,
  savePosition,
  saveStandingTerms,
  saveUser,
  today,
} from '../record.js'
import LogAchievementModal from '../components/LogAchievementModal.vue'

const props = defineProps<{ id: string }>()

/**
 * Capture is the same modal everywhere now (plan § Conventions). Pinned to this Position,
 * so its chooser opens on the one being looked at — backfilling a past Position from its
 * own page is the case this view exists for.
 */
const showLogModal = ref(false)

const position = computed(() => record.positions.find((row) => row.id === props.id))
const terms = computed(() =>
  standingTermsHistory((record.standingTerms as StandingTerms[]).filter((row) => row.positionId === props.id)),
)
const payments = computed(() =>
  [...(record.payments as Payment[])]
    .filter((row) => row.positionId === props.id)
    .sort((a, b) => b.date.localeCompare(a.date)),
)
const achievements = computed(() =>
  newestFirst((record.achievements as Achievement[]).filter((row) => row.positionId === props.id)),
)

const tenureLabel = computed(() => {
  if (!position.value) return ''
  const { years, months } = tenure(position.value, today())
  return [years > 0 ? `${years}y` : undefined, `${months}m`].filter(Boolean).join(' ')
})

function fmt(minor: number): string {
  if (!position.value) return ''
  return formatAmount({ minor, currency: position.value.currency })
}

/** `User.compensationDisplay`, defended the same way `foldThresholdDays` already is. */
const period = computed(() => record.user?.compensationDisplay ?? 'annual')
const periodUnit = computed(() => (period.value === 'monthly' ? 'mo' : 'yr'))

async function setPeriod(value: 'annual' | 'monthly'): Promise<void> {
  if (!record.user || period.value === value) return
  await saveUser({ ...record.user, compensationDisplay: value })
}

/** A Standing Terms total — never a Payment, which is a one-off and stays at `fmt`. */
function fmtTerms(minor: number): string {
  if (!position.value) return ''
  const annual = { minor, currency: position.value.currency }
  return formatAmount(period.value === 'monthly' ? perMonth(annual) : annual)
}

// ── add Standing Terms ──────────────────────────────────────────────────
// Opening the form pre-fills every field from what is currently in force, rather than
// leaving money fields blank: blank invites the mistake of a target bonus silently
// defaulting to 0 because nobody touched it. Editing an existing figure in place is both
// safer and no more typing than a blank field for the usual case — one or two digits
// changed on a number that is otherwise already right.
const termsOpen = ref(false)
const termsDate = ref(today())
const termsTitle = ref('')
const termsType = ref<EmploymentType>('clt')
const termsBase = ref('')
const termsBonus = ref('0')
/** What `termsBase` and `termsBonus` are typed as — Standing Terms itself is always stored annual. */
const termsPeriod = ref<'monthly' | 'annual'>('annual')
const termsError = ref('')

function openTermsForm(): void {
  termsPeriod.value = record.user?.compensationDisplay ?? 'annual'
  const current = terms.value[0]
  if (current && position.value) {
    const toEntered = (minor: number): string => {
      const annual = { minor, currency: position.value!.currency }
      return plainAmount(termsPeriod.value === 'monthly' ? perMonth(annual) : annual)
    }
    termsTitle.value = current.title
    termsType.value = current.employmentType
    termsBase.value = toEntered(current.baseSalaryMinor)
    termsBonus.value = toEntered(current.targetBonusMinor)
  }
  termsDate.value = today()
  termsOpen.value = true
}

async function submitTerms(): Promise<void> {
  termsError.value = ''
  if (!position.value) return
  if (!termsTitle.value.trim()) {
    termsError.value = 'A title is required.'
    return
  }
  let baseSalaryMinor: number
  let targetBonusMinor: number
  try {
    baseSalaryMinor = toMinor(termsBase.value, position.value.currency)
    targetBonusMinor = toMinor(termsBonus.value || '0', position.value.currency)
    if (termsPeriod.value === 'monthly') {
      baseSalaryMinor *= 12
      targetBonusMinor *= 12
    }
  } catch (cause) {
    termsError.value = String(cause instanceof Error ? cause.message : cause)
    return
  }
  await saveStandingTerms({
    id: mintId(),
    positionId: position.value.id,
    effectiveDate: termsDate.value,
    title: termsTitle.value.trim(),
    employmentType: termsType.value,
    baseSalaryMinor,
    targetBonusMinor,
  })
  termsTitle.value = ''
  termsBase.value = ''
  termsBonus.value = '0'
  termsOpen.value = false
}

// ── add Payment ──────────────────────────────────────────────────────────
const paymentOpen = ref(false)
const paymentDate = ref(today())
const paymentLabel = ref('Annual bonus')
const paymentAmount = ref('')
const paymentError = ref('')

async function submitPayment(): Promise<void> {
  paymentError.value = ''
  if (!position.value) return
  let amountMinor: number
  try {
    amountMinor = toMinor(paymentAmount.value, position.value.currency)
  } catch (cause) {
    paymentError.value = String(cause instanceof Error ? cause.message : cause)
    return
  }
  await savePayment({
    id: mintId(),
    positionId: position.value.id,
    date: paymentDate.value,
    amountMinor,
    label: paymentLabel.value.trim() || 'Payment',
  })
  paymentAmount.value = ''
  paymentOpen.value = false
}

// ── end this Position ───────────────────────────────────────────────────
const departureOpen = ref(false)
const departureDate = ref(today())
const departureReason = ref('resigned')

async function submitDeparture(): Promise<void> {
  if (!position.value) return
  await savePosition({ ...position.value, departure: { date: departureDate.value, reason: departureReason.value.trim() || 'resigned' } })
  departureOpen.value = false
}

async function reopen(): Promise<void> {
  if (!position.value) return
  await savePosition({ ...position.value, departure: null })
}
</script>

<template>
  <div v-if="!position" class="empty">No Position at this id.</div>

  <div v-else class="panel">
    <div class="head">
      <div>
        <h2>{{ terms[0]?.title ?? '(untitled)' }} <span class="co">· {{ position.company }}</span></h2>
        <div class="meta">
          {{ position.startDate }} — {{ position.departure?.date ?? 'present' }} · {{ tenureLabel }} ·
          {{ position.currency.code }}
          <template v-if="position.departure"> · ended, {{ position.departure.reason }}</template>
        </div>
      </div>
      <div class="head-actions">
        <span v-if="isCurrent(position)" class="chip now">CURRENT</span>
        <button v-else class="btn" @click="reopen">Reopen</button>
        <button v-if="isCurrent(position)" class="btn end" @click="departureOpen = !departureOpen">End this Position</button>
      </div>
    </div>

    <!-- always reachable from the header, regardless of how long the history below gets -->
    <form v-if="departureOpen" class="inline-form departure-form" @submit.prevent="submitDeparture">
      <label>Date <input v-model="departureDate" type="date" required /></label>
      <label>Reason <input v-model="departureReason" type="text" placeholder="resigned, laid off, contract ended…" /></label>
      <div class="actions">
        <button type="submit" class="primary">End Position</button>
        <button type="button" class="ghost" @click="departureOpen = false">Cancel</button>
      </div>
    </form>

    <div class="cols">
      <div>
        <div class="section-h">
          <h3>Standing terms <span class="count">{{ terms.length }}</span></h3>
          <div class="period-toggle">
            <button type="button" :class="{ on: period === 'monthly' }" @click="setPeriod('monthly')">Monthly</button>
            <button type="button" :class="{ on: period === 'annual' }" @click="setPeriod('annual')">Annual</button>
          </div>
        </div>

        <div v-if="!termsOpen" class="row-actions">
          <button class="toggle" @click="openTermsForm">+ Add Standing Terms</button>
        </div>
        <form v-else class="inline-form" @submit.prevent="submitTerms">
          <p v-if="terms[0]" class="hint">Pre-filled from what's currently in force — edit only what changed.</p>
          <label>Effective date <input v-model="termsDate" type="date" required /></label>
          <label>Title <input v-model="termsTitle" type="text" required /></label>
          <label>
            Employment type
            <select v-model="termsType">
              <option value="clt">CLT</option>
              <option value="pj">PJ</option>
              <option value="contract">Contract</option>
              <option value="internship">Internship</option>
            </select>
          </label>
          <label>
            Base salary and target bonus, per
            <select v-model="termsPeriod">
              <option value="monthly">month</option>
              <option value="annual">year</option>
            </select>
          </label>
          <label>Base salary <input v-model="termsBase" type="text" inputmode="decimal" required /></label>
          <label>Target bonus <input v-model="termsBonus" type="text" inputmode="decimal" /></label>
          <p v-if="termsError" class="error">{{ termsError }}</p>
          <div class="actions">
            <button type="submit" class="primary">Save</button>
            <button type="button" class="ghost" @click="termsOpen = false">Cancel</button>
          </div>
        </form>

        <div v-for="(row, i) in terms" :key="row.id" class="line" :class="{ dim: i > 0 }">
          <div class="l">
            {{ row.title }}
            <small>{{ row.effectiveDate }} · {{ row.employmentType.toUpperCase() }}</small>
          </div>
          <div class="r figures">
            {{ fmtTerms(row.baseSalaryMinor + row.targetBonusMinor) }}<small class="unit">/{{ periodUnit }}</small>
            <button class="remove" title="Remove" @click="deleteStandingTerms(row.id)">×</button>
          </div>
        </div>
      </div>

      <div>
        <h3>Payments <span class="count">{{ payments.length }}</span></h3>

        <div v-if="!paymentOpen" class="row-actions">
          <button class="toggle" @click="paymentOpen = true">+ Add Payment</button>
        </div>
        <form v-else class="inline-form" @submit.prevent="submitPayment">
          <label>Date <input v-model="paymentDate" type="date" required /></label>
          <label>Label <input v-model="paymentLabel" type="text" required /></label>
          <label>Amount <input v-model="paymentAmount" type="text" inputmode="decimal" required /></label>
          <p v-if="paymentError" class="error">{{ paymentError }}</p>
          <div class="actions">
            <button type="submit" class="primary">Save</button>
            <button type="button" class="ghost" @click="paymentOpen = false">Cancel</button>
          </div>
        </form>

        <p v-if="payments.length === 0" class="none">None recorded.</p>
        <div v-for="row in payments" :key="row.id" class="line">
          <div class="l">{{ row.label }}<small>{{ row.date }}</small></div>
          <div class="r figures">
            {{ fmt(row.amountMinor) }}
            <button class="remove" title="Remove" @click="deletePayment(row.id)">×</button>
          </div>
        </div>
      </div>

      <div>
        <h3>Achievements here <span class="count">{{ achievements.length }}</span></h3>

        <div class="row-actions">
          <button class="toggle" @click="showLogModal = true">+ Log achievement</button>
        </div>
        <p v-if="achievements.length === 0" class="none">Nothing logged for this Position yet.</p>
        <div v-for="row in achievements" :key="row.id" class="entry">
          <p class="prose">{{ row.text }}</p>
          <div class="meta">
            {{ row.date }}<template v-if="row.impact"> · {{ row.impact }}</template>
            <button class="remove" title="Remove" @click="deleteAchievement(row.id)">×</button>
          </div>
        </div>
      </div>
    </div>

    <LogAchievementModal v-if="showLogModal" :default-position-id="position.id" @close="showLogModal = false" />
  </div>
</template>

<style scoped>
.empty {
  color: var(--muted);
  font-size: 13.5px;
}

.panel {
  max-width: 1180px;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 24px;
  gap: 10px;
}

h2 {
  font-size: 18px;
}

.co {
  color: var(--muted);
  font-weight: 400;
}

.meta {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--faint);
  margin-top: 5px;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.chip.now {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.05em;
  background: var(--selene);
  color: var(--page);
  border-radius: 4px;
  padding: 2px 7px;
  font-weight: 500;
  white-space: nowrap;
}

.btn {
  background: transparent;
  border: 1px solid var(--hairline);
  color: var(--muted);
  border-radius: var(--radius-control);
  padding: 6px 13px;
  font-size: 12px;
  font-family: var(--sans);
  cursor: pointer;
  white-space: nowrap;
}

.btn:hover {
  color: var(--selene);
  border-color: var(--selene);
}

/* Ending a Position is a departure, the same event the Timeline itself marks in --fall
   (design/compression.html § the rule) — reusing that jurisdiction here rather than
   inventing a second meaning for the colour. */
.btn.end:hover {
  color: var(--fall);
  border-color: var(--fall);
}

.cols {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 28px;
}

h3 {
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 10px;
}

.section-h {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
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
  font-size: 10px;
  padding: 2px 8px;
  cursor: pointer;
}

.period-toggle button.on {
  color: var(--selene);
  border-color: var(--selene);
  background: var(--selene-wash);
}

.count {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--faint);
}

.line {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid var(--hairline);
  font-size: 13px;
}

.line.dim {
  color: var(--faint);
}

.line .l small {
  display: block;
  color: var(--faint);
  font-size: 10.5px;
  margin-top: 2px;
}

.line .r {
  display: flex;
  align-items: center;
  gap: 8px;
}

.none {
  color: var(--faint);
  font-size: 12.5px;
}

.unit {
  color: var(--faint);
  font-weight: 400;
}

.entry {
  padding: 12px 0;
  border-bottom: 1px solid var(--hairline);
}

.entry .prose {
  font-size: 13.5px;
  margin: 0;
}

.entry .meta {
  margin-top: 5px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.remove {
  background: transparent;
  border: none;
  color: var(--faint);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
}

.remove:hover {
  color: var(--fall);
}

.row-actions {
  margin-bottom: 14px;
}

.toggle {
  background: transparent;
  border: 1px dashed var(--hairline);
  border-radius: var(--radius-control);
  color: var(--muted);
  padding: 7px 12px;
  font-size: 12px;
  cursor: pointer;
}

.toggle:hover {
  color: var(--selene);
  border-color: var(--selene);
}

.inline-form {
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  padding: 14px 16px;
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.departure-form {
  max-width: 420px;
  margin-bottom: 24px;
}

.hint {
  color: var(--faint);
  font-size: 11.5px;
  margin: -2px 0 2px;
  line-height: 1.4;
}

.inline-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}

.inline-form input,
.inline-form select {
  background: var(--page);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  padding: 7px 9px;
  color: var(--text);
  font-size: 13px;
  font-family: var(--sans);
}

.error {
  color: var(--fall);
  font-size: 12px;
}

.actions {
  display: flex;
  gap: 8px;
}

button.primary {
  background: var(--selene);
  color: var(--page);
  border: none;
  border-radius: var(--radius-control);
  padding: 7px 14px;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
}

button.ghost {
  background: transparent;
  border: 1px solid var(--hairline);
  color: var(--muted);
  border-radius: var(--radius-control);
  padding: 7px 14px;
  font-size: 12.5px;
  cursor: pointer;
}
</style>
