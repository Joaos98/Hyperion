import { createRouter, createWebHistory } from 'vue-router'
import TimelineView from './views/TimelineView.vue'
import AchievementsView from './views/AchievementsView.vue'
import CompensationView from './views/CompensationView.vue'
import PositionsView from './views/PositionsView.vue'
import PositionView from './views/PositionView.vue'
import SelfAssessmentView from './views/SelfAssessmentView.vue'
import ApplicationsView from './views/ApplicationsView.vue'
import ApplicationView from './views/ApplicationView.vue'
import DocumentsView from './views/DocumentsView.vue'
import SettingsView from './views/SettingsView.vue'
import LoginView from './views/LoginView.vue'
import SetupView from './views/SetupView.vue'
import RegisterView from './views/RegisterView.vue'
import { record } from './record.js'
import { isServerBuild } from './store.js'

/**
 * Home is the Timeline — there is no separate dashboard (design/views.html § what these
 * settle). The application record's own analytics — funnel, response rates, stall
 * detection, the attention view — wait for a real search to tune them against (plan §
 * When a search starts) and are not routed yet either; the record itself (this list, and
 * Landing) is — Position included, now that it has its own list-plus-detail home the same
 * shape Application already had.
 *
 * `login` / `setup` / `register` are the only routes reachable without a Session in the
 * server build (`ui/main.ts`'s bootstrap, and the guard below) — meaningless in the
 * demo/local-dev build, which has no login at all, but routed regardless so the two builds
 * share one router.
 */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'timeline', component: TimelineView },
    { path: '/positions', name: 'positions', component: PositionsView },
    { path: '/achievements', name: 'achievements', component: AchievementsView },
    { path: '/compensation', name: 'compensation', component: CompensationView },
    { path: '/positions/:id', name: 'position', component: PositionView, props: true },
    { path: '/self-assessment', name: 'self-assessment', component: SelfAssessmentView },
    { path: '/applications', name: 'applications', component: ApplicationsView },
    { path: '/applications/:id', name: 'application', component: ApplicationView, props: true },
    { path: '/documents', name: 'documents', component: DocumentsView },
    { path: '/settings', name: 'settings', component: SettingsView },
    { path: '/login', name: 'login', component: LoginView },
    { path: '/setup', name: 'setup', component: SetupView },
    { path: '/register', name: 'register', component: RegisterView },
  ],
})

const PUBLIC_ROUTES = new Set(['login', 'setup', 'register'])

/**
 * No-op in the demo/local-dev build, which has no concept of "not signed in" at all. In
 * the server build, this is the same rule `ui/main.ts`'s cold-boot bootstrap already
 * applies, kept alive for every navigation after that: no Session, no route past the
 * three public ones.
 */
router.beforeEach((to) => {
  if (!isServerBuild()) return true
  if (PUBLIC_ROUTES.has(String(to.name))) return true
  return record.user ? true : '/login'
})
