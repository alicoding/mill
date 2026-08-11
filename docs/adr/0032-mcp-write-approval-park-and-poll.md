# ADR-0032 — MCP write approval: park-and-poll lifecycle + away-user attention layer

Status: accepted (owner-ratified 2026-08-11, direction approved directly
in session after the research pass below; supersedes the *mechanism* of
ADR-0017's per-write synchronous approval and ADR-0022's MCP section —
the *policy* they decided is unchanged: writes default off, approval
required by default when enabled, deny writes nothing, secrets stay
human-only, `resolve_approval` stays excluded).

## Context

Live failure, observed 2026-08-11: the owner was away from the Mill
window while an external MCP client (a Claude session) requested a
workflow write. The in-app approval banner assumed co-presence; the
120-second in-process wait expired unseen and the write failed closed.
The owner asked for the industry pattern research directly ("in-app
request assumes user is actively on the screen").

A primary-source research pass (Duo Push, GitHub device flow/RFC 8628,
Slack/Teams approval cards, PagerDuty escalation, macOS TCC, Claude
Code's own `canUseTool` gate, Apple HIG, the MCP 2026-07-28 spec + Tasks
extension SEP-2663, the pinned `modelcontextprotocol/go-sdk` v1.7.0 and
`wailsapp/wails` v3.0.0-beta.4 sources) produced two independent
condemnations of the current shape:

1. **No surveyed product fail-closes a human approval on a ~2-minute
   window aimed at a possibly-away user.** Short windows exist only for
   live, phone-in-hand interactions (Duo: 60s). Everything built for an
   away approver is durable and/or escalating (Slack/Teams cards never
   expire by default; PagerDuty escalates; GitHub's inbox retains).
   The closest architectural sibling to Mill's exact situation — Claude
   Code's own tool-permission callback — has **no timeout at all**: the
   decision stays pending indefinitely and the *caller's* side bears
   the waiting cost, never the approver.
2. **The blocking mechanism itself plausibly already fails against real
   hosts.** Claude Code's HTTP-transport MCP connections carry a
   default **60-second to-first-byte timer**, separate from and
   stricter than the tool timeout — Mill's 120s blocking HTTP response
   (StreamableHTTP, no progress notifications) plausibly dies at the
   transport layer before Mill's own timeout fires, so a real host sees
   a transport error, not Mill's clean retry message. This was
   ADR-0017's own open sub-question #1 ("does a real MCP host tolerate
   a long-blocking tool call"), now answered: no, not reliably, not
   over HTTP.

Also verified against pinned versions, not master: the MCP **Tasks**
extension (2026-07-28 spec) is exactly the standardized shape for this
(immediate `CreateTaskResult`, `input_required` state, `tasks/get`
polling) but `go-sdk` v1.7.0 does not implement it (its own ROADMAP
lists it unstarted) and a client must opt in to the capability — not
adoptable today. Wails3 v3.0.0-beta.4 **does** ship, today, zero new
dependencies: `NotificationService` with real UNUserNotificationCenter
actionable categories (`SendNotificationWithActions`,
`OnNotificationResponse` — requires a bundle ID + signing, which
`mill.dev.app` and the installed `.app` both have; hard-fails
gracefully detectable at `Startup`) and `DockService.SetBadge`. Dock
bounce (`requestUserAttention`) landed upstream 2026-08-09, four days
after beta.4 — unavailable without a dependency bump. MCP elicitation
was confirmed the wrong tool structurally: it reaches the *client's*
user; Mill's approver is the *server's* owner.

## Decision

Three parts, one principle: **the request is durable and the caller
never blocks; attention is layered by presence.**

### 1. Lifecycle: park-and-poll (the RFC 8628 / MCP-Tasks shape, hand-rolled)

- A gated write tool call (`import_*`, `update_workflow`,
  `publish_workflow`, `delete_workflow`, …) with per-write approval on
  first waits a **short in-call courtesy window (10s)** — a co-present
  approver keeps today's one-call flow, and 10s sits safely under the
  60s transport timer. If still undecided, the call returns
  **immediately and successfully** with a parked result: a clear text
  contract — `parked pending human approval; id=<X>; call
  check_write_status with this id` — never an error (an error would
  train the client to give up, not poll).
- The pending record carries **the write itself** (tool name + raw
  arguments), not a live channel: on approval the write executes
  server-side in Mill, whether or not the requester still exists. This
  is the pivot that makes durability free — the record (id,
  description, tool, args, createdAt) persists via the settings store
  and **survives a Mill restart**; an in-memory channel dies with the
  process, which the research showed is the wrong place to hold a
  human's pending decision.
- New ungated read tool **`check_write_status {id}`** returns
  `pending | approved | denied | expired`, plus the executed write's
  own result text on approval (the minted entity ID) or the denial
  reason. Outcomes are retained 24h for polling, then swept.
- **Expiry: 24 hours**, matching the guardrail park's existing timeout
  (§8) — symmetry, not a new number. Expiry and denial both keep
  writing the existing `mcp-write` Activity row (goal 0005 item 3),
  outcome `expired`/`denied`; nothing is ever traceless.
- Unchanged policy (ADR-0017): writes-enabled toggle default off;
  per-write approval default ON when writes are enabled; deny/expiry
  writes nothing; a write executes at-most-once (approving an already
  resolved or expired id is a no-op error).
- When the go-sdk ships Tasks AND a real client declares the `tasks`
  capability (goal 0005's existing trigger, reaffirmed), this store
  becomes the Tasks handler's state — same
  pending/approved/denied model, minimal rework by construction.

### 2. One durable pending store, surfaced in the Review queue

Pending MCP writes join the **Review queue** (`ReviewView`) as
actionable rows — distinct icon/wording from guardrail parks and debug
parks ("recognition, not confirmation") — alongside the existing
banner, which stays as the co-present shortcut. One store
(`PendingMCPWrites` + persisted records), multiple surfaces reading it;
never a second competing pending-store (goal 0005's "three surfaces
subscribe to slices of ONE signal"). The sidebar badge already sums
this channel; unchanged.

### 3. Attention layer for the away user (zero new dependencies)

- **Dock badge**: the total pending-decision count (guardrail parks +
  MCP writes — the badge the sidebar already computes) mirrors to
  `DockService.SetBadge`, cleared at zero. Wiring: the frontend already
  owns the summed count; one bound `SettingsService` RPC applies it.
- **Actionable OS notification**: on a new pending item while the
  window is **unfocused** (`document.hasFocus()` gate, frontend-side —
  a present user is never double-noised), Mill sends a real
  UNUserNotificationCenter notification. For an MCP write it carries
  **Approve / Deny action buttons** resolving directly from the
  notification (`OnNotificationResponse` → `ResolveMCPWrite`), per
  Apple HIG's own "simple tasks without opening the app" guidance. For
  a guardrail/human-review park the notification opens/focuses the
  window instead (typed input may be required; blind approval from a
  notification is not offered).
- Desktop-only: the notification/dock services follow
  `internal/adapters/hotkey`'s build-tag split (server mode gets a
  no-op stub); a missing bundle ID degrades to log-and-continue,
  matching `launchatlogin.ErrNotAppBundle`'s pattern.

## Alternatives rejected

- **Keep the 120s blocking wait (status quo)** — condemned twice over:
  no precedent, and mechanically unsound against real HTTP hosts
  (60s first-byte timer).
- **Adopt MCP Tasks now** — correct destination, unimplementable
  today (no go-sdk support at pinned v1.7.0; requires client opt-in).
  The park-and-poll store is designed to become its handler.
- **MCP elicitation** — structurally wrong: asks the client's human,
  and Mill's approver is the server's owner.
- **Unbounded blocking wait (Claude Code's literal shape)** — right
  timeout policy, wrong transport: over StreamableHTTP the connection
  dies long before the human returns; blocking is only viable for
  in-process callbacks, which this isn't.
- **DBOS-parking the write** (ADR-0022's rejected option, rechecked) —
  still rejected for the RPC itself (an MCP call is not a Mill run),
  but the research sharpened the split: the *pending-decision record*
  is what must be durable, and the settings store already gives that
  without minting a synthetic run.
- **Dock bounce in v1** — needs a Wails beta.6+ bump for a cosmetic
  escalation; named future work, not force-fitted.

## Consequences

- Existing Go/e2e tests asserting the synchronous contract
  (`TestMCPWriteTools_PerWriteApproval` et al.) are reworked to the
  new contract, preserving the invariants: deny writes nothing,
  approve executes exactly the parked write, default-on approval.
- MCP clients see a changed (documented, in-band) response text for
  gated writes; the courtesy window keeps the co-present case
  one-call.
- Two named empirical checks remain open, deliberately not blockers
  (the design removes the dependency on their answers): whether the
  dev bundle's ad-hoc signature delivers notifications in practice
  (on-machine check; degrade path exists either way), and the exact
  behavior of Claude Code's 60s timer against a parked-then-returned
  response (moot under park-and-poll, worth confirming for the record).
- ADR-0017's status gains a pointer here; SPEC §3.6 (MCP approval
  paragraph) and §3.7 (the notifications `OPEN` item, now partly
  resolved by this) update in the implementing change.
