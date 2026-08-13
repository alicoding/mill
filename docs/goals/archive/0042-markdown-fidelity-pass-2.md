# Goal 0042 — Confluence markdown fidelity, pass 2: close the pinned degradations

Owner-picked 2026-08-13 from the post-0041 planning round. Successor
to goal 0021 Phase 4's first pass (PR #78), which fixed the
table-structure loss and pinned five known degradations as goldens in
`internal/adapters/markdown/testdata/confluence/` with named
follow-up candidates. This goal implements those five.

## Goal

The five degradations the corpus currently pins become correct
conversions, each proven by updating its existing golden:

1. **Code-block language hint** — parse Confluence's
   `data-syntaxhighlighter-params="brush: java; ..."` into a fenced
   block's language (` ```java `), the shim the reference Python
   exporter hand-rolls for the same reason (the library only reads
   `language-*` classes).
2. **Task-list checkboxes** — `ul.ak-task-list` /
   `li[data-task-state]` becomes GFM `- [ ]` / `- [x]`.
3. **Emoji fallback** — `img.emoticon[data-emoji-fallback]` emits the
   fallback text/emoji instead of today's dead relative image link
   (currently the worst-case output: worse than dropping).
4. **Panel type** — info/note/warning/tip panels keep their type in
   the output (blockquote with a leading bold label, e.g.
   `> **Warning:** ...` — match what confluence-markdown exporters
   converge on rather than inventing).
5. **Expand macro** — `div.expand-container` becomes
   `<details><summary>` (HTML-in-markdown is valid GFM; the reference
   exporter does exactly this).

## Plan

Custom rules registered on the adapter's converter (the library's v2
Register API), Mill-owned code in `internal/adapters/markdown/` —
commodity library, domain-owned conversion policy, consistent with
the ports/adapters boundary. Check the library's own extension docs
for the idiomatic registration shape before writing. Each rule's
fixture golden updates in the same change; the corpus test is the
proof. Delegated build once scoped; the five selectors and reference
behaviors are recorded in goal 0021's Phase 4 research section.

## Acceptance (checkable)

- [x] All five cases' goldens show the corrected output (no
      pinned-degradation wording left for them in the test names).
- [x] The seven already-correct cases' goldens unchanged.
- [x] Full local gate suite green; PR merged green.
- [x] Goal 0021's Phase 4 assessment table updated to reflect the new
      verdicts (this goal referenced from there).
