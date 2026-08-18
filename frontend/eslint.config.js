import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import i18next from 'eslint-plugin-i18next'
import sonarjs from 'eslint-plugin-sonarjs'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'bindings'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      sonarjs,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Sonar-class quality gates (goal 0109 phase 2b), the TS
      // counterparts of .golangci.yml's dupl/gocognit: thresholds and
      // enables set from a full measurement run over src/, never
      // aspiration (hit lists in the goal file). no-duplicate-string
      // stays OFF -- Sonar's own default posture; i18n keys and
      // testids are the documented noise class.
      'sonarjs/cognitive-complexity': ['error', 15],
      'sonarjs/no-duplicated-branches': 'error',
      'sonarjs/no-identical-functions': 'error',
      // eslint-plugin-react-hooks 6.x/7.x folded the React Compiler's
      // lint rules into `recommended` (goal: dependency majors sweep,
      // eslint 10 + react-hooks 7.1.1). `set-state-in-effect` flags
      // house style's own "reset local state when an id/prop changes,
      // then kick off a fetch" idiom used across ~15 existing effects
      // (WorkflowRunsPanel, IntegrationBindingsEditor, liveRunState,
      // and others) -- a well-established, deliberate React pattern
      // here, not a bug the rule caught. Rewriting all 15 call sites to
      // the rule's preferred derived-state/`key`-remount shape is a
      // real behavioral refactor with its own retest surface, well
      // beyond a dependency bump's scope -- tune it off project-wide
      // rather than force that refactor or scatter 15 disable-line
      // comments, matching .golangci.yml's "tune when defaults fight
      // house style" precedent.
      'react-hooks/set-state-in-effect': 'off',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  {
    // The regression guard docs/goals/0032-copy-management.md's own
    // Plan step deliberately deferred until the four migration slices
    // closed the gap (app/composition/configure/views -- all now
    // t()-driven, checked empirically clean against this exact rule
    // before it was ever turned on, not assumed). Scoped to src/ only
    // (not e2e/ fixtures, not config files) and to jsx-text-only mode
    // (the plugin's own default): checked directly against this
    // codebase first -- 'jsx-only' (attribute values too) produced ~290
    // warnings dominated by Primer/DataTable prop names (`stackId`,
    // `dataKey`, `weight`, `testId`, `entity`, ...) sitting on custom
    // (non-native-DOM) JSX elements deep inside object-literal props,
    // not real copy; taming that would need a large, brittle
    // Primer-specific attribute allowlist for a marginal catch (new
    // hardcoded aria-label/title/placeholder attributes) this
    // conservative mode doesn't cover. jsx-text-only -- JSX text
    // children only -- gave a small, accurate signal instead (5 real
    // leftovers found and fixed in shared/, composition/, configure/
    // the same session this rule landed), so it's the honest default,
    // not a static config the plugin ships defensively.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': ['error', { mode: 'jsx-text-only' }],
    },
  },
)
