import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
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
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
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
)
