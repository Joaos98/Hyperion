<script setup lang="ts">
import { useRouter } from 'vue-router'
import { seedDemo } from '../demo-seed.js'
import { initRecord } from '../record.js'
import { chosenStore, DEMO_ENTERED_KEY, DEMO_USER_ID } from '../store.js'

const router = useRouter()

async function enter(): Promise<void> {
  const store = chosenStore()
  const existing = await store.loadUserRecord(DEMO_USER_ID)
  if (!existing) await seedDemo(store, DEMO_USER_ID)
  window.localStorage.setItem(DEMO_ENTERED_KEY, 'true')
  await initRecord(store, DEMO_USER_ID)
  await router.replace('/')
}
</script>

<template>
  <div class="card">
    <img src="/hyperion-logo.svg" alt="" class="mark" />
    <h1>Hyperion</h1>
    <p class="sub">Sign in to your record.</p>

    <form class="form" @submit.prevent="enter">
      <label>Display name <input value="John Doe" type="text" disabled /></label>
      <label>Password <input value="••••••••••••" type="password" disabled /></label>
      <button type="submit" class="primary">View the demo</button>
    </form>

    <p class="facade-note">
      A facade — the demo runs in your browser, with no server or account behind it.
      Everything past this screen is editable.
    </p>
  </div>
</template>

<style scoped>
.card {
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-card);
  padding: 32px 34px;
  width: 380px;
  max-width: calc(100vw - 48px);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.mark {
  width: 32px;
  height: 23px;
  margin-bottom: 14px;
}

h1 {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0;
}

.sub {
  color: var(--faint);
  font-size: 12.5px;
  margin: 6px 0 22px;
  line-height: 1.5;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  text-align: left;
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
  padding: 9px 11px;
  color: var(--faint);
  font-size: 13.5px;
  font-family: var(--sans);
  cursor: not-allowed;
}

button.primary {
  background: var(--selene);
  color: var(--page);
  border: none;
  border-radius: var(--radius-control);
  padding: 10px 18px;
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  margin-top: 4px;
}

.facade-note {
  margin: 20px 0 0;
  font-size: 11.5px;
  color: var(--faint);
  line-height: 1.5;
}
</style>
