<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { displayCurrency, type Currency, type Invite, type Position, type User } from '../../domain/index.js'
import {
  AuthError,
  changePassword,
  createInvite,
  deleteInvite,
  listInvites,
  listUsers,
  logout,
  resetUserPassword,
} from '../auth.js'
import { AI_PRESETS } from '../ai.js'
import { buildExport } from '../export.js'
import { applyImport, type ImportSummary } from '../import.js'
import { record, saveUser, today } from '../record.js'
import { isServerBuild } from '../store.js'

const serverBuild = isServerBuild()
const isAdmin = record.user?.isAdmin ?? false

// ── stall threshold (CONTEXT.md § Stall Threshold) ──────────────────────────
/**
 * Saved on a button rather than on change. A number typed a digit at a time passes through
 * values nobody meant — 2 on the way to 21 — and committing each of them writes a setting
 * the User never chose. The picker below can commit on change because choosing an option
 * *is* the gesture; typing has no such moment, so it gets an explicit one.
 */
const stallThresholdDays = ref(record.user?.stallThresholdDays ?? 21)
const savingThreshold = ref(false)
/** Only after a save in this visit — otherwise the panel would greet everyone with "Saved". */
const thresholdSaved = ref(false)

const thresholdChanged = computed(
  () => stallThresholdDays.value >= 1 && stallThresholdDays.value !== record.user?.stallThresholdDays,
)

async function saveStallThreshold(): Promise<void> {
  if (!record.user || !thresholdChanged.value) return
  savingThreshold.value = true
  try {
    await saveUser({ ...record.user, stallThresholdDays: stallThresholdDays.value })
    thresholdSaved.value = true
  } finally {
    savingThreshold.value = false
  }
}

// ── Display Currency (CONTEXT.md § Display Currency) ───────────────────────
/**
 * Offered, never required. Left alone it is derived from the earliest Position, which for
 * a record that never crossed a currency is simply the currency it is kept in — so this
 * control exists for the careers that did cross one, and everybody else can ignore it.
 */
const currenciesOnRecord = computed(() => {
  const seen = new Map<string, Currency>()
  for (const position of record.positions as Position[]) seen.set(position.currency.code, position.currency)
  return [...seen.values()]
})

const derivedCurrency = computed(() =>
  record.user ? displayCurrency({ ...(record.user as User), displayCurrency: null }, record.positions as Position[]) : undefined,
)

const chosenCurrency = ref(record.user?.displayCurrency?.code ?? '')
const savingCurrency = ref(false)

async function saveDisplayCurrency(): Promise<void> {
  if (!record.user) return
  savingCurrency.value = true
  try {
    const picked = currenciesOnRecord.value.find((currency) => currency.code === chosenCurrency.value)
    await saveUser({ ...record.user, displayCurrency: picked ?? null })
  } finally {
    savingCurrency.value = false
  }
}

// ── AI Setup: base URL, model and key together, visible but inactive until all three are
// set — AI is additive, never load-bearing. A key alone no longer says where to send it
// to ask for. Lives here rather than on each AI view, since a second AI view (résumé
// bullets) made the duplicated panel worse than one shared home. ──
const isAiSetUp = computed(() => !!(record.user?.aiBaseUrl && record.user?.aiApiKey && record.user?.aiModel))
const aiPresetLabel = computed(() => AI_PRESETS.find((preset) => preset.baseUrl === record.user?.aiBaseUrl)?.label ?? 'Custom')

const presetId = ref(AI_PRESETS[0]!.id)
const baseUrlInput = ref(AI_PRESETS[0]!.baseUrl)
const modelInput = ref('claude-sonnet-5')
const aiKeyInput = ref('')
const editingAiSetup = ref(false)
const aiSetupSaving = ref(false)

/**
 * A model id from one provider means nothing to another, so switching resets it rather
 * than leaving a stale value behind — Anthropic's current default is worth pre-filling;
 * every other provider's model id is left for the User to supply. Custom's own base URL is
 * empty by design (there is nothing to prefill), so it must clear the field too rather than
 * leaving whichever preset's URL was there before.
 */
function applyAiPreset(): void {
  const preset = AI_PRESETS.find((row) => row.id === presetId.value)
  if (!preset) return
  baseUrlInput.value = preset.baseUrl
  modelInput.value = preset.id === 'anthropic' ? 'claude-sonnet-5' : ''
}

