/** One entry per page id (docs/03_contracts.md §7). Nav is filtered by pack.features and role. */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

export interface PageDef {
  id: string;
  path: string;
  label: string;
  group: 'Start' | 'Tasks' | 'Explore' | 'Optional' | 'Wrap up' | 'Facilitator';
  facilitatorOnly?: boolean;
  needsTeam?: boolean;
  component: LazyExoticComponent<ComponentType>;
}

export const PAGES: PageDef[] = [
  { id: 'home', path: '/', label: 'Home', group: 'Start', component: lazy(() => import('./home')) },
  { id: 'setup', path: '/setup', label: 'Setup', group: 'Start', component: lazy(() => import('./setup')) },
  { id: 'exercise', path: '/exercise', label: 'The exercise', group: 'Start', component: lazy(() => import('./exercise')) },
  { id: 'genie_analyse', path: '/analyse', label: '1 · Genie Analyse', group: 'Tasks', needsTeam: true, component: lazy(() => import('./analyse')) },
  { id: 'task2', path: '/task2', label: '2 · Convert & run', group: 'Tasks', needsTeam: true, component: lazy(() => import('./task2')) },
  { id: 'task3', path: '/task3', label: '3 · Validate', group: 'Tasks', needsTeam: true, component: lazy(() => import('./validate')) },
  { id: 'task4', path: '/task4', label: '4 · Prove', group: 'Tasks', needsTeam: true, component: lazy(() => import('./prove')) },
  { id: 'genie_results', path: '/genie', label: 'Ask Genie', group: 'Explore', component: lazy(() => import('./genie')) },
  { id: 'own_code', path: '/own-code', label: 'Your own code', group: 'Explore', needsTeam: true, component: lazy(() => import('./owncode')) },
  { id: 'estate', path: '/estate', label: 'Legacy estate', group: 'Explore', component: lazy(() => import('./estate')) },
  { id: 'task1', path: '/task1', label: 'Trace (optional)', group: 'Optional', needsTeam: true, component: lazy(() => import('./task1')) },
  { id: 'framework', path: '/framework', label: 'Framework files & recheck', group: 'Optional', needsTeam: true, facilitatorOnly: true, component: lazy(() => import('./framework')) },
  { id: 'framework_validate', path: '/framework/validate', label: 'Framework validate', group: 'Optional', needsTeam: true, facilitatorOnly: true, component: lazy(() => import('./task3')) },
  { id: 'framework_prove', path: '/framework/prove', label: 'Framework prove', group: 'Optional', needsTeam: true, facilitatorOnly: true, component: lazy(() => import('./task4')) },
  { id: 'questions', path: '/registers', label: 'Questions & findings', group: 'Wrap up', needsTeam: true, component: lazy(() => import('./registers')) },
  { id: 'close', path: '/close', label: 'Close & pilot', group: 'Wrap up', needsTeam: true, component: lazy(() => import('./close')) },
  { id: 'facilitator', path: '/facilitator', label: 'Facilitator board', group: 'Facilitator', facilitatorOnly: true, component: lazy(() => import('./facilitator')) },
  { id: 'presenter', path: '/presenter', label: 'Presenter', group: 'Facilitator', facilitatorOnly: true, component: lazy(() => import('./presenter')) },
];

export const GROUPS: PageDef['group'][] = ['Start', 'Tasks', 'Explore', 'Optional', 'Wrap up', 'Facilitator'];
