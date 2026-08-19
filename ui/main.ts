import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router.js'
import { initRecord, record } from './record.js'
import { chosenStore, CURRENT_USER_ID } from './store.js'
import './styles/base.css'

async function start(): Promise<void> {
  const store = chosenStore()

  // The self-hosted server seeds this User itself on boot (server/main.ts). The two
  // browser-only builds — local development and the demo — have no server to do that,
  // so the first run here does it instead: the same bootstrap, run from whichever side
  // of the port happens to be in charge of the record.
  await initRecord(store)
  if (!record.user) {
    await store.createUser({
      id: CURRENT_USER_ID,
      displayName: 'You',
      isAdmin: true,
      foldThresholdDays: 90,
      stallThresholdDays: 21,
      aiApiKey: null,
      compensationDisplay: 'monthly',
    })
    await initRecord(store)
  }

  createApp(App).use(router).mount('#app')
}

void start()
