import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router.js'
import { initRecord, markNotSignedIn, record } from './record.js'
import { chosenStore, DEMO_USER_ID, isServerBuild } from './store.js'
import { whoAmI } from './auth.js'
import './styles/base.css'

async function start(): Promise<void> {
  const store = chosenStore()

  if (isServerBuild()) {
    // Real auth: ask the server who, if anyone, this browser already is, before ever
    // touching `initRecord` — a User who isn't signed in has no record to load, and
    // `App.vue`'s own loading gate would otherwise spin forever waiting for one.
    const { user, setupOpen } = await whoAmI()
    if (user) {
      await initRecord(store, user.id)
    } else {
      markNotSignedIn()
      await router.replace(setupOpen ? '/setup' : '/login')
    }
  } else {
    // The demo build, and local development before a server exists, have no login at all
    // — one User, seeded here on first run (`ui/store.ts`'s own split).
    await initRecord(store, DEMO_USER_ID)
    if (!record.user) {
      await store.createUser({
        id: DEMO_USER_ID,
        displayName: 'You',
        isAdmin: true,
        foldThresholdDays: 90,
        stallThresholdDays: 21,
        aiApiKey: null,
        compensationDisplay: 'monthly',
      })
      await initRecord(store, DEMO_USER_ID)
    }
  }

  createApp(App).use(router).mount('#app')
}

void start()
