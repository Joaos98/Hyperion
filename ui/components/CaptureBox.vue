<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { daysSinceLastAchievement } from '../../domain/index.js'
import { logAchievement, record, today } from '../record.js'

/**
 * `positionId`, when given, is fixed — the Position detail page uses this to log (or
 * backfill) an Achievement against exactly that Position, past or current, rather than
 * guessing. Left unset, capture falls back to whichever Position has no Departure, which
 * is what the Timeline and Achievements views want.
 */
const props = withDefaults(defineProps<{ positionId?: string; showStaleness?: boolean }>(), {
  showStaleness: true,
})

const text = ref('')
const busy = ref(false)

const staleness = () => daysSinceLastAchievement(record.achievements, today())

/**
 * Every Achievement belongs to a Position now, so capture has nothing to attach to
 * until at least one exists. `undefined` here — never a silent fallback to some other
 * Position — is what the template below turns into the disabled state.
 */
const targetPositionId = computed(
  () => props.positionId ?? record.positions.find((position) => position.departure === null)?.id,
)

async function submit(): Promise<void> {
  const value = text.value.trim()
  const positionId = targetPositionId.value
  if (!value || !positionId || busy.value) return
  busy.value = true
  try {
    await logAchievement(value, positionId)
    text.value = ''
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="capture-block">
    <form v-if="targetPositionId" class="capture" @submit.prevent="submit">
      <input v-model="text" type="text" placeholder="What did you ship?" :disabled="busy" />
      <kbd>↵</kbd>
    </form>
    <p v-else class="capture disabled">
      Add a <RouterLink to="/positions">Position</RouterLink> first — an Achievement needs one to belong to.
    </p>

    <template v-if="showStaleness">
      <p v-if="staleness() === undefined" class="stale">Nothing logged yet.</p>
      <p v-else-if="(staleness() as number) > 0" class="stale">
        Last logged <b>{{ staleness() }}</b> day{{ (staleness() as number) === 1 ? '' : 's' }} ago
      </p>
      <p v-else class="stale">Logged today.</p>
    </template>
  </div>
</template>

<style scoped>
.capture {
  background: var(--page);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  padding: 11px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.capture.disabled {
  color: var(--faint);
  font-size: 13.5px;
  margin: 0;
}

.capture.disabled :deep(a) {
  color: var(--selene);
  text-decoration: underline;
}

.capture input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text);
  font-size: 14px;
  font-family: var(--sans);
}

.capture input::placeholder {
  color: var(--faint);
}

kbd {
  font-family: var(--mono);
  font-size: 11px;
  border: 1px solid var(--hairline);
  border-radius: 4px;
  padding: 1px 6px;
  color: var(--faint);
}

.stale {
  font-size: 12.5px;
  color: var(--muted);
  margin: 10px 0 0;
}

.stale b {
  color: var(--selene);
  font-weight: 500;
}
</style>
