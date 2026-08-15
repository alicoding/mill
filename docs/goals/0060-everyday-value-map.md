# 0060 — Everyday value map: what Mill does for a non-technical person

**Raised:** 2026-08-14, owner: tried explaining Mill to a
non-technical person (a pharmacist) and couldn't land it — the
current demos and step catalog read developer-first (code exec, MCP,
HTTP), and the visible comparison points (cloud workflow tools doing
"client outreach") describe a different product class entirely.
"We need to look at the steps people usually need when they are on a
computer — when the app is on, when do they need it, what a
not-cloud solution serves."

## Goal — research-only, feeds 0056 (workbench) and 0047 (audience facet)

1. **The right mirror:** study the ATTENDED desktop-automation
   field, not the cloud-workflow field — Apple Shortcuts, Keyboard
   Maestro, AutoHotkey, PowerToys, Power Automate Desktop (the
   "attended RPA" category is the industry's own name for
   user-present, app-is-on automation), Hazel (file-event
   automation). What do their non-developer users actually automate?
   Primary sources: their own galleries/template libraries, forums,
   the tasks their marketing leads with.
2. **The everyday-task inventory:** a ranked list of computer
   moments normal people repeatedly handle by hand (clipboard
   chores, downloads-folder tidying, renaming, text reshaping,
   moving data between apps that don't talk, event-triggered
   reminders), each mapped to: Mill can do it today with existing
   steps / needs a step that passes ADR-0035 / out of boundary.
3. **The local-only differentiation, stated plainly:** what
   app-is-on, on-your-machine automation uniquely offers (works on
   whatever is on YOUR screen/clipboard/files; nothing leaves the
   machine; no accounts/subscriptions; guardrails = it asks before
   acting) — as positioning input for SPEC §0.
4. **The explanation test:** produce 2-3 one-sentence explanations
   of Mill a non-technical person can repeat back. Acceptance is
   empirical: the owner tries one on the person who inspired this
   goal.

## Not in scope

Building anything. No cloud connectors, no marketing site. Output is
a recorded research verdict + the inventory + the sentences; build
implications queue as goals only after 0056's boundary verdict.

## Research delivered 2026-08-14 (boxes 1-3; full per-tool links in the session record)

**Per-tool findings (primary sources):** Keyboard Maestro's wiki/forum
converge on text templates, clippings, case/format fixes, batch
renames; AutoHotkey's community staples are snippets/hotstrings,
search-selected-text, timestamps; Hazel's must-have rules are
tidy-Downloads-by-age/type, OCR-based invoice filing,
convert-to-PDF, watched-folder photo sorting; PowerToys' module list
is a map of universal pains (Advanced Paste = clipboard reshaping,
PowerRename = batch rename, Text Extractor = screen OCR); Power
Automate Desktop's attended-RPA framing is Microsoft's own "runs on
the worker's PC so the worker can correct errors" (template gallery
not independently verified this pass). Raycast/Shortcuts galleries
confirm the same clusters without per-item popularity data.

**Everyday-task inventory (ranked by cross-community recurrence):**

| Moment | Mill status |
|---|---|
| Reshape/convert copied text (case, format, template) | Today: clipboard capture → transform → clipboard write |
| Snippets/boilerplate/timestamps on a hotkey | Today |
| Copied table/page → another shape (HTML→Markdown) | Today — literally the shipped floor |
| Meeting-notes / pasted-transcript cleanup | Today (AI step at home; bridge at work) |
| Watch folder, file by name/type/date rules | Today via filesystem watch + run-command — developer-comfortable only; a friendlier move/file step is an open ADR-0035 question |
| Tidy Downloads/Desktop; batch rename | Same as above (run-command composes it; not layperson-authorable yet) |
| OCR/PDF text extraction (content-based filing) | Needs-step — extract-text-from-pdf/OCR capture is plausibly multi-use; judge via ADR-0035 when a real case arrives |
| Batch image resize | Needs-step, same bar |
| Window management, app launching, key remaps, kill-app | Out of lane — OS/window scripting, not a guarded data pipe |

**Local-only differentiation (their communities' own words, drafted
for SPEC §0):** the automated thing is usually *sensitive*
(medical/financial/work files — Hazel's loyal following is exactly
this) or must act on *what is on this machine right now* (clipboard,
screen, Downloads) — which no cloud tool can see. Plus: no accounts,
nothing uploaded, and Mill's own addition the field lacks — it asks
before acting.

**Candidate sentences (box 4's field test pending — owner tries one
on the person who inspired the goal):**
1. "It watches for something you do a lot — like copying text or
   dropping a file somewhere — and finishes the boring part for you,
   on your own computer."
2. "You show it what you want cleaned up once, and after that it
   does that same cleanup by itself, every time, without sending
   anything anywhere."
3. "It's like a helper standing next to your computer who notices
   when you copy or save something and quietly tidies it up the way
   you always do it yourself."

## Acceptance (checkable)

- [x] The attended-automation research is recorded here (per-tool,
      primary sources): what non-developers actually automate.
- [x] The everyday-task inventory is recorded with the
      today/needs-step/out-of-boundary mapping, each needs-step row
      pre-judged against ADR-0035 (judgment deferred to a concrete
      case per the standing rule — the rows name the bar).
- [x] The differentiation statement drafted for SPEC §0 (recorded
      here; SPEC edit rides the goal that consumes it).
- [ ] The one-sentence explanations exist and the owner has
      field-tested one (their report recorded here).