function startEditingAiSetup(): void {
  presetId.value = AI_PRESETS.find((preset) => preset.baseUrl === record.user?.aiBaseUrl)?.id ?? 'custom'
  baseUrlInput.value = record.user?.aiBaseUrl ?? AI_PRESETS[0]!.baseUrl
  modelInput.value = record.user?.aiModel ?? ''
  aiKeyInput.value = ''
  editingAiSetup.value = true
}

async function saveAiSetup(): Promise<void> {
  if (!record.user || !baseUrlInput.value.trim() || !modelInput.value.trim() || !aiKeyInput.value.trim()) return
  aiSetupSaving.value = true
  try {
    await saveUser({
      ...record.user,
      aiBaseUrl: baseUrlInput.value.trim(),
      aiApiKey: aiKeyInput.value.trim(),
      aiModel: modelInput.value.trim(),
    })
    editingAiSetup.value = false
    aiKeyInput.value = ''
  } finally {
    aiSetupSaving.value = false
  }
}

async function removeAiSetup(): Promise<void> {
  if (!record.user) return
  await saveUser({ ...record.user, aiBaseUrl: null, aiApiKey: null, aiModel: null })
}

// ── your data ──────────────────────────────────────────────────────────────
const exporting = ref(false)
const exportError = ref('')

async function exportData(): Promise<void> {
  exportError.value = ''
  exporting.value = true
  try {
    const zip = await buildExport()
    // Uint8Array's ArrayBufferLike generic is broader than BlobPart's own ArrayBuffer-only.
    const blob = new Blob([zip as BlobPart], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `hyperion-export-${today()}.zip`
    link.click()
    URL.revokeObjectURL(url)
  } catch (cause) {
    exportError.value = String(cause)
  } finally {
    exporting.value = false
  }
}

const importInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)
const importError = ref('')
const importSummary = ref<ImportSummary | null>(null)

/** Existing rows with matching ids are overwritten; nothing already here is ever deleted. */
async function importData(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0]
  ;(event.target as HTMLInputElement).value = ''
  if (!file) return
  if (!window.confirm(`Import "${file.name}"? Matching rows will be overwritten — nothing already here will be deleted.`)) return

  importError.value = ''
  importSummary.value = null
  importing.value = true
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    importSummary.value = await applyImport(bytes)
  } catch (cause) {
    importError.value = String(cause instanceof Error ? cause.message : cause)
  } finally {
    importing.value = false
  }
}

// ── your account ──────────────────────────────────────────────────────────
const currentPassword = ref('')
const newPassword = ref('')
const changing = ref(false)
const changeError = ref('')
const changed = ref(false)

async function submitChangePassword(): Promise<void> {
  changeError.value = ''
  changing.value = true
  try {
    await changePassword(currentPassword.value, newPassword.value)
    currentPassword.value = ''
    newPassword.value = ''
    changed.value = true
    setTimeout(() => (changed.value = false), 2500)
  } catch (cause) {
    changeError.value = cause instanceof AuthError ? cause.message : String(cause)
  } finally {
    changing.value = false
  }
}

/**
 * A hard reload rather than a router navigation — `record.ts` has no "forget everything"
 * action, and a fresh page load is the simplest way to guarantee no stale record lingers
 * in memory for whoever signs in next on this browser.
 */
async function signOut(): Promise<void> {
  await logout()
  window.location.href = '/login'
}

// ── Admin: Invites ──────────────────────────────────────────────────────
const invites = ref<Invite[]>([])
const invitesError = ref('')
const justCreated = ref('')
const copiedCode = ref('')

async function loadInvites(): Promise<void> {
  try {
    invites.value = await listInvites()
  } catch (cause) {
    invitesError.value = cause instanceof AuthError ? cause.message : String(cause)
  }
}

async function generateInvite(): Promise<void> {
  invitesError.value = ''
  try {
    const invite = await createInvite()
    justCreated.value = invite.code
    await loadInvites()
  } catch (cause) {
    invitesError.value = cause instanceof AuthError ? cause.message : String(cause)
  }
}

async function revokeInvite(code: string): Promise<void> {
  await deleteInvite(code)
  if (justCreated.value === code) justCreated.value = ''
  await loadInvites()
}

async function copyInviteLink(code: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(`${window.location.origin}/register?code=${code}`)
    copiedCode.value = code
    setTimeout(() => (copiedCode.value = ''), 1500)
  } catch {
    // Clipboard access can be refused by the browser; the code is still visible to copy by hand.
  }
}

// ── Admin: Users ──────────────────────────────────────────────────────────
const users = ref<User[]>([])
const usersError = ref('')
const resettingId = ref('')
const resetPasswordValue = ref('')
const justReset = ref('')

