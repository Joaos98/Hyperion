import { createRouter, createWebHistory } from 'vue-router'
import TimelineView from './views/TimelineView.vue'
import AchievementsView from './views/AchievementsView.vue'
import CompensationView from './views/CompensationView.vue'
import PositionsView from './views/PositionsView.vue'
import PositionView from './views/PositionView.vue'
import SelfAssessmentView from './views/SelfAssessmentView.vue'
import ResumeBulletsView from './views/ResumeBulletsView.vue'
import ApplicationsView from './views/ApplicationsView.vue'
import ApplicationView from './views/ApplicationView.vue'
import DocumentsView from './views/DocumentsView.vue'
import SettingsView from './views/SettingsView.vue'
import LoginView from './views/LoginView.vue'
import SetupView from './views/SetupView.vue'
import RegisterView from './views/RegisterView.vue'
import DemoLoginView from './views/DemoLoginView.vue'
import { record } from './record.js'
import { DEMO_ENTERED_KEY, isDemoMode, isServerBuild } from './store.js'

/**
 * Home renders `TimelineView.vue` — the Timeline pillar plus the sidebar cards (design/
 * views.html § what these settle) — but is named `home`, not `timeline`, since it is no
 * longer only the Timeline. There is still no separate dashboard: the application record's
 * own analytics (funnel, response rates, stall detection, the attention view — plan §
 * When a search starts, all shipped) live on `ApplicationsView.vue` instead of a route of
 * their own, the same reasoning that kept Home from becoming one either.
 *
 * `login` / `setup` / `register` are the only routes reachable without a Session in the
 * server build (`ui/main.ts`'s bootstrap, and the guard below); `demo-login` is the same
 * idea for the published demo build's own login facade. Routed regardless of build so one
 * router serves all three.
 */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: TimelineView },
    { path: '/positions', name: 'positions', component: PositionsView },
    { path: '/achievements', name: 'achievements', component: AchievementsView },
    { path: '/compensation', name: 'compensation', component: CompensationView },
    { path: '/positions/:id', name: 'position', component: PositionView, props: true },
    { path: '/self-assessment', name: 'self-assessment', component: SelfAssessmentView },
    { path: '/resume-bullets', name: 'resume-bullets', component: ResumeBulletsView },
    { path: '/applications', name: 'applications', component: ApplicationsView },
    { path: '/applications/:id', name: 'application', component: ApplicationView, props: true },
    { path: '/documents', name: 'documents', component: DocumentsView },
    { path: '/settings', name: 'settings', component: SettingsView },
    { path: '/login', name: 'login', component: LoginView },
    { path: '/setup', name: 'setup', component: SetupView },
    { path: '/register', name: 'register', component: RegisterView },
    { path: '/demo-login', name: 'demo-login', component: DemoLoginView },
  ],
})

const PUBLIC_ROUTES = new Set(['login', 'setup', 'register', 'demo-login'])

/**
 * No-op in plain local development, which has no concept of "not signed in" at all. In the
 * server build, this is the same rule `ui/main.ts`'s cold-boot bootstrap already applies,
 * kept alive for every navigation after that: no Session, no route past the three public
 * ones. In the demo build, the equivalent is the `hyperion.demo-entered` flag: no flag, no
 * route past the facade — a direct link into `/positions` before entering still lands there
 * first.
 */
router.beforeEach((to) => {
  if (isServerBuild()) {
    if (PUBLIC_ROUTES.has(String(to.name))) return true
    return record.user ? true : '/login'
  }
  if (isDemoMode()) {
    if (to.name === 'demo-login') return true
    return window.localStorage.getItem(DEMO_ENTERED_KEY) ? true : '/demo-login'
  }
  return true
})
