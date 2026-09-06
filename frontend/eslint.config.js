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
    // Every user-facing string is a locale key (goal 0341,
    // .claude/rules/ux-writing.md). This is the gate: mode 'all'
    // (not the plugin's jsx-text-only default) validates every string
    // literal AND every template quasi in src/, so an attribute
    // (aria-label, title, placeholder), an object-literal registry
    // entry and a `${a} - ${b}` join are all covered -- the three
    // places hardcoded English survived goal 0338's locale-JSON sweep.
    //
    // words.include is what makes mode 'all' usable instead of
    // thousands of hits on ids, css classes, testids and enum values:
    // ONLY a copy-SHAPED literal is validated -- one that starts with
    // a capital and contains a space (a sentence or a label), or one
    // that carries a dash clause in any position (the template-join
    // shape, which is a sentence's second half). Everything else is a
    // token, and a token is not copy. An `include` list means the rule
    // never has to enumerate what to ignore.
    //
    // KNOWN HOLE, covered elsewhere: the rule's own VariableDeclarator
    // visitor skips the entire initializer of any SCREAMING_CASE const,
    // so `export const COMMANDS = [...]` and every other module-scope
    // registry is invisible to it. shared/copy.test.ts pins those
    // instead, asserting each registry's label resolves to a real
    // bundle entry rather than falling through as its own key.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': ['error', {
        mode: 'all',
        'should-validate-template': true,
        words: {
          // RegExps, not the plugin's string form: a string pattern is
          // anchored (^...$) before matching, and a template literal's
          // quasi is TRIMMED before it reaches here, so a dash-clause
          // fragment (" — welcome back") could never be expressed as an
          // anchored whole-string pattern.
          include: [
            // A sentence or a label: capital first, at least one space.
            /^[A-Z][^\n]*\s[^\n]*$/,
            // A dash CLAUSE: a spaced double hyphen, em dash or en
            // dash with content on at least one side -- the shape
            // scripts/check-ui-copy.sh bans in copy, whether it sits
            // inside one string or straddles a template join (where the
            // dash lands at a trimmed fragment's edge). An UNSPACED
            // dash is not a clause: `var(--fgColor-muted)` is a CSS
            // custom property and "1\u201325 of 40" is a range, the one
            // legitimate dash in copy. A dash ALONE ("\u2014" as an
            // empty-cell placeholder) is typography, not a sentence.
            /\S\s(--|[\u2014\u2013])(\s|$)/,
            /(^|\s)(--|[\u2014\u2013])\s\S/,
          ],
        },
        callees: {
          // The plugin's own defaults (t, i18n, require, DOM event
          // names, ...) plus: copy()/copyText(), which TAKE a key;
          // console.*, which writes to devtools and never to the
          // screen; and Error, whose message is a developer diagnostic
          // unless a surface deliberately renders it (those call copy()
          // for the text, so they are covered by the copy() arm).
          exclude: [
            'i18n(ext)?', 't', 'copy', 'copyText', 'require', 'console\\.\\w+', 'Error',
            'addEventListener', 'removeEventListener', 'postMessage', 'getElementById',
            'dispatch', 'commit', 'includes', 'indexOf', 'endsWith', 'startsWith',
          ],
        },
      }],
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
        {
          // Goal 0346: an inventory row's actions are registry commands
          // with the row's own context, never closures authored inline
          // on the row -- a closure there exists nowhere but that
          // render, so the action is unreachable from the palette,
          // unbindable, and its label duplicated per surface.
          // InventoryMenuAction no longer HAS an onClick, so TypeScript
          // already refuses one written directly in an
          // `menuActions: [...]` literal; this catches the same
          // property arriving through a helper or a spread, where
          // excess-property checking does not reach.
          selector: "Property[key.name='menuActions'] ArrayExpression > ObjectExpression > Property[key.name='onClick']",
          message: 'A row action is a registry command plus the row context ({ commandId, ctx }), never an inline closure -- add the action to its family descriptor in shared/configureRowCommands.ts (goal 0346).',
        },
        {
          // Goal 0346 slice B: a context-menu item is a registry
          // command plus its target, never a closure. ContextMenuItem
          // no longer HAS a run, so TypeScript refuses one written
          // directly in an `items: [...]` literal; this catches the
          // same property arriving through a helper, a spread or an
          // `as ContextMenuItem` cast, where excess-property checking
          // does not reach. Matched on the shapes' own literals: an
          // object inside an `items` array, or one annotated/cast as a
          // ContextMenuItem.
          selector: ":matches(Property[key.name='items'] ArrayExpression > ObjectExpression, Property[key.name='submenu'] ArrayExpression > ObjectExpression, TSAsExpression[typeAnnotation.typeName.name='ContextMenuItem'] > ObjectExpression, VariableDeclarator[id.typeAnnotation.typeAnnotation.typeName.name='ContextMenuItem'] > ObjectExpression, ArrowFunctionExpression[returnType.typeAnnotation.typeName.name='ContextMenuItem'] > ObjectExpression) > Property[key.name='run']",
          message: 'A context-menu item is a registry command plus its target ({ commandId, ctx }), never an inline closure -- register the command (shared/atlasSelectionCommands.ts, shared/canvasCommands.ts, an entity family) and hand it the context (goal 0346 slice B).',
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
