<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Currency } from '../../domain/index.js'

const model = defineModel<Currency>({ required: true })

/**
 * A short list to start from — Hyperion has no opinion on which currencies exist, this
 * is purely so entering a BRL or EUR Position does not mean typing a symbol and a
 * precision by hand every time. "Custom" drops to the free-text fields underneath,
 * which is the only path for anything not listed.
 */
const PRESETS: (Currency & { label: string })[] = [
  { label: 'BRL — Real', code: 'BRL', symbol: 'R$', decimals: 2 },
  { label: 'EUR — Euro', code: 'EUR', symbol: '€', decimals: 2 },
  { label: 'USD — Dollar', code: 'USD', symbol: '$', decimals: 2 },
  { label: 'GBP — Pound', code: 'GBP', symbol: '£', decimals: 2 },
  { label: 'JPY — Yen', code: 'JPY', symbol: '¥', decimals: 0 },
]

const matchingPreset = PRESETS.find((preset) => preset.code === model.value.code)
const choice = ref<string>(matchingPreset ? matchingPreset.code : 'custom')

watch(choice, (code) => {
  const preset = PRESETS.find((row) => row.code === code)
  if (preset) model.value = { code: preset.code, symbol: preset.symbol, decimals: preset.decimals }
})
</script>

<template>
  <div class="currency">
    <select v-model="choice">
      <option v-for="preset in PRESETS" :key="preset.code" :value="preset.code">{{ preset.label }}</option>
      <option value="custom">Custom…</option>
    </select>
    <template v-if="choice === 'custom'">
      <input v-model="model.code" placeholder="Code (BRL)" maxlength="6" />
      <input v-model="model.symbol" placeholder="Symbol (R$)" maxlength="4" />
      <input
        :value="model.decimals"
        @input="model.decimals = Number(($event.target as HTMLInputElement).value)"
        type="number"
        min="0"
        max="6"
        placeholder="Decimals"
      />
    </template>
  </div>
</template>

<style scoped>
.currency {
  display: flex;
  gap: 8px;
}

select,
input {
  background: var(--page);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  padding: 7px 10px;
  color: var(--text);
  font-size: 13px;
  font-family: var(--sans);
}

input {
  width: 90px;
}
</style>
