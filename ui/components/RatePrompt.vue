<script setup lang="ts">
import { ref } from 'vue'
import { DomainError, mintId, toRate, type IsoDate } from '../../domain/index.js'
import { currentUserId, saveRecordedRate } from '../record.js'

/**
 * The one place Hyperion asks for an exchange rate: beside a comparison that cannot be
 * answered without it, naming the pair and the date it needs. Nothing here
 * fetches, suggests or defaults a rate — an empty field is the honest starting state,
 * and what goes in it is the User's own claim about a day.
 *
 * Answering it once is the end of it for that pair: the rate is remembered and every
 * later comparison across the same two currencies reads it (CONTEXT.md § Recorded Rate).
 */
const props = defineProps<{ fromCode: string; toCode: string; on: IsoDate }>()

const entered = ref('')
const busy = ref(false)
const error = ref('')

async function submit(): Promise<void> {
  error.value = ''
  if (!entered.value.trim()) {
    error.value = `What was 1 ${props.fromCode} worth in ${props.toCode}?`
    return
  }
  busy.value = true
  try {
    const rate = toRate(entered.value)
    await saveRecordedRate({
      id: mintId(),
      userId: currentUserId(),
      fromCode: props.fromCode,
      toCode: props.toCode,
      date: props.on,
      rateMinor: rate.minor,
      rateDecimals: rate.decimals,
    })
  } catch (cause) {
    error.value = cause instanceof DomainError ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="prompt">
    <p class="ask">
      Comparing {{ toCode }} against {{ fromCode }} needs a rate for {{ on }}. Hyperion
      fetches none — enter the one to use.
    </p>
    <form @submit.prevent="submit">
      <span class="eq">1 {{ fromCode }} =</span>
      <input v-model="entered" placeholder="5.4231" inputmode="decimal" :disabled="busy" />
      <span class="eq">{{ toCode }}</span>
      <button type="submit" :disabled="busy">Remember</button>
    </form>
    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<style scoped>
.prompt {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  padding: 12px 14px;
  background: var(--page);
}

.ask {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
  margin-bottom: 10px;
  max-width: 52ch;
}

form {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.eq {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--muted);
}

input {
  background: var(--page);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  padding: 6px 9px;
  color: var(--text);
  font-size: 13px;
  font-family: var(--mono);
  width: 100px;
}

button {
  background: var(--held);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  padding: 6px 12px;
  color: var(--text);
  font-size: 12.5px;
  font-family: var(--sans);
  cursor: pointer;
}

button:hover:not(:disabled) {
  color: var(--selene);
}

button:disabled {
  opacity: 0.5;
  cursor: default;
}

.error {
  color: var(--fall);
  font-size: 12px;
  margin-top: 8px;
}
</style>