async function loadUsers(): Promise<void> {
  try {
    users.value = await listUsers()
  } catch (cause) {
    usersError.value = cause instanceof AuthError ? cause.message : String(cause)
  }
}

function startReset(userId: string): void {
  resettingId.value = userId
  resetPasswordValue.value = ''
  justReset.value = ''
}

async function submitReset(userId: string): Promise<void> {
  usersError.value = ''
  try {
    await resetUserPassword(userId, resetPasswordValue.value)
    justReset.value = userId
    resettingId.value = ''
  } catch (cause) {
    usersError.value = cause instanceof AuthError ? cause.message : String(cause)
  }
}

onMounted(() => {
  if (serverBuild && isAdmin) {
    loadInvites()
    loadUsers()
  }
})
</script>

<template>
  <div class="board">
    <h1>Settings</h1>

    <section class="panel">
      <h3>Your data</h3>
      <p class="note">
        A zip of every row as JSON, plus your documents' actual files. Opens anywhere, with
        no server needed.
      </p>
      <p v-if="exportError" class="error">{{ exportError }}</p>
      <div class="actions">
        <button class="ghost" :disabled="exporting" @click="exportData">
          {{ exporting ? 'Exporting…' : 'Export your data' }}
        </button>
      </div>

      <p class="note import-note">
        Restores a zip this export produced. Matching rows are overwritten and nothing is
        deleted — it merges rather than replaces.
      </p>
      <p v-if="importError" class="error">{{ importError }}</p>
      <p v-if="importSummary" class="success">
        Imported {{ importSummary.positions }} Positions, {{ importSummary.applications }} Applications,
        {{ importSummary.achievements }} Achievements, {{ importSummary.documents }} Documents.
      </p>
      <div class="actions">
        <button class="ghost" :disabled="importing" @click="importInput?.click()">
          {{ importing ? 'Importing…' : 'Import your data' }}
        </button>
        <input ref="importInput" type="file" accept=".zip" class="hidden-input" @change="importData" />
      </div>
    </section>

    <section v-if="currenciesOnRecord.length > 1" class="panel">
      <h3>Display Currency</h3>
      <p class="note">
        Which currency your comparisons resolve to, and the chart's scale. Amounts still read
        in the currency they were paid in.
      </p>
      <div class="actions">
        <select v-model="chosenCurrency" class="picker" @change="saveDisplayCurrency">
          <option value="">Earliest Position ({{ derivedCurrency?.code }})</option>
          <option v-for="currency in currenciesOnRecord" :key="currency.code" :value="currency.code">
            {{ currency.code }}
          </option>
        </select>
        <span class="unit">{{ savingCurrency ? 'saving…' : '' }}</span>
      </div>
    </section>

    <section class="panel">
      <h3>Stall Threshold</h3>
      <p class="note">
        Days of silence before an Open Application needs attention. Worth tuning once you've
        watched a few go quiet.
      </p>
      <div class="actions">
        <input
          v-model.number="stallThresholdDays"
          type="number"
          min="1"
          class="num"
          @input="thresholdSaved = false"
          @keyup.enter="saveStallThreshold"
        />
        <span class="unit">days</span>
        <button class="ghost" :disabled="!thresholdChanged || savingThreshold" @click="saveStallThreshold">
          {{ savingThreshold ? 'Saving…' : 'Save' }}
        </button>
        <span v-if="thresholdSaved && !thresholdChanged && !savingThreshold" class="unit saved">Saved</span>
      </div>
    </section>

    <section class="panel">
      <h3>AI Setup</h3>
      <p class="note">
        Powers the self-assessment draft and résumé bullets. Entries go from your browser
        straight to your endpoint, with your own key — never through this server. Inactive
        until all three are set.
      </p>

      <div v-if="!isAiSetUp" class="setup-form">
        <label>
          Provider
          <select v-model="presetId" @change="applyAiPreset">
            <option v-for="preset in AI_PRESETS" :key="preset.id" :value="preset.id">{{ preset.label }}</option>
          </select>
        </label>
        <label>Base URL <input v-model="baseUrlInput" type="text" placeholder="https://…" /></label>
        <label>Model <input v-model="modelInput" type="text" placeholder="model id" /></label>
        <label>API key <input v-model="aiKeyInput" type="password" placeholder="…" autocomplete="off" /></label>
        <button
          class="primary"
          :disabled="!baseUrlInput.trim() || !modelInput.trim() || !aiKeyInput.trim() || aiSetupSaving"
          @click="saveAiSetup"
        >
          Save
        </button>
      </div>

      <template v-else>
        <div class="key-row">
          <span class="key-status">{{ aiPresetLabel }} · {{ record.user?.aiModel }} <span class="dot">••••••••</span></span>
          <button v-if="!editingAiSetup" class="linkbtn" @click="startEditingAiSetup">change</button>
          <button class="linkbtn" @click="removeAiSetup">remove</button>
        </div>
        <div v-if="editingAiSetup" class="setup-form">
          <label>
            Provider
            <select v-model="presetId" @change="applyAiPreset">
              <option v-for="preset in AI_PRESETS" :key="preset.id" :value="preset.id">{{ preset.label }}</option>
            </select>
          </label>
          <label>Base URL <input v-model="baseUrlInput" type="text" placeholder="https://…" /></label>
          <label>Model <input v-model="modelInput" type="text" placeholder="model id" /></label>
          <label>API key <input v-model="aiKeyInput" type="password" placeholder="…" autocomplete="off" /></label>
          <div class="setup-actions">
            <button
              class="primary"
              :disabled="!baseUrlInput.trim() || !modelInput.trim() || !aiKeyInput.trim() || aiSetupSaving"
              @click="saveAiSetup"
            >
              Save
            </button>
            <button class="ghost" @click="editingAiSetup = false">Cancel</button>
          </div>
        </div>
      </template>
    </section>

    <div v-if="!serverBuild" class="panel dashed">
      <p><b>Nothing here to configure.</b></p>
      <p class="note">
        This build keeps your record in the browser with no login at all — there is one
        User and nothing to sign in or out of. Accounts, invites and passwords only exist
        in a self-hosted deployment.
      </p>
    </div>

    <template v-else>
      <section class="panel">
        <h3>Your account</h3>
        <p class="account-line">
          Signed in as <b>{{ record.user?.displayName }}</b>
          <span v-if="isAdmin" class="tick">ADMIN</span>
        </p>

        <form class="form" @submit.prevent="submitChangePassword">
          <label>Current password <input v-model="currentPassword" type="password" required autocomplete="current-password" /></label>
          <label>New password <input v-model="newPassword" type="password" required autocomplete="new-password" /></label>
          <p v-if="changeError" class="error">{{ changeError }}</p>
          <p v-if="changed" class="success">Password changed.</p>
          <div class="actions">
            <button type="submit" class="primary" :disabled="changing">{{ changing ? 'Changing…' : 'Change password' }}</button>
          </div>
        </form>

        <div class="signout-row">
          <button class="ghost" @click="signOut">Sign out</button>
        </div>
      </section>

      <template v-if="isAdmin">
        <section class="panel">
          <div class="section-h">
            <h3>Invites <span class="count">{{ invites.length }}</span></h3>
            <button class="toggle" @click="generateInvite">+ Generate invite</button>
          </div>
          <p v-if="invitesError" class="error">{{ invitesError }}</p>
          <p v-if="invites.length === 0" class="none">
            No pending invites. Registration is invite-only — generate one to bring someone else in.
          </p>
          <div v-for="invite in invites" :key="invite.code" class="invite-row" :class="{ fresh: invite.code === justCreated }">
            <span class="invite-code">{{ invite.code }}</span>
            <div class="invite-actions">
              <button class="linkbtn" @click="copyInviteLink(invite.code)">{{ copiedCode === invite.code ? 'copied' : 'copy link' }}</button>
              <button class="linkbtn danger" @click="revokeInvite(invite.code)">revoke</button>
            </div>
          </div>
        </section>

        <section class="panel">
          <h3>Users <span class="count">{{ users.length }}</span></h3>
          <p v-if="usersError" class="error">{{ usersError }}</p>
          <div v-for="user in users" :key="user.id" class="user-row">
            <div class="user-l">
              {{ user.displayName }}
              <span v-if="user.isAdmin" class="tick">ADMIN</span>
            </div>
            <div class="user-r">
              <p v-if="justReset === user.id" class="success small">Password reset.</p>
              <form v-else-if="resettingId === user.id" class="reset-form" @submit.prevent="submitReset(user.id)">
                <input v-model="resetPasswordValue" type="password" placeholder="New password" required autocomplete="new-password" />
                <button type="submit" class="linkbtn">save</button>
                <button type="button" class="linkbtn" @click="resettingId = ''">cancel</button>
              </form>
              <button v-else class="linkbtn" @click="startReset(user.id)">reset password</button>
            </div>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.board {
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 640px;
}

