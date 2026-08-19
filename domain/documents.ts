import type { DocumentMeta } from './types.js'

/** Documents newest first — the order a versions list is always read in. */
export function documentsNewestFirst(documents: readonly DocumentMeta[]): DocumentMeta[] {
  return [...documents].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** A byte count as a person would say it — the app's own formatting, not the OS's. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(1)} MB`
}

/**
 * Document bytes travel as base64 wherever the transport is text — a JSON write body, or
 * `localStorage`, which is string-only. One conversion, shared by every adapter that
 * needs it, rather than the same dozen lines re-derived per adapter and one of them
 * eventually drifting. `btoa`/`atob` are global in both the browser and Node (18+), so
 * this stays a pure function with no adapter-specific import.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
