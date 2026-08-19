<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  eventsNewestFirst,
  formatBytes,
  formatAmount,
  mintId,
  status,
  toMinor,
  type ApplicationEvent,
  type Currency,
  type EmploymentType,
  type Round,
  type RoundKind,
  type Stage,
} from '../../domain/index.js'
import {
  deleteApplication,
  deleteApplicationEvent,
  deleteDocument,
  deleteRound,
  landApplication,
  readDocumentBytes,
  record,
  saveApplication,
  saveApplicationEvent,
  saveRound,
  today,
  uploadDocument,
} from '../record.js'
import CurrencyFields from '../components/CurrencyFields.vue'

const props = defineProps<{ id: string }>()
const router = useRouter()

const application = computed(() => record.applications.find((row) => row.id === props.id))
const events = computed(() =>
  eventsNewestFirst((record.applicationEvents as ApplicationEvent[]).filter((row) => row.applicationId === props.id)),
)
const currentStatus = computed(() => status(events.value))

const STAGES: Stage[] = ['saved', 'applied', 'screen', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn']

function fmt(minor: number, currency: Currency): string {
  return formatAmount({ minor, currency })
}

// ── add an Application Event ────────────────────────────────────────────
const eventOpen = ref(false)
const eventStage = ref<Stage>('applied')
const eventDate = ref(today())
const eventNote = ref('')

async function submitEvent(): Promise<void> {
  if (!application.value) return
  await saveApplicationEvent({
    id: mintId(),
    applicationId: application.value.id,
    stage: eventStage.value,
    date: eventDate.value,
    note: eventNote.value.trim() || null,
  })
  eventNote.value = ''
  eventOpen.value = false
}

// ── Rounds ──────────────────────────────────────────────────────────────
// Unlike an Application Event, a Round is genuinely edited in place rather than
// superseded by a new row: it starts life as just a scheduled date and kind, and the
// same entry gains its notes once it has actually happened (CONTEXT.md § Round —
// "an appointment that may be in the future").
const rounds = computed(() =>
  (record.rounds as Round[]).filter((row) => row.applicationId === props.id).sort((a, b) => b.date.localeCompare(a.date)),
)

const roundOpen = ref(false)
const roundEditingId = ref<string | null>(null)
const roundDate = ref(today())
const roundKind = ref<RoundKind>('interview')
const roundPerson = ref('')
const roundNotes = ref('')

function openRoundForm(existing?: Round): void {
  roundEditingId.value = existing?.id ?? null
  roundDate.value = existing?.date ?? today()
  roundKind.value = existing?.kind ?? 'interview'
  roundPerson.value = existing?.person ?? ''
  roundNotes.value = existing?.notes ?? ''
  roundOpen.value = true
}

async function submitRound(): Promise<void> {
  if (!application.value) return
  await saveRound({
    id: roundEditingId.value ?? mintId(),
    applicationId: application.value.id,
    date: roundDate.value,
    kind: roundKind.value,
    person: roundPerson.value.trim() || null,
    notes: roundNotes.value.trim() || null,
  })
  roundOpen.value = false
}

// ── Advertised Range ─────────────────────────────────────────────────────
const rangeOpen = ref(false)
const rangeMin = ref('')
const rangeMax = ref('')
const rangeCurrency = ref<Currency>({ code: 'BRL', symbol: 'R$', decimals: 2 })
const rangeError = ref('')

function openRangeForm(): void {
  const current = application.value?.advertisedRange
  if (current) {
    rangeMin.value = String(current.minMinor / 10 ** current.currency.decimals)
    rangeMax.value = String(current.maxMinor / 10 ** current.currency.decimals)
    rangeCurrency.value = current.currency
  }
  rangeOpen.value = true
}

async function submitRange(): Promise<void> {
  rangeError.value = ''
  if (!application.value) return
  try {
    const minMinor = toMinor(rangeMin.value, rangeCurrency.value)
    const maxMinor = toMinor(rangeMax.value || rangeMin.value, rangeCurrency.value)
    await saveApplication({
      ...application.value,
      advertisedRange: { minMinor, maxMinor, currency: rangeCurrency.value },
    })
    rangeOpen.value = false
  } catch (cause) {
    rangeError.value = String(cause instanceof Error ? cause.message : cause)
  }
}

// ── Offered Terms ─────────────────────────────────────────────────────────
const offerOpen = ref(false)
const offerBase = ref('')
const offerBonus = ref('0')
const offerType = ref<EmploymentType>('clt')
const offerStart = ref(today())
const offerCurrency = ref<Currency>({ code: 'BRL', symbol: 'R$', decimals: 2 })
const offerError = ref('')

function openOfferForm(): void {
  const current = application.value?.offeredTerms
  if (current) {
    offerBase.value = String(current.baseSalaryMinor / 10 ** current.currency.decimals)
    offerBonus.value = String(current.targetBonusMinor / 10 ** current.currency.decimals)
    offerType.value = current.employmentType
    offerStart.value = current.startDate
    offerCurrency.value = current.currency
  } else if (application.value?.advertisedRange) {
    offerCurrency.value = application.value.advertisedRange.currency
  }
  offerOpen.value = true
}

async function submitOffer(): Promise<void> {
  offerError.value = ''
  if (!application.value) return
  try {
    const baseSalaryMinor = toMinor(offerBase.value, offerCurrency.value)
    const targetBonusMinor = toMinor(offerBonus.value || '0', offerCurrency.value)
    await saveApplication({
      ...application.value,
      offeredTerms: {
        baseSalaryMinor,
        targetBonusMinor,
        employmentType: offerType.value,
        startDate: offerStart.value,
        currency: offerCurrency.value,
      },
    })
    offerOpen.value = false
  } catch (cause) {
    offerError.value = String(cause instanceof Error ? cause.message : cause)
  }
}

// ── Landing ──────────────────────────────────────────────────────────────
const landing = ref(false)

async function land(): Promise<void> {
  if (!application.value) return
  landing.value = true
  try {
    const position = await landApplication(application.value)
    await router.push(`/positions/${position.id}`)
  } finally {
    landing.value = false
  }
}

async function remove(): Promise<void> {
  if (!application.value) return
  await deleteApplication(application.value.id)
  await router.push('/applications')
}

// ── Résumé sent ──────────────────────────────────────────────────────────
const attachedDocument = computed(() =>
  application.value?.documentId ? record.documents.find((row) => row.id === application.value!.documentId) : undefined,
)
const otherDocuments = computed(() => record.documents.filter((row) => row.id !== application.value?.documentId))

const uploadOpen = ref(false)
const uploadLabel = ref('')
const uploadFile = ref<File | null>(null)
const uploadError = ref('')
const uploading = ref(false)

function pickFile(event: Event): void {
  uploadFile.value = (event.target as HTMLInputElement).files?.[0] ?? null
}

async function submitUpload(): Promise<void> {
  uploadError.value = ''
  if (!application.value || !uploadFile.value) {
    uploadError.value = 'Choose a file first.'
    return
  }
  uploading.value = true
  try {
    const meta = await uploadDocument(uploadLabel.value.trim() || uploadFile.value.name, uploadFile.value)
    await saveApplication({ ...application.value, documentId: meta.id })
    uploadLabel.value = ''
    uploadFile.value = null
    uploadOpen.value = false
  } catch (cause) {
    uploadError.value = String(cause instanceof Error ? cause.message : cause)
  } finally {
    uploading.value = false
  }
}

async function attachExisting(id: string): Promise<void> {
  if (!application.value || !id) return
  await saveApplication({ ...application.value, documentId: id })
}

async function unlinkDocument(): Promise<void> {
  if (!application.value) return
  await saveApplication({ ...application.value, documentId: null })
}

/** Unlike `unlinkDocument`, this destroys the file — the store clears the reference here and on every other Application that named it. */
async function deleteDocumentForever(): Promise<void> {
  const meta = attachedDocument.value
  if (!meta) return
  await deleteDocument(meta.id)
}

async function download(): Promise<void> {
  const meta = attachedDocument.value
  if (!meta) return
  const bytes = await readDocumentBytes(meta.id)
  if (!bytes) return
  // Uint8Array's ArrayBufferLike generic is broader than BlobPart's own ArrayBuffer-only
  // one (a lib.dom.d.ts precision that has no runtime meaning here) — bytes read back
  // from either adapter are always a plain ArrayBuffer underneath.
  const blob = new Blob([bytes as BlobPart], { type: meta.mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = meta.filename
  anchor.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div v-if="!application" class="empty">No Application at this id.</div>

  <div v-else class="panel">
    <div class="head">
      <div>
        <h2>{{ application.title }} <span class="co">· {{ application.company }}</span></h2>
        <div class="meta">
          {{ application.source }}
          <template v-if="application.postingUrl"> · <a :href="application.postingUrl" target="_blank" rel="noopener">posting</a></template>
        </div>
      </div>
      <div class="head-actions">
        <span class="chip" :class="{ ok: currentStatus === 'landed', no: currentStatus === 'rejected' || currentStatus === 'withdrawn' }">
          {{ currentStatus?.toUpperCase() }}
        </span>
        <button class="btn end" @click="remove">Delete</button>
      </div>
    </div>

    <div class="cols">
      <div>
        <h3>Pipeline <span class="count">{{ events.length }}</span></h3>

        <div v-if="!eventOpen" class="row-actions">
          <button class="toggle" @click="eventOpen = true">+ Add Event</button>
        </div>
        <form v-else class="inline-form" @submit.prevent="submitEvent">
          <label>
            Stage
            <select v-model="eventStage">
              <option v-for="stage in STAGES" :key="stage" :value="stage">{{ stage }}</option>
            </select>
          </label>
          <label>Date <input v-model="eventDate" type="date" :max="today()" required /></label>
          <label>Note <input v-model="eventNote" type="text" placeholder="optional" /></label>
          <div class="actions">
            <button type="submit" class="primary">Save</button>
            <button type="button" class="ghost" @click="eventOpen = false">Cancel</button>
          </div>
        </form>

        <div v-for="event in events" :key="event.id" class="line">
          <div class="l">
            {{ event.stage.toUpperCase() }}
            <small>{{ event.date }}<template v-if="event.note"> · {{ event.note }}</template></small>
          </div>
          <button class="remove" title="Remove" @click="deleteApplicationEvent(event.id)">×</button>
        </div>

        <h3 class="later">Rounds <span class="count">{{ rounds.length }}</span></h3>

        <div v-if="!roundOpen" class="row-actions">
          <button class="toggle" @click="openRoundForm()">+ Add Round</button>
        </div>
        <form v-else class="inline-form" @submit.prevent="submitRound">
          <label>
            Kind
            <select v-model="roundKind">
              <option value="interview">Interview</option>
              <option value="take-home">Take-home</option>
            </select>
          </label>
          <label>Date <input v-model="roundDate" type="date" required /></label>
          <label>Person <input v-model="roundPerson" type="text" placeholder="optional" /></label>
          <label>Notes <textarea v-model="roundNotes" placeholder="optional — how it went, once it has"></textarea></label>
          <div class="actions">
            <button type="submit" class="primary">Save</button>
            <button type="button" class="ghost" @click="roundOpen = false">Cancel</button>
          </div>
        </form>

        <div v-for="round in rounds" :key="round.id" class="line">
          <div class="l">
            {{ round.kind === 'interview' ? 'Interview' : 'Take-home' }}<template v-if="round.person"> · {{ round.person }}</template>
            <small>{{ round.date }}<template v-if="round.notes"> · {{ round.notes }}</template></small>
          </div>
          <div class="doc-actions">
            <button class="linkbtn" @click="openRoundForm(round)">edit</button>
            <button class="remove" title="Remove" @click="deleteRound(round.id)">×</button>
          </div>
        </div>
      </div>

      <div>
        <h3>Advertised range</h3>
        <p v-if="!application.advertisedRange && !rangeOpen" class="none">
          Not recorded. <button class="linkbtn" @click="openRangeForm">add</button>
        </p>
        <div v-else-if="!rangeOpen" class="line">
          <div class="l">{{ fmt(application.advertisedRange!.minMinor, application.advertisedRange!.currency) }} – {{ fmt(application.advertisedRange!.maxMinor, application.advertisedRange!.currency) }}</div>
          <button class="linkbtn" @click="openRangeForm">edit</button>
        </div>
        <form v-if="rangeOpen" class="inline-form" @submit.prevent="submitRange">
          <label>Currency <CurrencyFields v-model="rangeCurrency" /></label>
          <label>Min <input v-model="rangeMin" type="text" inputmode="decimal" required /></label>
          <label>Max <input v-model="rangeMax" type="text" inputmode="decimal" placeholder="same as min if unstated" /></label>
          <p v-if="rangeError" class="error">{{ rangeError }}</p>
          <div class="actions">
            <button type="submit" class="primary">Save</button>
            <button type="button" class="ghost" @click="rangeOpen = false">Cancel</button>
          </div>
        </form>

        <h3 class="later">Offered terms</h3>
        <p v-if="!application.offeredTerms && !offerOpen" class="none">
          Not recorded. <button class="linkbtn" @click="openOfferForm">add</button>
        </p>
        <div v-else-if="!offerOpen" class="offer">
          <div class="line">
            <div class="l">{{ fmt(application.offeredTerms!.baseSalaryMinor, application.offeredTerms!.currency) }} base · {{ fmt(application.offeredTerms!.targetBonusMinor, application.offeredTerms!.currency) }} target</div>
            <button class="linkbtn" @click="openOfferForm">edit</button>
          </div>
          <div class="line">
            <div class="l">{{ application.offeredTerms!.employmentType.toUpperCase() }} · starts {{ application.offeredTerms!.startDate }}</div>
          </div>
          <button v-if="currentStatus !== 'landed'" class="btn land" :disabled="landing" @click="land">
            {{ landing ? 'Landing…' : 'Land this Application' }}
          </button>
        </div>
        <form v-if="offerOpen" class="inline-form" @submit.prevent="submitOffer">
          <label>Currency <CurrencyFields v-model="offerCurrency" /></label>
          <label>Base salary <input v-model="offerBase" type="text" inputmode="decimal" required /></label>
          <label>Target bonus <input v-model="offerBonus" type="text" inputmode="decimal" /></label>
          <label>
            Employment type
            <select v-model="offerType">
              <option value="clt">CLT</option>
              <option value="pj">PJ</option>
              <option value="contract">Contract</option>
              <option value="internship">Internship</option>
            </select>
          </label>
          <label>Start date <input v-model="offerStart" type="date" required /></label>
          <p v-if="offerError" class="error">{{ offerError }}</p>
          <div class="actions">
            <button type="submit" class="primary">Save</button>
            <button type="button" class="ghost" @click="offerOpen = false">Cancel</button>
          </div>
        </form>

        <h3 class="later">Résumé sent</h3>
        <div v-if="attachedDocument" class="line doc">
          <div class="l">
            {{ attachedDocument.label }}
            <small>{{ attachedDocument.filename }} · {{ formatBytes(attachedDocument.sizeBytes) }} · {{ attachedDocument.createdAt }}</small>
          </div>
          <div class="doc-actions">
            <button class="linkbtn" @click="download">download</button>
            <button class="linkbtn" @click="unlinkDocument" title="Keeps the file, just no longer sent with this Application">remove</button>
            <button class="linkbtn danger" @click="deleteDocumentForever" title="Deletes the file itself, everywhere it was attached">delete forever</button>
          </div>
        </div>
        <template v-else>
          <p class="none">Not recorded.</p>
          <select v-if="otherDocuments.length > 0" class="reuse" @change="attachExisting(($event.target as HTMLSelectElement).value)">
            <option value="">Use an existing Document…</option>
            <option v-for="doc in otherDocuments" :key="doc.id" :value="doc.id">{{ doc.label }}</option>
          </select>
          <div v-if="!uploadOpen" class="row-actions">
            <button class="toggle" @click="uploadOpen = true">+ Upload a Document</button>
          </div>
          <form v-else class="inline-form" @submit.prevent="submitUpload">
            <label>Label <input v-model="uploadLabel" type="text" placeholder="Résumé v3, backend-heavy" /></label>
            <label>File <input type="file" @change="pickFile" required /></label>
            <p v-if="uploadError" class="error">{{ uploadError }}</p>
            <div class="actions">
              <button type="submit" class="primary" :disabled="uploading">{{ uploading ? 'Uploading…' : 'Upload' }}</button>
              <button type="button" class="ghost" @click="uploadOpen = false">Cancel</button>
            </div>
          </form>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.empty {
  color: var(--muted);
  font-size: 13.5px;
}

.panel {
  max-width: 900px;
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

.meta a {
  color: var(--selene);
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.chip {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.05em;
  border: 1px solid var(--hairline);
  color: var(--faint);
  border-radius: 4px;
  padding: 2px 7px;
  white-space: nowrap;
}

.chip.ok {
  border-color: var(--rise);
  color: var(--rise);
}

.chip.no {
  border-color: var(--fall);
  color: var(--fall);
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

.btn.end:hover {
  color: var(--fall);
  border-color: var(--fall);
}

.btn.land {
  display: block;
  margin-top: 12px;
  width: 100%;
  background: var(--selene);
  color: var(--page);
  border: none;
  font-weight: 500;
}

.btn.land:disabled {
  opacity: 0.5;
  cursor: default;
}

.cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
}

h3 {
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 10px;
}

h3.later {
  margin-top: 22px;
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

.line .l small {
  display: block;
  color: var(--faint);
  font-size: 10.5px;
  margin-top: 2px;
}

.line.doc {
  align-items: baseline;
}

.doc-actions {
  display: flex;
  gap: 10px;
  flex: none;
}

.reuse {
  width: 100%;
  background: var(--page);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  padding: 7px 9px;
  color: var(--muted);
  font-size: 12.5px;
  font-family: var(--sans);
  margin: 8px 0;
}

.none {
  color: var(--faint);
  font-size: 12.5px;
}

.linkbtn {
  background: transparent;
  border: none;
  color: var(--faint);
  font-size: 11.5px;
  text-decoration: underline;
  cursor: pointer;
}

.linkbtn:hover {
  color: var(--selene);
}

.linkbtn.danger:hover {
  color: var(--fall);
}

.remove {
  background: transparent;
  border: none;
  color: var(--faint);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
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

.inline-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}

.inline-form input,
.inline-form select,
.inline-form textarea {
  background: var(--page);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  padding: 7px 9px;
  color: var(--text);
  font-size: 13px;
  font-family: var(--sans);
}

.inline-form textarea {
  resize: vertical;
  min-height: 52px;
  line-height: 1.5;
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