h1 {
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0;
}

.panel {
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-card);
  padding: 20px 22px;
}

.panel.dashed {
  background: transparent;
  border-style: dashed;
}

.panel.dashed p {
  margin: 4px 0 0;
  font-size: 13.5px;
  color: var(--muted);
}

.note {
  color: var(--faint);
  font-size: 12.5px;
  margin: 0 0 14px;
  line-height: 1.5;
}

.note code {
  font-family: var(--mono);
  font-size: 0.95em;
}

.panel.dashed .note {
  margin: 8px 0 0;
}

h3 {
  font-size: 13px;
  color: var(--muted);
  margin: 0 0 14px;
}

.picker {
  background: var(--page);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  padding: 7px 10px;
  color: var(--text);
  font-size: 13px;
  font-family: var(--sans);
}

.section-h {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.section-h h3 {
  margin-bottom: 0;
}

.count {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--faint);
}

.account-line {
  font-size: 13.5px;
  color: var(--muted);
  margin: 0 0 16px;
}

.account-line b {
  color: var(--text);
  font-weight: 500;
}

.tick {
  display: inline-block;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--selene);
  border: 1px solid var(--selene-dim);
  background: var(--selene-wash);
  border-radius: 4px;
  padding: 2px 6px;
  margin-left: 8px;
  letter-spacing: 0.05em;
  font-weight: 500;
  vertical-align: 1px;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 320px;
}

