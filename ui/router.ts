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
import ComingSoonView from './views/ComingSoonView.vue'

/**
 * Home is the Timeline — there is no separate dashboard (design/views.html § what these
 * settle). Settings is routed but not yet built (build order step 4): the shell holds its
 * place rather than dead-ending in a 404. The application record's own analytics —
 * funnel, response rates, stall detection, the attention view — wait for a real search to
 * tune them against (plan § When a search starts) and are not routed yet either; the
 * record itself (this list, and Landing) is — Position included, now that it has its own
 * list-plus-detail home the same shape Application already had.
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
    {
      path: '/settings',
      name: 'settings',
      component: ComingSoonView,
      props: { title: 'Settings', note: 'Auth and invites land in build order step 4. The AI key already lives on the Self-assessment page.' },
    },
  ],
})
