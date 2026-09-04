---
paths:
  - "frontend/src/**/*.tsx"
  - "frontend/src/**/*.ts"
---

# Frontend conventions

**Use Primer React (`@primer/react` + `@primer/primitives`), don't
hand-roll bespoke components or CSS.** Verified MIT-licensed, pure
JS/TS (no native/Rust dependency anywhere in its tree), actively
maintained. Ships finished, pre-styled components — import and use
them, don't reassemble primitives from scratch the way shadcn-style
kits require. Where custom CSS is genuinely needed (layout Primer
doesn't cover), write it as a co-located `*.module.css` file consuming
Primer's design tokens (`@primer/primitives` CSS custom properties) —
Primer React v38+ itself dropped `styled-components`/`sx`/`Box` and
directs adopters to CSS Modules + CSS variables instead, so this is the
framework's own current guidance, not an invented preference (see
`docs/SPEC.md` §1.3). Don't add a single global stylesheet or reach for
Tailwind/CSS-in-JS.

**This applies to structure, not just individual widgets.** Before
writing a new collection-rendering surface (a `.map()` over an array
producing JSX — a palette, an index/list page, a picker, a table),
check `@primer/react`'s list/data-display family for a component that
already matches the collection's real shape, before hand-assembling one
from styled `<div>`s. Picking Primer for the individual pieces (a
`Stack`, an `IconButton`) does not satisfy the rule above on its own if
the *structure* around them — the grouping, the hierarchy, the collapse
behavior — is still hand-assembled. That's the same rule, one level
down.

Reference — which component fits which collection shape (checked
directly against the installed version's `.d.ts`/compiled source, not
assumed from docs):

- **`ActionList` / `ActionList.Group`** — titled, divider-separated
  sections, always fully expanded. Use when categorization alone is
  needed, no collapse.
- **`NavList` + `SubNav`** — nav-shaped, collapsible via `defaultOpen`.
  Only fits actual navigation (links, `aria-current`), not a generic
  drag/action source — don't reach for this outside real nav UI.
- **`TreeView`** — genuinely hierarchical + collapsible
  (`TreeView.Item`'s `defaultExpanded`/`expanded`/`onExpandedChange`,
  nested `TreeView.SubTree`). Confirmed `TreeView.Item` spreads
  `...restProps` onto its rendered `<li>`, so `draggable`/`onDragStart`
  pass straight through — safe to use as a drag source.
- **`DataTable`** — tabular data with sort/column semantics.
- **`FilteredActionList`** — a search-filtered single-select combobox
  (active-descendant driven). Fits a command-palette-style picker, not a
  custom-rendered draggable card list — don't force it onto UI that
  isn't fundamentally a select.

