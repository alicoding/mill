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

## Acceptance (checkable)

- [ ] The attended-automation research is recorded here (per-tool,
      primary sources): what non-developers actually automate.
- [ ] The everyday-task inventory is recorded with the
      today/needs-step/out-of-boundary mapping, each needs-step row
      pre-judged against ADR-0035.
- [ ] The differentiation statement drafted for SPEC §0 (recorded
      here; SPEC edit rides the goal that consumes it).
- [ ] The one-sentence explanations exist and the owner has
      field-tested one (their report recorded here).
