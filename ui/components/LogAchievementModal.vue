<script setup lang="ts">
import { computed, ref } from 'vue'
import { standingTermsHistory, type Position, type PositionId, type StandingTerms } from '../../domain/index.js'
import { logAchievement, record, today } from '../record.js'

/** Which Position the form opens against — the Position detail page pins this; the sidebar card leaves it unset. */
const props = defineProps<{ defaultPositionId?: PositionId }>()
const emit = defineEmits<{ close: [] }>()

const termsByPosition = computed(() => {
  const map = new Map<string, StandingTerms[]>()
  for (const row of record.standingTerms as StandingTerms[]) map.set(row.positionId, [...(map.get(row.positionId) ?? []), row])
  return map
})

/** Every Position, latest-started first — past ones stay pickable, so backfilling against a job you have left still works. */
const positions = computed(() => [...(record.positions as Position[])].sort((a, b) => b.startDate.localeCompare(a.startDate)))

function titleOf(position: Position): string {
  const history = standingTermsHistory(termsByPosition.value.get(position.id) ?? [])
  return history[0]?.title ?? position.company
}

const positionId = ref(props.defaultPositionId ?? positions.value[0]?.id ?? '')
const date = ref(today())
const text = ref('')
const impact = ref('')
const busy = ref(false)
const error = ref('')

async function submit(): Promise<void> {
  error.value = ''
  const value = text.value.trim()
  if (!positionId.value) {
    error.value = 'Choose a Position first.'
    return
  }
  if (!value) {
    error.value = 'What did you ship?'
    return
  }
  busy.value = true
  try {
    await logAchievement(value, positionId.value, date.value, impact.value.trim() || null)
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
        <h3>Log an achievement</h3>
        <button class="close" @click="emit('close')">&times;</button>
      </div>
      <p class="dialog-sub">One entry, whenever something is worth remembering later.</p>

      <form class="form" @submit.prevent="submit">
        <div class="row2">
          <label>
            Position
            <select v-model="positionId">
              <option v-for="position in positions" :key="position.id" :value="position.id">
                {{ titleOf(position) }} · {{ position.company }}
              </option>
            </select>
          </label>
          <label>
            Date
            <input v-model="date" type="date" :max="today()" required />
          </label>
        </div>

        <label>
          What did you ship?
          <textarea
            v-model="text"
            placeholder="One line is enough — the specifics come later if you need them."
          ></textarea>
        </label>

        <label>
          Impact <span class="opt">— optional</span>
          <input v-model="impact" type="text" placeholder="e.g., cut the nightly run from 90 minutes to under 6" />
        </label>

        <p v-if="error" class="error">{{ error }}</p>

        <div class="actions">
          <button type="button" class="ghost" @click="emit('close')">Cancel</button>
          <button type="submit" class="primary" :disabled="busy">Save</button>
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
  min-width: 0;
}

.form input,
.form select,
.form textarea {
  background: var(--page);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  padding: 9px 11px;
  color: var(--text);
  font-size: 13.5px;
  font-family: var(--sans);
  /* A date input carries an intrinsic width of its own — wider than the track it sits in
     — and a grid item defaults to min-width: auto, so it refused to shrink and spilled out
     past the dialog's right edge. These two let the control take the width it is given. */
  min-width: 0;
  width: 100%;
}

.form textarea {
  resize: vertical;
  min-height: 64px;
  line-height: 1.5;
}

.row2 {
  display: grid;
  grid-template-columns: 1fr 150px;
  gap: 12px;
}

.opt {
  color: var(--faint);
  font-weight: 400;
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
