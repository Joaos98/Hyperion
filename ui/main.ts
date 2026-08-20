import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router.js'
import { initRecord, markNotSignedIn, record } from './record.js'
import { chosenStore, DEMO_ENTERED_KEY, DEMO_USER_ID, isDemoMode, isServerBuild } from './store.js'
import { whoAmI } from './auth.js'
import { seedDemo } from './demo-seed.js'
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
  } else if (isDemoMode()) {
    // The published demo: a login facade first (plan § Architecture), remembered per
    // browser so a returning visitor's own edits aren't re-seeded over or hidden behind
    // the facade a second time.
    if (window.localStorage.getItem(DEMO_ENTERED_KEY)) {
      if (!(await store.loadUserRecord(DEMO_USER_ID))) await seedDemo(store, DEMO_USER_ID)
      await initRecord(store, DEMO_USER_ID)
    } else {
      markNotSignedIn()
      await router.replace('/demo-login')
    }
  } else {
    // Local development before a server exists has no login at all — one plain User,
    // seeded here on first run (`ui/store.ts`'s own split).
    await initRecord(store, DEMO_USER_ID)
    if (!record.user) {
      await store.createUser({
        id: DEMO_USER_ID,
        displayName: 'You',
        isAdmin: true,
        foldThresholdDays: 90,
        stallThresholdDays: 21,
        aiBaseUrl: null,
        aiApiKey: null,
        aiModel: null,
        compensationDisplay: 'monthly',
        displayCurrency: null,
      })
      await initRecord(store, DEMO_USER_ID)
    }
  }

  createApp(App).use(router).mount('#app')
}

void start()
