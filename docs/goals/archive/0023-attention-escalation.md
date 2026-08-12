# 0023 — Attention escalation: decisions reach the human wherever they are

## Goal
A parked decision (MCP write, guardrail ask) reliably reaches the
owner — including away-from-this-Mac — closing the twice-observed miss
("still very much background-ish pattern and not user attention
pattern"). Layered per the ADR-0032 research + owner discussion.

## Plan
1. [x] Floating approval prompt — the incoming-call/askpass pattern:
   an always-on-top mini-window Mill draws over whatever app is
   focused when a decision parks, Approve/Deny inline. REUSES the
   Quick Panel's second-window mechanism (ADR-0033); same
   focus-yield-on-dismiss mitigation. Built: `main.go`'s
   `approvalprompt` window (Hidden/Frameless/DisableResize/520×200/
   WindowCentered/Floating/CanJoinAllSpaces/HideOnEscape, deliberately
   NOT HideOnFocusLost), `SettingsService.SetApprovalPromptWindow`/
   `showApprovalPrompt`/`DismissApprovalPrompt`
   (settingsservice_approvalprompt.go), `app/ApprovalPrompt(App).tsx`
   at the `#/approvalprompt` hash route — shows the oldest unresolved
   pending item, Approve/Deny for an MCP write, "Open in Mill" for a
   guardrail/human-review park (never blind-approve). E2e-covered
   (`e2e/approval-prompt.spec.ts`); window-level behavior (floating
   level, backend-triggered Show, Escape, focus-yield) stays
   manual-only per `.claude/rules/testing.md`.
2. [x] Idle-aware presence gate: replace `document.hasFocus()` (a
   focused window on an unattended Mac suppressed the notification by
   design — observed live) with system idle time; "present" =
   recently-active, not merely focused. Research the cgo-free macOS
   idle-seconds option first. Built: `internal/adapters/idletime`
   (`ioreg -c IOHIDSystem`'s `HIDIdleTime` counter, zero cgo, no TCC
   gate — confirmed directly; unit-tested against a captured real
   sample). The presence decision moved backend-side:
   `SettingsService.isAway(focused)` — away = unfocused OR
   idle≥threshold (default 300s, a Settings knob,
   `GetAttentionIdleThreshold`/`SetAttentionIdleThreshold`) — and
   `NotifyPendingApproval` now takes the frontend's own
   `document.hasFocus()` as a param instead of gating client-side. An
   idletime read error (server mode, or a real desktop failure) fails
   TOWARD away, per §8's fail-safe posture.
3. [x] Alert-style notification guidance: request .alert
   authorization; Settings copy documents the System Settings →
   Mill → Alerts toggle (Duo's own documented ask — banners
   auto-dismiss in ~5s, structurally background-ish). Also verify
   notification delivery under the dev bundle's ad-hoc signature
   (ADR-0032's named unknown; owner observations pending). Checked
   directly against the pinned notifications module source
   (`notifications_darwin.m`): `RequestNotificationAuthorization` has
   no per-type parameter — it always requests
   `UNAuthorizationOptionAlert | Sound | Badge` as one fixed bundle,
   so there's nothing to select beyond calling it, which `notify.Start`
   previously never did at all (a real, now-closed gap) — backgrounded
   so app startup never blocks on the permission dialog. Settings
   copy added naming the System Settings → Notifications → Mill →
   Alerts toggle. Notification-delivery-under-dev-signing verification
   stays an owner on-machine check, unblocked but not performed here.
4. [x] Cross-device forward: Settings-configured forward of
   pending-decision events to the owner's OWN HTTPRequest (ntfy/
   Telegram/etc.) — §1.1-clean (user-configured connector), the only
   layer that reaches the owner at the work machine. Built:
   `composition.SendJSONWebhook` (the exact transport tail
   integration-http/decision-outcome's own webhook already share —
   never a second HTTP client), `SettingsService.ForwardPendingApproval`
   (fire-and-forget, default off, gated on enabled+configured, fires
   `{kind, id, description, createdAt}` as the request's whole body,
   independent of the presence gate), a Settings section (enable
   toggle + the ADR-0009 `EntityRefField` request picker, reused
   directly — `views/` importing `configure/` is allowed by
   `.dependency-cruiser.cjs`). Go-tested against a local `httptest`
   server via the `SetHTTPRequestLookup` seam.

## Acceptance
Owner at another machine (or idle) learns of a parked decision within
seconds via at least one configured layer, and can resolve it from the
floating prompt on return; the focused-but-idle suppression case is
demonstrably fixed.
