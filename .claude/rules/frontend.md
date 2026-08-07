---
globs:
  - "frontend/src/**/*.tsx"
  - "frontend/src/**/*.ts"
---

# Frontend conventions

Before writing a new collection-rendering surface (a `.map()` over an
array producing JSX — a palette, an index/list page, a picker, a table),
check `@primer/react`'s list/data-display family for a component that
already matches the collection's real shape, before hand-assembling one
from styled `<div>`s:

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

Picking Primer for the individual pieces (a `Stack`, an `IconButton`)
does not satisfy CLAUDE.md's "don't hand-roll bespoke components" rule
on its own if the *structure* around them — the grouping, the hierarchy,
the collapse behavior — is still hand-assembled. That's the same rule,
one level down. Full reasoning and the real miss that surfaced this:
`docs/SPEC.md` §9.1.
