import type { Command } from './commands'
import { useUISignalStore } from './uiSignalStore'

// review.rules -- split out of shared/commands.ts (CLAUDE.md's 500-line
// convention), same shape as secretsCommands.ts.
export const REVIEW_COMMANDS: Command[] = [
  {
    // Deep-link reuse (goal 0078): unbound by default, discoverable via
    // the palette while already on Review -- surface-scoped like
    // atlas.jump, so it only ever fires with ReviewView already
    // mounted, switching its own local tab state to "Rules" via the
    // uiSignalStore counter it watches.
    id: 'review.rules',
    menu: { path: 'view', group: 0, order: 6, label: 'Review rules' },
    label: 'Guardrail rules',
    defaultBinding: null,
    surface: ['review'],
    run: () => useUISignalStore.getState().requestReviewRules(),
  },
]
