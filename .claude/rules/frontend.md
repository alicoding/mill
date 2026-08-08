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

Historical narrative — the real miss that surfaced both rules above,
and the research behind the component-selection reference — is in
`docs/SPEC.md` §9.1 and §3. This file is the reusable convention to
apply going forward; SPEC.md is the record of why it was adopted.