Verify against the actually-installed version before relying on any of
the above (`node_modules/@primer/react/dist/<Component>/*.d.ts`) — props
and behavior have shifted across Primer major versions before (see
`docs/SPEC.md` §1.3's CSS-Modules migration).

Disabled interactive elements need `pointer-events: none`, not just
`aria-disabled`/`cursor: not-allowed` — `aria-disabled` alone doesn't
stop the browser from hovering/focusing the element, so a component's
own internal `:hover`/`:focus` styling (often on a hashed inner class
your own CSS can't target) still applies. Prefer overriding the Primer
design *token* the internal rule reads from (e.g.
`--control-transparent-bgColor-hover: transparent`, scoped to your
disabled className) over `pointer-events: none` when the element still
needs to be hoverable for a `title` tooltip explaining why it's
disabled — `pointer-events: none` silently kills that too, since it
stops hit-testing (and therefore `:hover`) entirely.

**`frontend/src/` is organized into bounded-context folders — `app/`,
`views/`, `composition/`, `configure/`, `shared/` — enforced by
`dependency-cruiser` (`npm run boundaries`, wired into Lefthook + CI),
not just a documented convention.** A new file belongs in its
bounded-context folder from the moment it's created, not flat in
`src/` to be reorganized later. Allowed import direction is
`shared ← configure ← composition ← views ← app` (an arrow means "may
import from," never the reverse) — `shared/` is a leaf (no upward
imports at all), `configure/` may only depend on `shared/`,
`composition/` may depend on `configure/` + `shared/` (a workflow node
legitimately references a configured Connector/List/MCP Server), and
so on up to `app/`, which wires everything together. Before adding a
new file, ask which bounded context it belongs to by what it *is*, not
who currently calls it (see ADR-0012's `EntityRefField.tsx` example);
before putting something in `shared/`, confirm it's actually consumed
by 2+ of the other folders — a file used by exactly one caller belongs
in that caller's own folder, not preemptively promoted. Full mapping,
the tool's own config, and the real violation-in-the-making it caught
mid-implementation (a file wrongly placed in `app/` that 9 other files
across three other folders were importing) are in
[`docs/adr/0012-frontend-bounded-context-folders.md`](../../docs/adr/0012-frontend-bounded-context-folders.md).

Historical narrative — the real miss that surfaced both rules above,
and the research behind the component-selection reference — is in
`docs/SPEC.md` §9.1 and §3. This file is the reusable convention to
apply going forward; SPEC.md is the record of why it was adopted.

## Button semantics

Primer's own button-variant convention, adopted systematically rather
than per-page ad hoc (docs/SPEC.md §3.8):

- **(a)** Exactly one `variant="primary"` button per page/region — the
  page-level create CTA, or a form's Save. Never two primaries
  competing in the same view.
- **(b)** Destruction of a persisted entity is `variant="danger"`
  (or `buttonType: 'danger'` on a Dialog footer button) and
  **reversible, not interrogated**: a Configure entity deletes at
  once and offers Undo through the window-pinned toast
  (`configure/deleteWithUndo.ts` → `shared/undoDeleteStore.ts` →
  `shared/UndoDeleteToast.tsx`, goal 0270; the board's quick delete is
  the same law, goal 0093). The confirm dialog
  (`shared/ConfirmDialog.tsx`, `shared/useConfirmDelete.tsx`,
  `InventoryMenuAction.confirm`) is reserved for a delete that
  genuinely cannot be undone or cascades beyond the entity — a
  workflow (runs, schedules), a guardrail rule, a vault secret — and
  a new confirm needs that reason stated at the call site.
- **(c)** A decision pair (approve/deny a guardrail ask, a review
  verdict) is `primary` (affirm) / `danger` (reject) — never both
  neutral, never both colored the same way.
- **(d)** A repeated per-row action (Edit, Export, Run in a list) is
  never `primary`, even when it's the row's main action — repeating a
  primary down every row of a list defeats rule (a)'s "exactly one."
- **(e)** Everything else stays `variant="invisible"` (or the Primer
  default) — neutral, not fighting for attention.

Two deliberate exceptions, not violations of (d): a callable-child
workflow's row demotes its Run to a secondary "Test" button (it can
only ever be invoked by another workflow's Child Workflow node, so a
primary-looking Run there is misleading, not just redundant); per-row
Edit/Export/Duplicate actions in the goal-0007 dense-row pattern are
`variant="invisible"` by design, matching (d) rather than departing
from it.

## Overlay and interaction primitives come from the adopted machinery

Owner-mandated (goal 0124's dropdown regression is the recorded
instance, same session as architecture.md's multi-purpose-surface
rule): anything that floats, anchors, or positions relative to a
trigger — dropdowns, popovers, menus, tooltips, anchored panels —
is built on the adopted kit's overlay machinery (Primer's
ActionMenu/SelectPanel/AnchoredOverlay family, or the canvas
library's own positioning where the element lives on a canvas),
NEVER a hand-positioned floating div. Positioning math, collision
flipping, focus trapping, and dismiss-on-outside-click are
commodity concerns with a mature owner; hand-rolled lookalikes are
exactly the class that regresses silently (a detached, mispositioned
dropdown ships and no assertion catches it). Same test as the
UI-collection rule above, one level down: before positioning
anything yourself, check what the kit's overlay family already
owns. A genuinely canvas-anchored affordance (a handle, an edge
chip) uses the canvas library's coordinate system — still never
ad-hoc `position: fixed` guesses.

## Secure-context-only APIs never get called directly

`navigator.clipboard` and `crypto.randomUUID` exist only in secure
contexts (https or localhost). A Mill server reached over plain http
from another device — the remote-instance posture the product
explicitly supports — has NEITHER, and both classes shipped real
breakage before this rule existed (every copy action silently no-oped;
the workflow editor crashed outright). The rule: any API that MDN
marks "secure context only" is reached through a shared fallback
helper, never called inline — `shared/clipboardWrite.ts` for clipboard
writes, `shared/localId.ts` for local ids. Adding a new
secure-context-dependent capability means adding the next such helper
with an insecure-context fallback (or an honest error the user sees),
plus a unit test pinning the fallback path.

## Error surfacing — a user-initiated failure reaches the user

`.catch(console.error)` is honest only for a background refresh whose
failure leaves a degraded-but-visible state (a stale list, a missing
badge). A failure of something the user just DID — a click, a submit,
a palette command, a drop — must reach them where they acted: the
inline error slot of the form or page, the notice channel
(`shared/notices`, `api.notify` for plugins), or the toast that
offered the action. The console is never the only place. Rider of
goal 0261, owner-raised on the 0258 toggle; the sweep of existing
sites is goal 0313. A new handler that swallows a user action's
failure into the console needs the reason stated at the call site.

## Inspectors and forms disclose in three tiers

Every inspector or entity form has exactly three tiers and at most two
disclosure levels. Tier 1, open by default: what the thing is and does
-- its own parameters. Tier 2, one click: how it behaves -- error
handling, retries, approval and guardrail rules, breakpoints, notes --
in a tab or one disclosure. Tier 3: metadata and docs -- a footer line
or a link out, never above tier 1. Debugging state is never a field
between parameters. Optional fields not yet set hide behind an
"Add ..." affordance. A collapsed tier shows a count or dot when
something inside is set.
