<script setup lang="ts">
import { computed, ref } from 'vue'
import { documentsNewestFirst, formatBytes, type Application, type DocumentMeta } from '../../domain/index.js'
import { deleteDocument, readDocumentBytes, record, renameDocument, uploadDocument } from '../record.js'

const documents = computed(() => documentsNewestFirst(record.documents as DocumentMeta[]))

function applicationsFor(documentId: string): Application[] {
  return (record.applications as Application[]).filter((row) => row.documentId === documentId)
}

// ── upload ────────────────────────────────────────────────────────────────
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
  if (!uploadFile.value) {
    uploadError.value = 'Choose a file first.'
    return
  }
  uploading.value = true
  try {
    await uploadDocument(uploadLabel.value.trim() || uploadFile.value.name, uploadFile.value)
    uploadLabel.value = ''
    uploadFile.value = null
    uploadOpen.value = false
  } catch (cause) {
    uploadError.value = String(cause instanceof Error ? cause.message : cause)
  } finally {
    uploading.value = false
  }
}

// ── rename ────────────────────────────────────────────────────────────────
const renamingId = ref<string | null>(null)
const renameValue = ref('')

function startRename(doc: DocumentMeta): void {
  renamingId.value = doc.id
  renameValue.value = doc.label
}

async function submitRename(id: string): Promise<void> {
  if (renameValue.value.trim()) await renameDocument(id, renameValue.value.trim())
  renamingId.value = null
}

// ── download / delete ───────────────────────────────────────────────────
async function download(meta: DocumentMeta): Promise<void> {
  const bytes = await readDocumentBytes(meta.id)
  if (!bytes) return
  const blob = new Blob([bytes as BlobPart], { type: meta.mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = meta.filename
  anchor.click()
  URL.revokeObjectURL(url)
}

async function remove(id: string): Promise<void> {
  await deleteDocument(id)
}
</script>

<template>
  <div class="board">
    <p class="intro">
      Every résumé and cover letter version, kept as the actual file — not just a label. Attach
      one to an Application from here or from the Application itself; a Document can go out with
      more than one.
    </p>

    <button v-if="!uploadOpen" class="toggle" @click="uploadOpen = true">+ Upload a Document</button>
    <form v-else class="form" @submit.prevent="submitUpload">
      <label>Label <input v-model="uploadLabel" type="text" placeholder="Résumé v3, backend-heavy" /></label>
      <label>File <input type="file" @change="pickFile" required /></label>
      <p v-if="uploadError" class="error">{{ uploadError }}</p>
      <div class="actions">
        <button type="submit" class="primary" :disabled="uploading">{{ uploading ? 'Uploading…' : 'Upload' }}</button>
        <button type="button" class="ghost" @click="uploadOpen = false">Cancel</button>
      </div>
    </form>

    <p v-if="documents.length === 0" class="empty">
      <b>Nothing uploaded yet.</b>
      Upload a résumé version here, before you have anywhere specific to send it — attaching it
      to an Application is a separate step, whenever you need it.
    </p>

    <div v-else class="list">
      <div v-for="doc in documents" :key="doc.id" class="row">
        <div class="l">
          <div v-if="renamingId !== doc.id" class="label">
            {{ doc.label }}
            <button class="linkbtn" @click="startRename(doc)">rename</button>
          </div>
          <form v-else class="rename-form" @submit.prevent="submitRename(doc.id)">
            <input v-model="renameValue" type="text" autofocus />
            <button type="submit" class="linkbtn">save</button>
            <button type="button" class="linkbtn" @click="renamingId = null">cancel</button>
          </form>
          <small>
            {{ doc.filename }} · {{ formatBytes(doc.sizeBytes) }} · {{ doc.createdAt }}
            <template v-if="applicationsFor(doc.id).length > 0">
              · sent with {{ applicationsFor(doc.id).map((a) => a.company).join(', ') }}
            </template>
            <template v-else> · not attached to any Application</template>
          </small>
        </div>
        <div class="r">
          <button class="linkbtn" @click="download(doc)">download</button>
          <button class="linkbtn danger" @click="remove(doc.id)">delete forever</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.board {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 760px;
}

.intro {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.55;
  margin-bottom: 4px;
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

.empty {
  color: var(--muted);
  font-size: 13.5px;
  line-height: 1.55;
}

.empty b {
  display: block;
  color: var(--text);
  font-weight: 600;
  margin-bottom: 4px;
}

.list {
  display: flex;
  flex-direction: column;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  padding: 14px 0;
  border-bottom: 1px solid var(--hairline);
}

.row:last-child {
  border-bottom: none;
}

.label {
  font-size: 13.5px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.rename-form {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rename-form input {
  background: var(--page);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  padding: 5px 8px;
  color: var(--text);
  font-size: 13px;
  font-family: var(--sans);
}

.row small {
  display: block;
  color: var(--faint);
  font-size: 11px;
  margin-top: 4px;
}

.r {
  display: flex;
  gap: 10px;
  flex: none;
  padding-top: 2px;
}

.linkbtn {
  background: transparent;
  border: none;
  color: var(--faint);
  font-size: 11.5px;
  text-decoration: underline;
  cursor: pointer;
  white-space: nowrap;
}

.linkbtn:hover {
  color: var(--selene);
}

.linkbtn.danger:hover {
  color: var(--fall);
}
</style>
