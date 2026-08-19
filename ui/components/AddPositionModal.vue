<script setup lang="ts">
import { ref } from 'vue'
import { mintId, toMinor, type Currency, type EmploymentType } from '../../domain/index.js'
import { currentUserId, record, savePosition, saveStandingTerms, today } from '../record.js'
import CurrencyFields from './CurrencyFields.vue'

const emit = defineEmits<{ close: [] }>()

const company = ref('')
const currency = ref<Currency>({ code: 'BRL', symbol: 'R$', decimals: 2 })
const startDate = ref(today())
const title = ref('')
const employmentType = ref<EmploymentType>('clt')
const base = ref('')
const bonus = ref('0')
/** What `base` and `bonus` are typed as — Standing Terms itself is always stored annual. */
const period = ref<'monthly' | 'annual'>(record.user?.compensationDisplay ?? 'annual')
const busy = ref(false)
const error = ref('')

async function submit(): Promise<void> {
  error.value = ''
  if (!company.value.trim() || !title.value.trim()) {
    error.value = 'Company and title are both required.'
    return
  }
  let baseSalaryMinor: number
  let targetBonusMinor: number
  try {
    baseSalaryMinor = toMinor(base.value, currency.value)
    targetBonusMinor = toMinor(bonus.value || '0', currency.value)
    if (period.value === 'monthly') {
      baseSalaryMinor *= 12
      targetBonusMinor *= 12
    }
  } catch (cause) {
    error.value = String(cause instanceof Error ? cause.message : cause)
    return
  }

  busy.value = true
  try {
    const positionId = mintId()
    await savePosition({
      id: positionId,
      userId: currentUserId(),
      company: company.value.trim(),
      currency: currency.value,
      startDate: startDate.value,
      departure: null,
    })
    await saveStandingTerms({
      id: mintId(),
      positionId,
      effectiveDate: startDate.value,
      title: title.value.trim(),
      employmentType: employmentType.value,
      baseSalaryMinor,
      targetBonusMinor,
    })
    emit('close')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="dialog">
      <div class="dialog-h">
        <h3>New Position</h3>
        <button class="close" @click="emit('close')">&times;</button>
      </div>
      <p class="dialog-sub">This also records its Starting Terms — a Position with nothing yet to compute from is not much use on the timeline.</p>

      <form class="form" @submit.prevent="submit">
        <label>Company <input v-model="company" type="text" required /></label>
        <label>Start date <input v-model="startDate" type="date" required /></label>
        <label>Currency <CurrencyFields v-model="currency" /></label>
        <label>Title <input v-model="title" type="text" required /></label>
        <label>
          Employment type
          <select v-model="employmentType">
            <option value="clt">CLT</option>
            <option value="pj">PJ</option>
            <option value="contract">Contract</option>
            <option value="internship">Internship</option>
          </select>
        </label>
        <label>
          Base salary and target bonus, per
          <select v-model="period">
            <option value="monthly">month</option>
            <option value="annual">year</option>
          </select>
        </label>
        <label>Base salary <input v-model="base" type="text" inputmode="decimal" placeholder="e.g. 14500" required /></label>
        <label>Target bonus <input v-model="bonus" type="text" inputmode="decimal" placeholder="0" /></label>

        <p v-if="error" class="error">{{ error }}</p>

        <div class="actions">
          <button type="button" class="ghost" @click="emit('close')">Cancel</button>
          <button type="submit" class="primary" :disabled="busy">Save Position</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(9, 10, 13, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.dialog {
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-card);
  width: 440px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
  overflow-y: auto;
  padding: 24px 26px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
}

.dialog-h {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 6px;
}

.dialog-h h3 {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  letter-spacing: -0.01em;
}

.close {
  background: transparent;
  border: none;
  color: var(--faint);
  font-size: 18px;
  line-height: 1;
  padding: 0;
  cursor: pointer;
}

.dialog-sub {
  font-size: 12.5px;
  color: var(--faint);
  margin: 0 0 20px;
  line-height: 1.4;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12.5px;
  color: var(--muted);
}

.form input,
.form select {
  background: var(--page);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  padding: 9px 11px;
  color: var(--text);
  font-size: 13.5px;
  font-family: var(--sans);
}

.error {
  color: var(--fall);
  font-size: 12.5px;
  margin: 0;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 6px;
}

button.primary {
  background: var(--selene);
  color: var(--page);
  border: none;
  border-radius: var(--radius-control);
  padding: 8px 18px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

button.ghost {
  background: transparent;
  border: 1px solid var(--hairline);
  color: var(--muted);
  border-radius: var(--radius-control);
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
}
</style>
