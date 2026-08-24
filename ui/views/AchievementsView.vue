<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { daysSinceLastAchievement, search, type Achievement, type Position } from '../../domain/index.js'
import { deleteAchievement, record, today } from '../record.js'
import LogAchievementModal from '../components/LogAchievementModal.vue'

const query = ref('')

// ── Capture (plan § Conventions: "Capture repeats on two screens") ──────────
// The same modal Home opens, for the same reason: the inline box could only ever log
// today, against the current Position, with no Impact — three fields the Achievement
// already had and nothing here could reach. Capture is still one click.
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
    <div class="actions">
      <div class="actions-log">
        <button class="log-btn" :disabled="positions.length === 0" @click="showLogModal = true">+ Log achievement</button>
        <template v-if="positions.length > 0">
          <p v-if="staleness === undefined" class="log-note">Nothing logged yet.</p>
          <p v-else-if="staleness > 0" class="log-note">Last logged <b>{{ staleness }}</b> day{{ staleness === 1 ? '' : 's' }} ago</p>
          <p v-else class="log-note">Logged today.</p>
        </template>
      </div>
      <div class="actions-drafts">
        <RouterLink to="/self-assessment" class="draft-btn">Draft a self-assessment →</RouterLink>
        <RouterLink to="/resume-bullets" class="draft-btn">Draft résumé bullets →</RouterLink>
      </div>
      <p v-if="positions.length === 0" class="log-note whole-row">
        Add a <RouterLink to="/positions">Position</RouterLink> first — an Achievement needs one to belong to.
      </p>
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

/*
 * One actions row: the primary and its staleness line on the left, the two drafting
 * actions stacked on the right, the short side centred against the tall one. Stacking is
 * what pays for the labels — on one line the drafts have to clip to "Self-assessment",
 * and a button that writes prose for you wants the verb.
 */
.actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  column-gap: 20px;
  row-gap: 12px;
}

.actions-log {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* Right of the row, and still right of it once the row wraps — `space-between` alone
   left-aligns whichever item ends up alone on the second line. */
.actions-drafts {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  margin-left: auto;
}

/* The no-Positions sentence is too long to sit beside the button the way the staleness
   line does, so it takes the whole width and drops under the row instead of squeezing it. */
.whole-row {
  flex-basis: 100%;
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

.log-note {
  font-size: 12.5px;
  color: var(--muted);
  margin: 0;
}

.log-note b {
  color: var(--selene);
  font-weight: 500;
}

.log-note a {
  color: var(--selene);
  text-decoration: underline;
}

/* Links, not buttons — they navigate, so middle-click and copy-link still work. */
.draft-btn {
  background: transparent;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  color: var(--muted);
  padding: 7px 13px;
  font-size: 12px;
  text-decoration: none;
  white-space: nowrap;
}

.draft-btn:hover {
  color: var(--selene);
  border-color: var(--selene);
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
</style>
