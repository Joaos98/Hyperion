<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { isOpen, mintId, status, type Application, type ApplicationEvent, type Stage } from '../../domain/index.js'
import { record, saveApplication, saveApplicationEvent, today } from '../record.js'

const eventsByApplication = computed(() => {
  const map = new Map<string, ApplicationEvent[]>()
  for (const event of record.applicationEvents as ApplicationEvent[]) {
    map.set(event.applicationId, [...(map.get(event.applicationId) ?? []), event])
  }
  return map
})

function statusOf(application: Application): Stage | undefined {
  return status(eventsByApplication.value.get(application.id) ?? [])
}

const open = computed(() =>
  (record.applications as Application[])
    .filter((application) => isOpen(eventsByApplication.value.get(application.id) ?? []))
    .sort((a, b) => latestDate(b) - latestDate(a)),
)
const closed = computed(() =>
  (record.applications as Application[])
    .filter((application) => !isOpen(eventsByApplication.value.get(application.id) ?? []))
    .sort((a, b) => latestDate(b) - latestDate(a)),
)

function latestDate(application: Application): number {
  const events = eventsByApplication.value.get(application.id) ?? []
  const dates = events.map((event) => Date.parse(event.date))
  return dates.length === 0 ? 0 : Math.max(...dates)
}

function daysAgo(application: Application): number | undefined {
  const events = eventsByApplication.value.get(application.id) ?? []
  if (events.length === 0) return undefined
  const latest = Math.max(...events.map((event) => Date.parse(event.date)))
  return Math.round((Date.parse(today()) - latest) / 86_400_000)
}

function chipClass(stage: Stage | undefined): string {
  if (stage === 'landed') return 'ok'
  if (stage === 'rejected' || stage === 'withdrawn') return 'no'
  return 'q'
}

// ── add an Application ───────────────────────────────────────────────────
const formOpen = ref(false)
const company = ref('')
const title = ref('')
const source = ref('')
const postingUrl = ref('')
const initialStage = ref<Stage>('saved')
const initialDate = ref(today())
const documentId = ref('')
const error = ref('')

async function submit(): Promise<void> {
  error.value = ''
  if (!company.value.trim() || !title.value.trim()) {
    error.value = 'Company and title are both required.'
    return
  }
  const application: Application = {
    id: mintId(),
    userId: 'local',
    company: company.value.trim(),
    title: title.value.trim(),
    source: source.value.trim() || 'Direct',
    postingUrl: postingUrl.value.trim() || null,
    advertisedRange: null,
    offeredTerms: null,
    documentId: documentId.value || null,
    priorApplicationId: null,
  }
  await saveApplication(application)
  await saveApplicationEvent({
    id: mintId(),
    applicationId: application.id,
    stage: initialStage.value,
    date: initialDate.value,
    note: null,
  })
  company.value = ''
  title.value = ''
  source.value = ''
  postingUrl.value = ''
  initialStage.value = 'saved'
  initialDate.value = today()
  documentId.value = ''
  formOpen.value = false
}
</script>

