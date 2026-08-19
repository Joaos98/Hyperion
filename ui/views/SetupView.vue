<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { AuthError, completeSetup } from '../auth.js'
import { initRecord } from '../record.js'
import { chosenStore } from '../store.js'

const setupToken = ref('')
const displayName = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')
const router = useRouter()

async function submit(): Promise<void> {
  error.value = ''
  busy.value = true
  try {
    const user = await completeSetup(setupToken.value.trim(), displayName.value.trim(), password.value)
    await initRecord(chosenStore(), user.id)
    await router.replace('/')
  } catch (cause) {
    error.value = cause instanceof AuthError ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="card">
    <img src="/hyperion-logo.svg" alt="" class="mark" />
    <h1>Set up Hyperion</h1>
    <p class="sub">First run. The token below was printed to this deployment's server console when it started.</p>

    <form class="form" @submit.prevent="submit">
      <label>Setup token <input v-model="setupToken" type="text" required autofocus /></label>
      <label>Your display name <input v-model="displayName" type="text" required autocomplete="username" /></label>
      <label>Choose a password <input v-model="password" type="password" required autocomplete="new-password" /></label>
      <p v-if="error" class="error">{{ error }}</p>
      <button type="submit" class="primary" :disabled="busy">{{ busy ? 'Setting up…' : 'Create account' }}</button>
    </form>
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
  color: var(--text);
  font-size: 13.5px;
  font-family: var(--sans);
}

.error {
  color: var(--fall);
  font-size: 12.5px;
  margin: 0;
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

button.primary:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
