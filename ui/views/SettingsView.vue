<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Invite, User } from '../../domain/index.js'
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
import { buildExport } from '../export.js'
import { record, saveUser, today } from '../record.js'
import { isServerBuild } from '../store.js'

const serverBuild = isServerBuild()
const isAdmin = record.user?.isAdmin ?? false

// ── stall threshold (CONTEXT.md § Stall Threshold) ──────────────────────────
const stallThresholdDays = ref(record.user?.stallThresholdDays ?? 21)
const savingThreshold = ref(false)

async function saveStallThreshold(): Promise<void> {
  if (!record.user || stallThresholdDays.value < 1) return
  savingThreshold.value = true
  try {
    await saveUser({ ...record.user, stallThresholdDays: stallThresholdDays.value })
  } finally {
    savingThreshold.value = false
  }
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
        A zip of everything Hyperion holds for you — every row as JSON, plus your documents'
        actual files. The same way <code>cp hyperion.db</code> is a complete self-hosted
        backup, this is the portable version: open it anywhere, no server required.
      </p>
      <p v-if="exportError" class="error">{{ exportError }}</p>
      <div class="actions">
        <button class="ghost" :disabled="exporting" @click="exportData">
          {{ exporting ? 'Exporting…' : 'Export your data' }}
        </button>
      </div>
    </section>

    <section class="panel">
      <h3>Stall Threshold</h3>
      <p class="note">
        Days of silence before an Open Application shows up under "Needs attention" on the
        Applications page. Silence is normal in a job search — this just sets where the line
        sits for you, and it's worth tuning once you've watched a few go quiet.
      </p>
      <div class="actions">
        <input v-model.number="stallThresholdDays" type="number" min="1" class="num" @change="saveStallThreshold" />
        <span class="unit">days{{ savingThreshold ? '…' : '' }}</span>
      </div>
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
