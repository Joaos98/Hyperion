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
 * Whether this is the published demo build (`vite build --mode demo`) rather than plain
 * local development (`npm run dev`, no `--mode`) — both share `LocalStorageStore` and
 * `DEMO_USER_ID` below, but only the demo shows the login facade: it opens on a login
 * screen that is a facade over the same storage. Vite already sets `MODE` from the
 * `--mode` flag; no env file needed the way `isServerBuild` needs `.env.server`.
 */
export function isDemoMode(): boolean {
  return import.meta.env.MODE === 'demo'
}

/**
 * The self-hosted build talks to its own server, behind a real login; the demo, and local
 * development before a server exists, keep the record in the
 * browser and need nothing running behind them — real auth included, since that's a
 * self-hosted-server concern only. The demo build's own login screen (`isDemoMode` above)
 * is a facade over this same storage, not a second auth system.
 */
export function chosenStore(): HyperionStore {
  return isServerBuild() ? httpStore('/api') : new LocalStorageStore(window.localStorage)
}

/**
 * The one User the demo/local-dev build ever seeds (`ui/main.ts`) — that build has no real
 * login, so there is never a second User to distinguish it from. The self-hosted server
 * build never reads this: its Users come from `/api/setup` and `/api/register`, and every
 * write after that reads the signed-in User's real id off `record.user` instead
 * (`ui/record.ts`'s `currentUserId()`).
 */
export const DEMO_USER_ID = 'local'

/**
 * Set in `localStorage` the moment a demo visitor clicks past the login facade
 * (`DemoLoginView.vue`) — checked by `ui/main.ts`'s bootstrap and the router guard so a
 * returning visitor, whose edits are still sitting in this same `localStorage`, skips
 * straight back into the app instead of seeing the facade again.
 */
export const DEMO_ENTERED_KEY = 'hyperion.demo-entered'