<template>
  <div class="board">
    <button v-if="!formOpen" class="toggle" @click="formOpen = true">+ Add Application</button>
    <form v-else class="form" @submit.prevent="submit">
      <label>Company <input v-model="company" type="text" required /></label>
      <label>Title <input v-model="title" type="text" required /></label>
      <label>Source <input v-model="source" type="text" placeholder="Referral, job board, recruiter…" /></label>
      <label>Posting URL <input v-model="postingUrl" type="text" placeholder="optional" /></label>
      <label>
        Starting stage
        <select v-model="initialStage">
          <option value="saved">Saved</option>
          <option value="applied">Applied</option>
          <option value="screen">Screen</option>
          <option value="interview">Interview</option>
          <option value="offer">Offer</option>
        </select>
      </label>
      <label>Date <input v-model="initialDate" type="date" :max="today()" /></label>
      <label v-if="record.documents.length > 0">
        Résumé sent
        <select v-model="documentId">
          <option value="">None yet</option>
          <option v-for="doc in record.documents" :key="doc.id" :value="doc.id">{{ doc.label }}</option>
        </select>
      </label>
      <p v-else class="hint">
        No Documents uploaded yet — <RouterLink to="/documents">upload one</RouterLink> to attach it here next time.
      </p>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="actions">
        <button type="submit" class="primary">Save</button>
        <button type="button" class="ghost" @click="formOpen = false">Cancel</button>
      </div>
    </form>

    <div v-if="record.applications.length === 0" class="empty">
      <p><b>No applications yet.</b></p>
      <p class="note">
        Nothing here until you are looking. When you are, this is where the record starts —
        your compensation history is already sitting next door, which is what tells you the
        number to ask for.
      </p>
    </div>

    <template v-else>
      <section v-if="open.length > 0">
        <h3>Open <span class="count">{{ open.length }}</span></h3>
        <RouterLink v-for="application in open" :key="application.id" :to="`/applications/${application.id}`" class="row">
          <div class="l">
            {{ application.title }} <span class="co">· {{ application.company }}</span>
            <small>{{ application.source }}</small>
          </div>
          <div class="r">
            <span class="chip" :class="chipClass(statusOf(application))">{{ statusOf(application)?.toUpperCase() }}</span>
            <span v-if="daysAgo(application) !== undefined" class="ago">{{ daysAgo(application) }}d ago</span>
          </div>
        </RouterLink>
      </section>

      <section v-if="closed.length > 0">
        <h3>Closed <span class="count">{{ closed.length }}</span></h3>
        <RouterLink v-for="application in closed" :key="application.id" :to="`/applications/${application.id}`" class="row dim">
          <div class="l">
            {{ application.title }} <span class="co">· {{ application.company }}</span>
          </div>
          <div class="r">
            <span class="chip" :class="chipClass(statusOf(application))">{{ statusOf(application)?.toUpperCase() }}</span>
          </div>
        </RouterLink>
      </section>
    </template>
  </div>
</template>

<style scoped>
.board {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 760px;
}

.toggle {
  background: transparent;
  border: 1px dashed var(--hairline);
  border-radius: var(--radius-control);
  color: var(--muted);
  padding: 9px 14px;
  font-size: 13px;
  cursor: pointer;
  align-self: flex-start;
  margin-bottom: 20px;
}

.toggle:hover {
  color: var(--selene);
  border-color: var(--selene);
}

.form {
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-card);
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 420px;
  margin-bottom: 24px;
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
  padding: 8px 10px;
  color: var(--text);
  font-size: 13.5px;
  font-family: var(--sans);
}

.hint {
  color: var(--faint);
  font-size: 12px;
  margin: -4px 0 0;
}

.hint a {
  color: var(--selene);
}

.error {
  color: var(--fall);
  font-size: 12.5px;
}

.actions {
  display: flex;
  gap: 10px;
}

button.primary {
  background: var(--selene);
  color: var(--page);
  border: none;
  border-radius: var(--radius-control);
  padding: 8px 16px;
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

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px solid var(--hairline);
  text-decoration: none;
  color: inherit;
}

.row:last-child {
  border-bottom: none;
}

.row.dim {
  color: var(--faint);
}

.row .l {
  font-size: 13.5px;
}

.row .l small {
  display: block;
  color: var(--faint);
  font-size: 11px;
  margin-top: 2px;
}

.co {
  color: var(--muted);
  font-weight: 400;
}

.row .r {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ago {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--faint);
}

.chip {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.05em;
  border-radius: 4px;
  padding: 2px 7px;
  white-space: nowrap;
}

.chip.q {
  border: 1px solid var(--hairline);
  color: var(--faint);
}

.chip.ok {
  border: 1px solid var(--rise);
  color: var(--rise);
}

.chip.no {
  border: 1px solid var(--fall);
  color: var(--fall);
}
</style>
