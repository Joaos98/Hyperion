<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { record } from './record.js'

/** Login, Setup, Register and the demo facade render full-bleed, with no nav to a record they can't reach yet. */
const route = useRoute()
const isAuthScreen = computed(() => ['login', 'setup', 'register', 'demo-login'].includes(String(route.name)))
</script>

<template>
  <header v-if="!isAuthScreen" class="shell">
    <RouterLink to="/" class="brand">
      <img src="/hyperion-logo.svg" alt="" class="mark" />
      <span>Hyperion</span>
    </RouterLink>
    <nav>
      <RouterLink to="/" exact-active-class="on">Timeline</RouterLink>
      <RouterLink to="/positions" active-class="on">Positions</RouterLink>
      <RouterLink to="/achievements" active-class="on">Achievements</RouterLink>
      <RouterLink to="/compensation" active-class="on">Compensation</RouterLink>
      <RouterLink to="/applications" active-class="on">Applications</RouterLink>
      <RouterLink to="/documents" active-class="on">Documents</RouterLink>
      <RouterLink to="/settings" active-class="on">Settings</RouterLink>
    </nav>
    <RouterLink to="/settings" class="who">{{ record.user?.displayName ?? '…' }}</RouterLink>
  </header>

  <main :class="{ centered: isAuthScreen }">
    <RouterView v-if="record.loaded || isAuthScreen" />
    <p v-else class="loading">Loading your record…</p>
  </main>
</template>

<style scoped>
.shell {
  display: flex;
  align-items: center;
  gap: 26px;
  background: var(--surface);
  border-bottom: 1px solid var(--hairline);
  padding: 12px 24px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: var(--selene);
}

.brand span {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.01em;
}

.mark {
  width: 26px;
  height: 19px;
  display: block;
}

nav {
  display: flex;
  gap: 2px;
}

nav a {
  font-size: 13px;
  color: var(--faint);
  padding: 6px 12px;
  border-radius: 6px;
  text-decoration: none;
}

nav a.on {
  color: var(--selene);
  background: var(--selene-wash);
}

.who {
  margin-left: auto;
  font-size: 12px;
  color: var(--faint);
  font-family: var(--mono);
  text-decoration: none;
}

.who:hover {
  color: var(--selene);
}

main {
  flex: 1;
  max-width: 1180px;
  width: 100%;
  margin: 0 auto;
  padding: 40px 34px 96px;
}

main.centered {
  max-width: none;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.loading {
  color: var(--muted);
  font-size: 13.5px;
}
</style>
