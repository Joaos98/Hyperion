<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { daysSinceLastAchievement, search, type Achievement, type Position } from '../../domain/index.js'
import { deleteAchievement, record, today } from '../record.js'
import LogAchievementModal from '../components/LogAchievementModal.vue'

const query = ref('')

// ── Capture (plan § Conventions: "Capture repeats on two screens") ──────────
// The same Log-achievement card Home carries, and for the same reason: the inline box
// could only ever log today, against the current Position, with no Impact — three fields
// the Achievement already had and nothing here could reach. Capture is still one click.
const showLogModal = ref(false)
const positions = computed(() => record.positions as Position[])
const currentPosition = computed(() => positions.value.find((position) => position.departure === null))
const staleness = computed(() => daysSinceLastAchievement(record.achievements as Achievement[], today()))
const results = computed(() => search(record.achievements as Achievement[], query.value))

function positionName(achievement: Achievement): string | undefined {
  if (!achievement.positionId) return undefined
  return record.positions.find((position) => position.id === achievement.positionId)?.company
}

function monthLabel(date: string): string {
  const year = date.split('-')[0]
  const named = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
  return `${named} ${year}`
}

/** Achievements grouped under the month they were logged in, both newest first. */
const grouped = computed(() => {
  const groups: { label: string; entries: Achievement[] }[] = []
  for (const achievement of results.value) {
    const label = monthLabel(achievement.date)
    const group = groups.at(-1)
    if (group?.label === label) group.entries.push(achievement)
    else groups.push({ label, entries: [achievement] })
  }
  return groups
})
</script>

<template>
  <div class="board">
    <div class="card">
      <div class="log-row">
        <span class="log-label">What did you ship?</span>
        <button class="log-btn" :disabled="positions.length === 0" @click="showLogModal = true">+ Log achievement</button>
      </div>
      <p v-if="positions.length === 0" class="log-none">
        Add a <RouterLink to="/positions">Position</RouterLink> first — an Achievement needs one to belong to.
      </p>
      <template v-else>
        <p v-if="staleness === undefined" class="log-stale">Nothing logged yet.</p>
        <p v-else-if="staleness > 0" class="log-stale">Last logged <b>{{ staleness }}</b> day{{ staleness === 1 ? '' : 's' }} ago</p>
        <p v-else class="log-stale">Logged today.</p>
      </template>
    </div>

    <div class="draft-links">
      <RouterLink to="/self-assessment" class="draft-link">Draft a self-assessment from this log →</RouterLink>
      <RouterLink to="/resume-bullets" class="draft-link">Draft résumé bullets from this log →</RouterLink>
    </div>

    <input v-model="query" type="text" class="search" placeholder="Search your achievements…" />

    <p v-if="record.achievements.length === 0" class="empty">
      <b>Your log starts here.</b>
      Write one line about something you did this week. It needn't be impressive — in March
      you won't remember it either way.
    </p>
    <p v-else-if="results.length === 0" class="empty">Nothing matches “{{ query }}”.</p>

    <div v-else class="groups">
      <div v-for="group in grouped" :key="group.label" class="group">
        <div class="month">{{ group.label.toUpperCase() }}</div>
        <div v-for="achievement in group.entries" :key="achievement.id" class="entry">
          <p class="prose">{{ achievement.text }}</p>
          <div class="meta">
            {{ achievement.date }}
            <template v-if="positionName(achievement)"> · {{ positionName(achievement) }}</template>
            <template v-if="achievement.impact"> · {{ achievement.impact }}</template>
            <button class="remove" title="Remove" @click="deleteAchievement(achievement.id)">×</button>
          </div>
        </div>
      </div>
    </div>

    <p class="note">
      No tags, no categories, no required fields. Search is full-text over the prose above —
      whether that is enough stays an open question until there are months of real entries to
      answer it with.
    </p>

    <LogAchievementModal v-if="showLogModal" :default-position-id="currentPosition?.id" @close="showLogModal = false" />
  </div>
</template>

<style scoped>
.board {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 68ch;
}

/* The Log-achievement card, the same shape Home's sidebar carries. */
.card {
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-card);
  padding: 18px 20px;
}

.log-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.log-label {
  font-size: 14px;
  color: var(--muted);
}

.log-btn {
  background: var(--selene);
  color: var(--page);
  border: none;
  border-radius: var(--radius-control);
  padding: 7px 14px;
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}

.log-btn:disabled {
  background: transparent;
  color: var(--faint);
  border: 1px solid var(--hairline);
  cursor: default;
}

.log-stale,
.log-none {
  font-size: 12.5px;
  color: var(--muted);
  margin: 12px 0 0;
}

.log-stale b {
  color: var(--selene);
  font-weight: 500;
}

.log-none a {
  color: var(--selene);
  text-decoration: underline;
}

.draft-links {
  align-self: flex-start;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.draft-link {
  font-size: 12.5px;
  color: var(--faint);
  text-decoration: none;
}

.draft-link:hover {
  color: var(--selene);
}

.search {
  background: var(--page);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  padding: 9px 12px;
  color: var(--text);
  font-size: 13.5px;
  font-family: var(--sans);
}

.search::placeholder {
  color: var(--faint);
}

.empty {
  color: var(--muted);
  font-size: 13.5px;
  line-height: 1.6;
}

.empty b {
  display: block;
  color: var(--text);
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 4px;
}

.groups {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.month {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--faint);
  letter-spacing: 0.06em;
  margin-bottom: 10px;
}

.entry {
  padding: 14px 0;
  border-bottom: 1px solid var(--hairline);
}

.entry:last-child {
  border-bottom: none;
}

.entry .prose {
  font-size: 14px;
  margin: 0;
}

.meta {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--faint);
  letter-spacing: 0.03em;
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.remove {
  background: transparent;
  border: none;
  color: var(--faint);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  padding: 0 2px;
  font-family: var(--sans);
}

.remove:hover {
  color: var(--fall);
}

.note {
  color: var(--faint);
  font-size: 12px;
  margin-top: 8px;
}
</style>
