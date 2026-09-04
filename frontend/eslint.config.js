import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import i18next from 'eslint-plugin-i18next'
import sonarjs from 'eslint-plugin-sonarjs'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // public/vendor: third-party asset bundles (drawio's viewer + full
  // editor webapp, ADR-0043/goal 0237) never authored as ES modules --
  // they're loaded as classic global <script>s (or served as-is,
  // untouched by Vite's module graph), so ESLint's own module-mode
  // parser rejects real, harmless patterns a global script permits
  // (duplicate top-level var declarations across sibling files that
  // never load together, ASI edge cases). Not Mill's own hand-written
  // code -- same carve-out check-loc.sh/`.golangci.yml` already give
  // vendored/generated trees.
  { ignores: ['dist', 'bindings', 'public/vendor'] },
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
  {
    // Goal 0313's own gate, the `.catch(console.error)` class: a
    // rejected promise a user-initiated command started has exactly
    // ONE legal door (shared/commands.ts's runCommand, which posts the
    // footer notice), and everything else has exactly one other
    // (shared/background.ts's background(), which tags and counts it).
    // These three selectors ban the shapes that used to bypass both --
    // an empty arrow, console.error/console.warn passed straight to
    // .catch, and a bare `noop`.
    //
    // no-floating-promises (type-aware) is ALSO on, at ignoreVoid: true
    // rather than the stricter false: a full sweep at ignoreVoid: false
    // found 386 pre-existing violations repo-wide (goal 0313's own
    // measurement) -- almost all the codebase's own established `void
    // fn()` idiom for "started, not awaited", not a new dropped-
    // rejection class this goal exists to close. Ratcheting that whole
    // set to `false` is real, separately-scoped follow-up work, not a
    // one-line flip; `true` still catches a BARE floating call (no
    // void, no await, no .catch) -- the actual gap this goal closes.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='catch'][arguments.0.type='ArrowFunctionExpression'][arguments.0.body.type='BlockStatement'][arguments.0.body.body.length=0]",
          message: 'A dropped rejection is a silent failure: route it through runCommand or background(p, source) (goal 0313)',
        },
        {
          selector: "CallExpression[callee.property.name='catch'][arguments.0.object.name='console']",
          message: 'A dropped rejection is a silent failure: route it through runCommand or background(p, source) (goal 0313)',
        },
        {
          selector: "CallExpression[callee.property.name='catch'][arguments.0.name='noop']",
          message: 'A dropped rejection is a silent failure: route it through runCommand or background(p, source) (goal 0313)',
        },
      ],
    },
  },
  {
    // Goal 0184 RESEARCH VERDICT: `page.mouse.*` dispatches raw CDP
    // input with NONE of Playwright's actionability checks (no
    // hit-target retargeting, no Visible/Stable/Receives-Events wait) --
    // a UI element that grows over a spec's click/drag point silently
    // hits the wrong element instead of failing loudly at the click. No
    // existing eslint-plugin-playwright rule covers this (checked the
    // full v2.11.0 rule table; prefer-locator only covers deprecated
    // selector-taking page methods), so this is a custom core-ESLint
    // ban. Scoped to spec files only -- e2e/fixtures/** is exempt by
    // the glob itself, since raw primitives belong ONLY inside the
    // promoted helpers that carry the checked-start/checked-end
    // contract (fixtures/atlasBoard.ts's dragBetween/dragResizeHandle,
    // fixtures/canvas.ts's dragBetweenHandles/dragNodeBy,
    // fixtures/pointer.ts's wheelAt).
    files: ['e2e/**/*.spec.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.object.name='page'][callee.object.property.name='mouse']",
          message: 'page.mouse.* has no actionability checking -- use a checked-drag/click fixture helper (e2e/fixtures/atlasBoard.ts, fixtures/canvas.ts, fixtures/pointer.ts) instead, or eslint-disable-next-line with a reason if genuinely uncheckable (goal 0184).',
        },
      ],
    },
  },
)
