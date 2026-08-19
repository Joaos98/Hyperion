import { httpStore } from '../storage/http-store.js'
import { LocalStorageStore } from '../storage/local-storage-store.js'
import type { HyperionStore } from '../storage/port.js'

/**
 * Whether this build talks to the self-hosted server — the only thing the two builds
 * differ in (ui/store.ts in Prometheus, the same convention), and now the one place that
 * fact is asked, rather than three call sites independently reading the env var and
 * risking drift.
 */
export function isServerBuild(): boolean {
  return import.meta.env['VITE_STORAGE'] === 'server'
}

/**
 * The self-hosted build talks to its own server, behind a real login (plan § Users and
 * access); the demo, and local development before a server exists, keep the record in the
 * browser and need nothing running behind them — login included, since auth is a
 * self-hosted-server concern only.
 */
export function chosenStore(): HyperionStore {
  return isServerBuild() ? httpStore('/api') : new LocalStorageStore(window.localStorage)
}

/**
 * The one User the demo/local-dev build ever seeds (`ui/main.ts`) — that build has no
 * login, so there is never a second User to distinguish it from. The self-hosted server
 * build never reads this: its Users come from `/api/setup` and `/api/register`, and every
 * write after that reads the signed-in User's real id off `record.user` instead
 * (`ui/record.ts`'s `currentUserId()`).
 */
export const DEMO_USER_ID = 'local'