.form label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12.5px;
  color: var(--muted);
}

.form input {
  background: var(--page);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  padding: 8px 10px;
  color: var(--text);
  font-size: 13.5px;
  font-family: var(--sans);
}

.import-note {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--hairline);
}

.hidden-input {
  display: none;
}

.error {
  color: var(--fall);
  font-size: 12.5px;
  margin: 0;
}

.success {
  color: var(--rise);
  font-size: 12.5px;
  margin: 0;
}

.success.small {
  font-size: 12px;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 2px;
  align-items: center;
}

.num {
  background: var(--page);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  padding: 7px 10px;
  color: var(--text);
  font-size: 13.5px;
  font-family: var(--sans);
  width: 72px;
}

.unit {
  font-size: 12.5px;
  color: var(--muted);
}

.unit.saved {
  color: var(--rise);
  font-size: 12px;
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

button.primary:disabled {
  opacity: 0.5;
  cursor: default;
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

.signout-row {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--hairline);
}

.toggle {
  background: transparent;
  border: 1px dashed var(--hairline);
  border-radius: var(--radius-control);
  color: var(--muted);
  padding: 7px 12px;
  font-size: 12.5px;
  cursor: pointer;
}

.toggle:hover {
  color: var(--selene);
  border-color: var(--selene);
}

.none {
  color: var(--faint);
  font-size: 12.5px;
  line-height: 1.5;
  margin: 0;
}

.invite-row,
.user-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--hairline);
}

.invite-row:last-child,
.user-row:last-child {
  border-bottom: none;
}

.invite-row.fresh {
  background: var(--selene-wash);
  margin: 0 -12px;
  padding: 10px 12px;
  border-radius: var(--radius-control);
  border-bottom: none;
}

.invite-code {
  font-family: var(--mono);
  font-size: 12.5px;
  color: var(--text);
}

.invite-actions {
  display: flex;
  gap: 12px;
  flex: none;
}

.linkbtn {
  background: transparent;
  border: none;
  color: var(--faint);
  font-size: 11.5px;
  text-decoration: underline;
  cursor: pointer;
  padding: 0;
}

.linkbtn:hover {
  color: var(--selene);
}

.linkbtn.danger:hover {
  color: var(--fall);
}

.setup-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
  max-width: 420px;
}

.setup-form label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12.5px;
  color: var(--muted);
}

.setup-form input,
.setup-form select {
  background: var(--page);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  padding: 8px 11px;
  color: var(--text);
  font-size: 13px;
  font-family: var(--mono);
}

.setup-actions {
  display: flex;
  gap: 10px;
}

.key-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}

.key-status {
  font-size: 12.5px;
  color: var(--muted);
}

.key-status .dot {
  font-family: var(--mono);
  color: var(--faint);
}

.user-l {
  font-size: 13.5px;
}

.user-r {
  flex: none;
}

.reset-form {
  display: flex;
  align-items: center;
  gap: 8px;
}

.reset-form input {
  background: var(--page);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  padding: 5px 8px;
  color: var(--text);
  font-size: 12.5px;
  font-family: var(--sans);
  width: 150px;
}
</style>
