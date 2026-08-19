<script setup lang="ts">
defineProps<{ title: string; note: string }>()
</script>

<template>
  <div class="panel empty">
    <h2>{{ title }}</h2>
    <p>Not built yet.</p>
    <p class="note">{{ note }}</p>
  </div>
</template>

<style scoped>
.panel {
  background: transparent;
  border: 1px dashed var(--hairline);
  border-radius: var(--radius-card);
  padding: 28px;
  max-width: 60ch;
}

h2 {
  font-size: 16px;
  margin-bottom: 6px;
}

p {
  color: var(--muted);
  font-size: 13.5px;
  margin: 4px 0 0;
}

.note {
  color: var(--faint);
  font-size: 12.5px;
  margin-top: 10px;
}
</style>
