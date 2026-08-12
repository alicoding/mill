# 0027 — Core vs composition: the boundary that keeps features cheap

## Goal
Owner-mandated 2026-08-11 ("very critical... worth aligning on the
principle more explicitly"): a hard, written boundary between the
protected platform kernel (stable, changes rarely) and everything
else (which MUST arrive as composition — nodes, triggers, connectors —
never bespoke wiring), so a future capability is an adapter/plugin
afternoon, not a days-long build. Triggered by a live violation WE
shipped hours after writing §9.5's kernel doc: cross-device
notification built as a Settings toggle + private ForwardPendingApproval
code path instead of a communication connector + a composable trigger
(n8n's model, the owner's own framing).

## Plan
1. [ ] **Audit** (read-only, first): inventory every current
   bespoke-wired capability that is composition-shaped — the forward
   toggle (exhibit A), trigger-fire notifications (§3.7's open item),
   the in-app attention wiring, anything else where "the app does X on
   event Y" bypasses the workflow engine. Also: the broken Settings UX
   found live (Forward checkbox untogglable, Away-after stepper renders
   empty) — diagnose as part of understanding the surface.
2. [ ] **Unpark §3.4's System/meta trigger row** (its stated blocker —
   §7's engine — landed long ago): a `trigger-system-event` NodeType
   family (first events: decision-parked / run-failed / run-completed),
   fired by Mill's own engine through the SAME single execution path
   (ADR-0008) — a trigger's output IS the workflow's input, §3.4's
   locked concept, now for internal events.
3. [ ] **Refactor the forward as composition**: a seeded, editable
   built-in workflow (trigger: decision-parked → integration-http via a
   user-picked connector) REPLACES ForwardPendingApproval's private
   path; the Settings section becomes at most a shortcut that authors/
   points at that workflow (settings-as-template-instantiator, decide
   in design). Credentials/connector shared 1:many like every Configure
   entity — the owner's reuse question answered by existing machinery.
4. [ ] **The two contracts, written into SPEC**: (a) platform-internal
   behavior may consume the same trigger/node surface via built-in
   workflows (the app dogfoods its own composition layer — inspectable,
   guarded, in Runs); (b) a small PROTECTED KERNEL list (graph engine,
   guardrail gate, durable execution, registries, Configure recipe,
   MCP plane — §9.5's existing list, now with an explicit
   "changes require an ADR" bar) that composition never reaches into.
5. [ ] **The decision test, one paragraph in CLAUDE.md/rules**: before
   building any capability — "is this a node, a trigger, a connector,
   or a true kernel change?" — with the forward toggle as the recorded
   counterexample. The §3.5 two-axis test extended with the
   composition-first question.

## Acceptance
The forward works as a visible, editable workflow using a real
connector; a second workflow can reuse that connector; the system-event
trigger family exists with seeded proof; the kernel list + decision
test are written; the broken Settings controls are fixed or gone; and
the next communication channel (Discord/Telegram/Twilio) is buildable
as connector-config only — zero new Go paths.
