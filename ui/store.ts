import { httpStore } from '../storage/http-store.js'
import { LocalStorageStore } from '../storage/local-storage-store.js'
import type { HyperionStore } from '../storage/port.js'

/**
 * Which data layer this build was made with — the only thing the two builds differ in
 * (ui/store.ts in Prometheus, the same convention). The self-hosted build talks to its
 * own server; the demo, and local development before a server exists, keep the record in
 * the browser and need nothing running behind them.
 */
export function chosenStore(): HyperionStore {
  return import.meta.env['VITE_STORAGE'] === 'server' ? httpStore('/api') : new LocalStorageStore(window.localStorage)
}

/**
 * Stands in for a session until auth lands (build order step 4). Every build — demo,
 * local development, and the self-hosted server's own bootstrap in `server/main.ts` —
 * agrees on this one id, so a record written by any of them is readable by the others.
 */
export const CURRENT_USER_ID = 'local'
