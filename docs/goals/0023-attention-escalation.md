# 0023 — Attention escalation: decisions reach the human wherever they are

## Goal
A parked decision (MCP write, guardrail ask) reliably reaches the
owner — including away-from-this-Mac — closing the twice-observed miss
("still very much background-ish pattern and not user attention
pattern"). Layered per the ADR-0032 research + owner discussion.

## Plan
1. [ ] Floating approval prompt — the incoming-call/askpass pattern:
   an always-on-top mini-window Mill draws over whatever app is
   focused when a decision parks, Approve/Deny inline. REUSES the
   Quick Panel's second-window mechanism (ADR-0033); same
   focus-yield-on-dismiss mitigation.
2. [ ] Idle-aware presence gate: replace `document.hasFocus()` (a
   focused window on an unattended Mac suppressed the notification by
   design — observed live) with system idle time; "present" =
   recently-active, not merely focused. Research the cgo-free macOS
   idle-seconds option first.
3. [ ] Alert-style notification guidance: request .alert
   authorization; Settings copy documents the System Settings →
   Mill → Alerts toggle (Duo's own documented ask — banners
   auto-dismiss in ~5s, structurally background-ish). Also verify
   notification delivery under the dev bundle's ad-hoc signature
   (ADR-0032's named unknown; owner observations pending).
4. [ ] Cross-device forward: Settings-configured forward of
   pending-decision events to the owner's OWN HTTPRequest (ntfy/
   Telegram/etc.) — §1.1-clean (user-configured connector), the only
   layer that reaches the owner at the work machine.

## Acceptance
Owner at another machine (or idle) learns of a parked decision within
seconds via at least one configured layer, and can resolve it from the
floating prompt on return; the focused-but-idle suppression case is
demonstrably fixed.
