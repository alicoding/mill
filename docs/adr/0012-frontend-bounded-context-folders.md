# ADR-0012: Frontend bounded-context folders + `dependency-cruiser`

## Status
accepted

## Context

Raised directly by the user: `frontend/src/` is entirely flat — 43
files (`ConfigureIntegration.tsx`, `CompositionCanvas.tsx`,
`NodeInspector.tsx`, `EntityRefField.tsx`, ...) sitting in one
directory with nothing enforcing which files may depend on which. The
Go side already has real bounded contexts (`internal/domain/*`,
`internal/adapters/*`, CLAUDE.md's own ports/adapters rule) — the
frontend never got the equivalent. Asked for specifically: a rule, and
an existing tool ("commodity") that enforces it, not a hand-rolled
check.

## Research

Searched rather than assumed. Real candidates:
- **`@nx/enforce-module-boundaries`** — tied to Nx monorepo tooling.
  Rejected: Mill is a single Go module + single frontend package
  (`docs/SPEC.md` §1.3 already `PARKED` npm workspaces until a second
  JS package exists); adopting Nx for one ESLint rule is exactly the
  disproportionate-dependency trap `.claude/rules/architecture.md`
  warns against.
- **`eslint-plugin-boundaries`** (MIT, v7.1.0, actively maintained) —
  tried first. ESLint-native (Mill already runs ESLint via Lefthook +
  CI, zero new pipeline), real-time in-editor feedback, and its own
  model is literally "the directory tree is the source of truth" —
  folders map to element types, import rules declared between them.
  **Abandoned after extensive debugging, not a quick pass**: neither
  `element-types`/`dependencies`'s `rules:` key nor its `policies:`
  alias (the two candidate option shapes found across the plugin's own
  docs vs. real upstream test fixtures) actually matched any file
  against its own declared patterns in this project's setup — confirmed
  by instrumenting the plugin's own compiled source
  (`Settings.js`'s `getNormalizedRootPath`,
  `@boundaries/elements/dist/index.js`'s `isMicromatchMatch`) with
  temporary trace prints: `rootPath` resolved correctly, but the
  pattern-matching function itself never fired. Reproduced the exact
  pattern/config shape from the plugin's own real upstream test
  fixtures (fetched via `gh api repos/javierbrea/eslint-plugin-
  boundaries/...`) and it still failed against the real ESLint CLI in
  this repo. Judged not worth further reverse-engineering time against
  a third-party plugin's internals for a problem with a viable
  alternative — see `.claude/rules/testing.md`-adjacent judgment call:
  diminishing returns on an unreproducible integration issue.
- **`dependency-cruiser`** (MIT, v18.1.1, actively maintained) — a
  standalone CLI, not an ESLint plugin: a `.dependency-cruiser.cjs`
  config declares `forbidden` rules as plain `from`/`to` regex path
  pairs over the real module graph (via its own TS-aware resolver, not
  ESLint's). **Chosen**: worked correctly on the first real run against
  this project, and correctly caught a deliberately-reintroduced
  violation on verification (see Consequences). Slightly different
  feedback loop than an ESLint plugin (a separate command, not inline
  squiggles) — accepted, since it's wired into the same Lefthook/CI
  path every other repo-wide check (`check-loc.sh`,
  `check-rules-frontmatter.sh`) already uses, so it still blocks a
  violation before it lands, just via `npm run boundaries` rather than
  `npm run lint`.

## Decision

### 1. Real folders, not just a lint config pointed at nothing

`frontend/src/` reorganized into five element types (`git mv`,
history preserved):

- **`app/`** — the shell only: `App.tsx` (+ `.module.css`), `main.tsx`,
  `theme.ts`, `navIcon.ts`, `vite-env.d.ts`, `index.css`.
- **`views/`** — top-level pages with no deep sub-structure:
  `ActivityView.tsx`, `RunsView.tsx`, `SettingsView.tsx`,
  `SpecView.tsx` (+ `SpecView.module.css`), `CapabilityIndex.tsx`,
  `PlaceholderView.tsx`.
- **`composition/`** — the Composition canvas domain (§3):
  `CompositionView.tsx` (+ `.module.css`), `CompositionCanvas.tsx`
  (+ `.module.css`), `CanvasNodeView.tsx`, `canvasStore.ts`,
  `canvasConstants.ts`, `canvasConversion.ts`, `canvasLayout.ts`
  (+ test), `NodeInspector.tsx`, `NodePalette.tsx`,
  `DecisionEdgeInspector.tsx`, `IntegrationBindingsEditor.tsx`,
  `ChildWorkflowBindingsEditor.tsx`, `draftWorkflowSchema.ts`,
  `rfNodeTypes.ts`, `nodeKind.ts`, `ruleTranslate.ts` (+ test),
  `hotkeyCapture.ts`, `CompositionCapabilityMap.tsx`.
- **`configure/`** — the Configure domain (§3.5): `ConfigureView.tsx`,
  `ConfigureIntegration.tsx`, `ConfigureLists.tsx`,
  `ConfigureAttributes.tsx`, `ConfigureMCPServers.tsx`,
  `ConnectorForm.tsx`, `ManualSchemaEditor.tsx`, `openapiSynth.ts`
  (+ test), `EntityRefField.tsx`.
- **`shared/`** — domain-agnostic, used by more than one of the above:
  `store.ts` (global Zustand state — read by `app/App.tsx` **and**
  every view), `Tabs.tsx` (+ `.module.css`, a generic headless-Tabs
  wrapper — used by both `configure/ConnectorForm.tsx` and other
  domain UI), `configSchema.ts` (+ test — the typed-field-to-zod-schema
  mechanism, used by both a composition NodeType's ConfigFields and a
  configure operation's fields), `LiteralOrAttributeField.tsx`,
  `keybinding.ts` (+ test — consumed by both `views/SettingsView.tsx`
  and `composition/hotkeyCapture.ts`), `ListCard.module.css` (a
  genuinely shared stylesheet, consumers across every folder above,
  never 1:1 co-located).

  `store.ts`/`Tabs.tsx` were *originally* placed in `app/` in this
  ADR's first draft, on the assumption that "global app state" and
  "the app shell" were the same bounded context. Wrong, caught by the
  tool itself, not by re-reading the code: the first real
  `dependency-cruiser` run against the reorganized tree flagged 9 files
  across `views/`, `composition/`, and `configure/` importing from
  `app/` — every one of them importing `store.ts` or `Tabs.tsx`, none
  of them importing anything else app-shell-specific. That's the
  definition of `shared/`, not `app/`; moved accordingly. Left in as a
  concrete instance of why the *enforcement tool ran once before
  trusting the folder map*, not just designed on paper.

  `EntityRefField.tsx` goes in `configure/` even though its current
  only caller is `composition/NodeInspector.tsx` — its own job (present
  Configure-domain entities as a picker) is what it *is*, not who calls
  it; `composition → configure` is an intentionally allowed import
  direction (a workflow node legitimately references a configured
  Connector/List/MCP Server/Workflow), the reverse is not.

### 2. Boundary rules (`dependency-cruiser`, `.dependency-cruiser.cjs`)

```
shared      -> (nothing else)                        (leaf — no upward deps)
configure   -> shared                                 (must not depend on composition)
composition -> configure, shared                      (may reference configured entities)
views       -> composition, configure, shared          (a page composes domain UI)
app         -> composition, configure, views, shared   (the shell wires everything)
```

Enforced via `frontend/.dependency-cruiser.cjs`'s `forbidden` rules
(regex `from`/`to` path pairs, `severity: 'error'`), run as
`npm run boundaries` (`depcruise -c .dependency-cruiser.cjs src`),
wired into both Lefthook (`boundaries` job, mirrors the `eslint` job's
glob) and CI (`.github/workflows/ci.yml`'s `frontend` job, right after
`npm run lint`) — blocking in both, same tier as every other check.

## Consequences

- **Locks**: the five-folder element-type map above,
  `dependency-cruiser` as the enforcement tool, the allowed-
  import-direction table.
- Every relative import across all 46 moved files needed updating
  (`./X` → `../composition/X` etc., plus one extra `../` level on every
  `../bindings/...` reference) — mechanical, verified by `tsc` failing
  loudly on anything missed, not assumed correct.
- Verified the tool actually catches violations, not just passes on an
  already-clean tree: after the initial clean run (94 modules, 271
  dependencies, zero violations), deliberately added
  `import { useCanvasStore } from '../composition/canvasStore'` to
  `configure/ConfigureIntegration.tsx` and re-ran — correctly flagged
  `configure-must-not-depend-on-composition`. Reverted the test import
  before committing.
- New frontend files land in their bounded-context folder from
  creation, not flat-then-reorganized later — the discipline this ADR
  exists to establish, not a one-time cleanup.
- Documented in `.claude/rules/frontend.md` as a standing rule.
