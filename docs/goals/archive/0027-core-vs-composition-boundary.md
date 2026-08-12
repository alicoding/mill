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
1. [x] **Audit** (read-only, first): inventory every current
   bespoke-wired capability that is composition-shaped — the forward
   toggle (exhibit A), trigger-fire notifications (§3.7's open item),
   the in-app attention wiring, anything else where "the app does X on
   event Y" bypasses the workflow engine. Also: the broken Settings UX
   found live (Forward checkbox untogglable, Away-after stepper renders
   empty) — diagnose as part of understanding the surface. DONE:
   ADR-0035's Context/Decision recorded the audit findings —
   `ForwardPendingApproval` + `NotifyPendingApproval`'s delivery half
   were the only two violations; the "untogglable" report was a
   15-commit-stale binary (goal 0029 tracks the badge fix), not a real
   bug — but the underlying silent-mount-fetch-failure class was real
   (item 4 below).
2. [x] **Unpark §3.4's System/meta trigger row**: `trigger-system-event`
   NodeType (`internal/domain/composition/triggers.go`), four events
   (decision-parked/run-completed/run-failed/run-cancelled), fired
   through the same single execution path (ADR-0008). Dispatch seam:
   `ExecutionService.SetSystemEventSink` / `TriggerService.
   DispatchSystemEvent` (`executionservice_systemevent.go`,
   `triggersystemevent.go`), wired from `main.go`. Loop rule enforced
   at emission: a system-event-triggered run emits no system events of
   its own (n8n's Error Trigger precedent, one hop max).
3. [x] **Refactor the forward as composition**: `ForwardPendingApproval`
   + `composition.SendJSONWebhook` deleted; seeded DISABLED workflow
   "Example: Forward pending approvals" (trigger-system-event
   (decision-parked) → integration-http, reusing the SAME seeded
   HTTPRequest "Example: Approval-gated HTTP call" already references —
   the 1:many Configure-entity reuse proven directly). A startup
   migration note logs once if the old Settings key was present, never
   silently dropping config.
4. [x] **The two contracts, written into SPEC**: `docs/SPEC.md` §9.5's
   Update + §3.7's Update record both — platform-internal behavior may
   consume the composition surface via seeded workflows; the protected
   kernel list (already in §9.5) now carries the explicit "changes
   require an ADR" bar (ADR-0035 itself).
5. [x] **The decision test, one paragraph in `.claude/rules/
   architecture.md`**: "is this a node, a trigger, a connector, or a
   true kernel change?" with the forward toggle as the recorded
   counterexample.

Also delivered, riding this PR (the audit's own robustness finding,
scoped in alongside): `SettingsView.tsx`'s silently-caught mount
fetches (`GetSummonHotkey`/`GetMCPWriteEnabled`/
`GetMCPWriteApprovalRequired`/`GetAttentionIdleThreshold`) now surface
a visible "Couldn't load — the app may need a restart" banner instead
of a permanently-disabled control with no explanation.

## Acceptance
The forward works as a visible, editable workflow using a real
connector — MET (the seeded workflow, disabled by default, re-pointed
by the user). A second workflow can reuse that connector — MET (the
guarded-HTTP example and the forward example share one HTTPRequest).
The system-event trigger family exists with seeded proof — MET
(`triggersvc.TestSeededForwardApprovalsExample_DecisionParked_
PostsRealHTTPCall`, the loop-rule test, the run-completed-both-RunKinds
test, `e2e: seed-completeness.spec.ts`). The kernel list + decision
test are written — MET. The broken Settings controls are fixed or
gone — MET (Forward section deleted; the audited silent-fetch class
fixed for the remaining controls). The next communication channel
(Discord/Telegram/Twilio) is buildable as connector-config only, zero
new Go paths — MET by construction: point a new HTTPRequest at the
target service and re-point the seeded workflow's Integration field.

**DELIVERED 2026-08-12** (this session/PR) — goal 0029 (DEV·live
badge honesty) and goal 0030 (node standard, which
`trigger-system-event` should be reviewed against once written) remain
separately queued, not blocking this goal's own closure.
