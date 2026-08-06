# Mill — Living Spec

This document is the single source of truth for what Mill is. It is rendered
inside the Mill app itself (Spec view) so the doc and the app can't silently
drift apart. Edit this file, not a copy of it.

Status key: `LOCKED` (decided), `OPEN` (actively undecided), `PARKED` (named,
not yet worth deciding).

---

## 0. Origin

- Proven on the work laptop already: M365 Copilot (chat agent) driving
  Hammerspoon (macOS Lua automation) as the executor. The point being proven
  was that a chat agent can be made to solve these use cases at all — proven,
  done. `LOCKED`
- That proof-of-concept is not the foundation to build on. Repeatedly hit
  three failure modes trying to grow it: **inner-platform effect** (Hammerspoon
  config drifting into an ad-hoc bespoke platform instead of staying a
  scripting tool), **point solutions** (one-off scripts per use case instead of
  a general capability), and **NIH** (reaching for custom Lua glue where a
  real library/standard already existed). Mill-as-a-Wails-app is the
  do-over specifically to avoid those three, which is why §3–§8 lean so hard
  on citing existing tools/patterns (n8n, React Flow, native messaging,
  Claude Code's project scoping) instead of inventing fresh ones. `LOCKED`

## 1. Positioning

- Mill is not novel. It composes existing primitives — a workflow/recipe
  authoring layer with guardrails, not a new category. `LOCKED`
- Reference points: **1Password** (generic capability across every site/app,
  not site-specific), **n8n** (generic workflow/automation composition).
  `LOCKED`
- Product posture: agentic, like M365 Copilot or claude.ai — not turn-by-turn
  operator mode like Claude Code's manual-gear review. The guardrail has to be
  ambient, not a tax on every step. `LOCKED`
- Hard constraint: the guardrailed path must not be harder than the baseline
  of what a person can already do natively (copy/paste, running a command
  themselves by hand). If it is, nobody adopts it. `LOCKED`
- **Scope filter, learned from the screenshot-to-clipboard tangent**: before
  any capability goes into Mill, check whether the OS (or an existing
  launcher like Alfred/Raycast) already does it simply and well. If yes,
  Mill's job is at most to surface/point at it (a Runbook tip, not a
  reimplementation) — reimplementing a solved OS capability is the §0
  inner-platform trap aimed at macOS instead of at Hammerspoon. Mill earns
  its keep specifically where there's no native answer at all: guardrailed
  command execution, structure-preserving capture across inconsistent
  sources, cross-session identity, workflow composition — genuine gaps, not
  a "screenshot but ours" competitor to what already works. `LOCKED`

### 1.1 Hard constraints & delivery model

- No `cargo`/Rust compilation anywhere in Mill's own build or dependency
  pipeline. Reason: at the bank, Zscaler intercepts/breaks cargo's network
  calls to crates.io, and Artifactory has no Rust feed to route around it —
  so anything that requires `cargo build`/`cargo install` from source will
  not build there, in CI or locally. This rules out e.g. Tauri as an
  alternative app shell (its build step compiles Rust). `LOCKED`
  Narrower than it first sounds: a **pre-built** Rust binary installed via
  Homebrew (a compiled bottle, no local cargo invocation) is not the same
  problem — brew already works there (it's how pueue got installed). So a
  Rust-authored local dev tool installed as a pre-built binary (e.g. `mise`
  via `brew install mise`) isn't automatically disqualified by this rule;
  only compiling Rust from source is. `LOCKED`
- No AI API calls from Mill itself, and no phone-home telemetry of any kind.
  Mill is the substrate that mediates/guards actions initiated by other
  systems (an agent CLI, a chat client) — it is not itself an LLM client, and
  it must run fully offline/on-prem with zero outbound calls it didn't
  explicitly initiate on the user's own behalf via a user-configured
  connector. `LOCKED`
- Single binary, no separate CLI/backend split. Wails3 already satisfies
  this (one Go binary embeds the compiled frontend) — this reinforces the
  existing scaffold choice, no change needed. `LOCKED`
- Install story: `git clone` + a documented local build, runnable on any work
  machine that can install the app. No hosted-service dependency for the
  core loop. `LOCKED`
- CI/CD wired from day one, not bolted on later. `LOCKED`
- Command/bash execution is mediated through Mill's own process (that's the
  guardrail hook point), but the mechanism underneath should be standard OS
  primitives (`os/exec`, a normal shell invocation) rather than a
  custom-built sandboxing/process-isolation layer — compose what exists,
  don't reinvent it. `OPEN` — confirm this reading is correct before it
  drives design.
- Architecture discipline: SOLID, DRY, DDD — proper domain/class separation
  once real domain logic exists. Not retrofitted onto the current two-file
  scaffold prematurely; applies as soon as actual capabilities land. `LOCKED`

### 1.2 Working method

- Research → Plan → Implement (the workflow Boris Cherny has described for
  Claude Code) is the standing method for every capability added to Mill:
  research what already exists before assuming it doesn't — a claimed
  "nothing exists for X" must be backed by an actual search, not an
  assumption (this is also the NIH guardrail from §0) — then plan/lock the
  approach, then implement. `LOCKED`
- DBOS and pueue were surfaced as possible durable-execution/process-queue
  candidates from earlier M365-context research, and got conflated with each
  other in that discussion — they're not the same kind of thing (DBOS is a
  durable-execution library you embed and typically pairs with Postgres;
  pueue is a standalone CLI/daemon for queueing shell commands). Neither has
  been independently evaluated. `PARKED`
- Concrete failure mode already hit once, worth locking as a hard filter for
  §7's eventual candidate list: pueue was `brew install`ed on the work
  machine for the M365 prototype, which (a) is written in Rust — disqualified
  by §1.1 on its own — and (b) is a separately-installed daemon outside the
  single binary, meaning anyone who `git clone`s Mill would also need to
  install and keep it in sync via a package manager Mill doesn't control.
  Generalized rule: **any process/job-queue mechanism must be embeddable
  directly in the Go binary** (a library, not a separately-installed
  daemon/CLI) — it cannot require Homebrew or any other external package
  manager at install time. This doesn't pick a replacement yet (that's
  §7's job), it just eliminates a whole class of candidate. `LOCKED`
- Access boundary: the actual work laptop this is being built for is behind
  Zscaler at the bank and is not something the assistant helping design Mill
  has any live access to — no inspecting the real clipboard, no observing
  M365/Loop/Copilot behavior directly, no running commands against that
  machine's real session. Design and research proceed from the user's
  descriptions, not empirical testing against the real target environment,
  unless the user explicitly runs something themselves and reports back.
  `LOCKED`

## 2. Core primitive: Capture → Process → Apply

- **Capture**: pull content from a source preserving structure (e.g. DOM copy
  keeps HTML structure, not just flattened text).
- **Process**: a workflow/recipe transforms the captured payload into
  whatever the target needs (markdown, plain text, a structured object).
- **Apply**: deliver the processed payload to a target location — e.g. paste
  at the cursor.
- This loop is meant to be generic: the same shape applies whether the
  "capture" is a DOM selection or an LLM tool-call request, and the "apply" is
  a paste or an actual command execution. `LOCKED` (as a shape) — the concrete
  node/connector model that implements it is `OPEN`.

### 2.1 First concrete milestone — the M365 Copilot chat bridge

The use case that should drive the first real build, not further
architecture discussion. M365 Copilot chat proposes a command in its
transcript; today the user manually reads it, runs it themselves, copies the
output, pastes it back into the chat box, and hits enter. Wanted workflow:

1. User reads the proposed command in the M365 Copilot chat (no live access
   for Mill's design process into this — see §1.2's access-boundary note;
   this all comes from the user's own machine at the time they use Mill).
2. User presses a configurable hotkey. **The hotkey press is the guardrail
   gesture** — a deliberate, human-initiated trigger, not a separate
   blocking approval popup. See the open question in §8 about whether that's
   sufficient or whether a lightweight preview still belongs in between.
3. Mill captures the command (from clipboard, or via the browser bridge
   reading the chat DOM directly — §5), executes it locally through Mill's
   own guardrailed process (§6/§7 govern cwd/shell/logging), and gets the
   result payload back.
4. Mill applies the payload back into the chat's input box (auto-paste).
5. Enter is either left to the user, or sent automatically by Mill — user
   explicitly wants the option to have Mill do it, closing the loop
   end-to-end with just the one hotkey press.

This is Capture → Process → Apply instantiated concretely: Capture = read
the proposed command from the chat, Process = execute it, Apply = paste the
result back and optionally submit. It requires §5 (browser bridge, to read
the chat DOM and write back into it), a global-hotkey mechanism (not yet
researched — needs a pure-Go, non-cargo library, per §1.1), and §6/§7 for
the execution itself. `OPEN` on the concrete implementation, `LOCKED` as the
first thing to build once the browser bridge and hotkey pieces are
researched.

### 2.2 Actually-buildable-now milestone — the Runbook page

§2.1 depends on two unresearched pieces (browser bridge, hotkey) and an
environment (M365 in-browser) the assistant helping build Mill has no live
access to (§1.2). This milestone de-risks the two pieces that don't require
that environment, on something testable directly in this dev session:

- A **Runbook page** — a list of available actions the user can browse and
  run directly with a click (no hotkey required), similar to how many apps
  offer example/demo actions or default recipes out of the box. Answers
  "what should I see as a user" concretely instead of describing it.
- Each action gets a **Run** button now; **assign a keyboard shortcut** per
  action (Raycast/Alfred-style: click into a shortcut field, press the
  combo, it's bound) is the deliberate next increment once running actions
  works, not built in the same pass.
- Design principle for that increment, from a real annoyance (macOS's
  default screenshot-to-clipboard shortcut is the awkward one, save-to-file
  got the easy keystroke): the easiest-to-press binding should be assignable
  to whatever the user does *most*, not whatever a default happened to claim
  first. Don't just let a shortcut be set — make it easy to see which
  actions are "easy reach" vs. "deliberately awkward" and rebalance them.
- First seeded action: **clipboard → Markdown**, directly testing the
  original Loop/structure-preservation pain point without needing M365 at
  all — works with anything that puts real HTML on the clipboard.
- Libraries verified directly (repo, license, `go.mod`, recent activity —
  not taken on assumption): [`golang-design/hotkey`](https://github.com/golang-design/hotkey)
  (MIT, cross-platform; macOS backend is cgo via Objective-C
  (`hotkey_darwin.m`) since there's no pure-Go way to hook OS-level global
  hotkeys — a C compiler dependency via Xcode CLI tools, already present,
  not Rust/cargo, so §1.1 is unaffected) and
  [`JohannesKaufmann/html-to-markdown`](https://github.com/JohannesKaufmann/html-to-markdown)
  v2 (MIT, pure Go, 3.7k★, actively maintained). `LOCKED` as the immediate
  next build step.
- **Permissions UX pattern for when this needs Accessibility access**:
  macOS supports deep-linking straight into a specific System Settings pane
  via the `x-apple.systempreferences:` URL scheme (`open
  "x-apple.systempreferences:com.apple.Keyboard-Settings.extension?Shortcuts"`,
  confirmed via search) — this is the exact mechanism Hammerspoon itself
  uses for its own "grant Accessibility permission" prompt, and Mill will
  need the same prompt once hotkeys/simulated-paste land. Caveat: this is
  not an official documented Apple API — it's community-reverse-engineered,
  and identifiers have broken before across macOS System Settings rewrites
  (confirmed: the pre-Ventura Accessibility deep-link stopped working when
  Ventura rebuilt System Settings). Use it, but with a plain-language
  fallback for when the link silently stops landing correctly — don't trust
  it blindly, and verify the exact identifier against the target macOS
  version at build time rather than assuming it still holds. `OPEN`
  (exact identifiers, verify at implementation time) / `LOCKED` (the
  show-current-state-and-deep-link pattern itself is worth using).

## 3. Capability composition — how nodes connect

- `OPEN`. Reference lineage: n8n (typed node inputs/outputs, credentials
  separated from node config, JSON workflow definition under the canvas) and
  React Flow / `@xyflow/react` (canvas engine; Vue Flow is the same team's Vue
  port — moot for us since Mill's frontend is already React).
- Not yet decided: node schema shape, how a "capability" is declared/
  registered, whether recipes are user-authored on a canvas or config-first
  with canvas as a later view.

### 3.1 Raw material — root cause of the heredoc pain, not yet resolved

The actual heredoc frustration (see the mise/Taskfile discussion) isn't
about which task runner executes a shell string — it's that an LLM has to
freehand-generate shell syntax at all. Four related ideas surfaced together,
captured here before being lost, none yet resolved:

- **Bring-your-own-model chat bridge**: Mill could expose a Claude-Code-like
  agent loop where the user points it at any LLM (a local Ollama model, or
  any API key) and that model drives Mill's tools directly — Mill as "a
  bridge to your allowed folder," not itself an LLM client (consistent with
  §1.1's no-AI-API-from-Mill-itself rule — the model is always brought by the
  user/host, never bundled). Composability mechanism unclear — see below.
- **Declarative/no-code action definition**: reference pattern is a no-code
  decisioning platform style the user has worked with professionally —
  generic HTTP-connector nodes configured against external data
  vendors, with typed input/decision nodes wired into a workflow (see §3.2
  for the fuller pattern description — kept vendor-name-free deliberately,
  Mill's docs stay OSS-ready from day one, no citing specific commercial
  products by name). Applied to Mill: if a user has some CLI tool installed
  locally, expose it as a typed "action" (declared inputs/outputs) instead
  of the LLM freehand-generating a shell command to invoke it.
- **Diff preview**: frustration that a prior AI tool had no file-diff
  preview for a proposed change; floated IDE integration to get it. Likely
  not a separate feature — probably the same PreToolUse-style preview
  already planned in §8, just rendering a diff when the action is a
  file write instead of a raw command. Confirm this framing once §8 is
  worked.
- **Structured primitive tools with swappable backends**: instead of the LLM
  needing to remember shell invocations, Mill exposes stable primitives —
  `Read()`, `Write()`, `Find()` — whose implementation can be Mill's own
  default (e.g. `fd`/ripgrep-equivalent, or a RAG index) or something the
  user brings themselves.

**MCP verdict: good fit, adopt as the capability-exposure layer.** `LOCKED`
Researched and independently spot-checked (repo/release/go.mod/license all
confirmed directly, not taken on the research pass's word alone):

- **Go SDK**: [`modelcontextprotocol/go-sdk`](https://github.com/modelcontextprotocol/go-sdk)
  — official, "maintained in collaboration with Google," v1.7.0
  (2026-07-28). `go.mod` deps are 100% pure Go (`jsonschema-go`,
  `segmentio/encoding`, `golang-jwt`, `x/oauth2`, `x/time`, `x/tools`, etc.)
  — no cgo, no Rust, no Node/Python. Server *and* client roles both
  implemented. Clean fit with the single-binary constraint. License
  mid-transition MIT → Apache-2.0 (new code Apache-2.0; unrelicensed old
  contributions stay MIT) — confirmed directly against the repo's `LICENSE`
  file, worth a compliance glance given the bank context but not a blocker.
- **Bring-your-own-model is real, not assumed**: the spec is explicit that
  MCP "does not dictate how AI applications use LLMs" — the host owns the
  model choice, Ollama-or-any-key is genuinely in-scope, this isn't Mill
  inventing a workaround.
- **Wrapping a local CLI as a typed tool is the mainstream pattern**, not a
  novel use — see
  [github-mcp-server](https://github.com/github/github-mcp-server) (32k★,
  Go, single binary) as a real precedent.
- **No PreToolUse-equivalent exists in the MCP spec** — that stays entirely
  Mill's own responsibility, as expected. The Go SDK does expose a real seam
  for it though: `Server.AddReceivingMiddleware(...)` wraps `tools/call`
  before dispatch — the SDK's own examples only use it for response
  caching, not approve/deny, so Mill would be writing the actual guardrail
  logic, but the interception point already exists and doesn't need to be
  built from scratch.
- **No-code workflow canvas is confirmed out of scope for MCP** — its
  primitives are flat tools/resources/prompts with no chaining semantics.
  React Flow (§3's other reference) over MCP-exposed tools as nodes still
  stands as the composition layer on top.
- **Correction to the transport question**: local **stdio** transport is
  confirmed to be pure local IPC — "newline-delimited messages over the
  standard streams of a client-launched subprocess," zero network egress,
  never touches Zscaler or any network security stack. Remote transports
  (SSE, streamable HTTP) are the actual egress path and what enterprise
  MCP-security policy typically targets. Not verified against the bank's
  actual policy text — **worth asking IS&C directly** whether the block
  names remote/HTTP MCP specifically, since local stdio MCP may already be
  usable today regardless of the broader block.
- **Prior art worth reading before designing Mill's own version**:
  [mcphost](https://github.com/mark3labs/mcphost) (Go, Ollama-native, had
  hook-based tool approval) — archived April 2026, successor project
  "Kit." Closest existing thing to "Mill's idea #1," already attempted and
  abandoned once; worth understanding why before repeating its shape.
- **Alternatives checked, not just MCP confirmed in isolation**: Eino
  (ByteDance) and langchaingo are agent *frameworks*, not protocols —
  complementary at most, heavier than Mill needs, not competing options.
  MCP isn't overkill here; the alternative would be hand-rolling the same
  tool-schema contract worse.

**Open conflict this surfaces, needs a decision**: §1.1 locks "Mill is not
itself an LLM client — no AI API calls from Mill itself." Idea #1 above
(Mill running a chat/agent loop that drives a user-supplied Ollama model)
would make Mill an MCP **host**, which sits uneasily against that lock —
even though Mill wouldn't be calling a *paid* API or phoning home, it would
be the thing orchestrating a model's tool-calling loop, not just exposing
tools to be orchestrated. Mill as MCP **server only** (exposing guardrailed
tools, something else acts as host) fits §1.1 cleanly with zero tension.
`OPEN` — this determines whether idea #1 is in scope at all.

### 3.2 Composition pattern from professional experience — kept generic, no vendor names

The user has worked professionally with a no-code decisioning platform
(fintech domain) whose composition pattern is worth adopting the shape of.
Deliberately described here without naming the product — Mill's docs stay
citeable/OSS-ready from day one, that's a standing rule now, not just for
this entry.

- **Three distinct surfaces, not two.** The reference platform separates
  **Settings** (global/app-level config — credentials, preferences, things
  that apply across the whole app) from **Configure** (where node *kinds* —
  input, decision, integration, and others — get defined: schema, required
  fields, auth for integrations) from the **workflow canvas** itself (where
  already-configured node *instances* get dragged in and wired together).
  The user specifically likes this separation and wants Mill to keep it —
  don't collapse app-level settings and capability/node-type configuration
  into one screen just because they're both "configuration." Same
  type-vs-instance split n8n uses for its second half (node package defines
  the type; workflow canvas composes instances) — two independent
  references converging on the same shape is a good signal. `LOCKED`
  (three-surface separation) — which settings live where, `OPEN`.
- **Cardinality differs by node kind.** Input nodes are 1:1 — configured for
  and used within a single workflow. Integration/vendor-connector nodes are
  reusable 1:* — one configured connector (e.g. one authenticated HTTP
  connector to a given vendor) can be wired into many different workflows.
  Decision node cardinality is unconfirmed (user wasn't sure) — check before
  assuming either way when this gets designed.
- **Connector protocol/auth support should be incrementally extensible, not
  fixed upfront.** The reference platform started with plain HTTP and grew
  — driven by real, incoming vendor requirements rather than upfront
  speculation — to also support XML/SOAP, OAuth and other auth schemes, and
  eventually mTLS. Lesson for Mill's own connector design (§4): build the
  generic HTTP connector first, but don't hardcode assumptions that would
  block adding SOAP/XML translation or new auth schemes later without a
  rearchitecture. Add real protocol/auth support when a real connector needs
  it, not speculatively.

## 4. Connectors

- `OPEN`. Named so far: generic HTTP connector, Jira/Confluence as a
  first-class example.
- Not yet decided: credential storage model (1Password-style vault local to
  Mill vs. delegating to an existing secrets manager), auth flow per
  connector type (OAuth vs. token vs. API key), and whether connectors are
  built-in or a plugin surface.
- See §3.2 for the node-type-vs-instance composition pattern and the
  incremental-extensibility principle for connector protocol/auth support.

## 5. Browser bridge

- `OPEN`. Needed to get page title/DOM payload and per-tab session identity
  out of a live browser tab into the native Mill app.
- Reference pattern: Chrome extension (content script) + native messaging
  (stdio protocol) talking to the Wails binary — same mechanism 1Password's
  and Bitwarden's extensions use.
- This is also the mechanism that would resolve the multi-tab identity
  problem (which agent session a given tab belongs to), since the extension
  runs inside the tab and knows which one it is.
- **Data point, not yet confirmed**: user reports that copying an entire
  Confluence page (as opposed to a smaller in-page selection) loses
  structure on paste — comes out plain text only. Two different root causes
  are possible: (a) Confluence puts real HTML on the clipboard for a
  full-page copy but something downstream mishandles it, or (b) Confluence's
  full-page copy degrades to plain-text-only at the source, in which case
  there's nothing on the clipboard for any converter to work with. Testing
  with §2.2's Runbook action (reuses the same clipboard-HTML-read path) to
  find out which. If it's (b), that's a concrete case where clipboard-based
  capture is fundamentally insufficient and DOM-read via the browser bridge
  is the only reliable path — not just a nice-to-have for the M365 milestone,
  a requirement for at least this source. Also noted in passing: image paste
  from clipboard already works reliably in most chat apps (image clipboard
  flavors are consistent across sources) — the inconsistency is specific to
  rich-text/HTML flavors, worth keeping in mind when designing the capture
  layer's fallback order (try HTML → try DOM-read → fall back to plain
  text/image, not just clipboard-HTML-or-bust). `OPEN`, pending the test.

## 6. Execution environment & determinism

- `OPEN`. Must not blindly execute anywhere — command execution needs a
  pinned working directory (reference: Claude Code's `~/.claude/projects`
  scoping) and an explicit shell (zsh/sh/etc.) rather than an inherited,
  ambiguous one.
- Not yet decided: how env vars are scoped per project/recipe, whether a
  recipe declares its required shell/interpreter or Mill infers it.

## 7. Process & session tracking

- `OPEN`. Long-running command/workflow executions need to be inspectable
  while running (like Claude Code's background task view) and their
  logs/results need to persist and stay viewable after the process exits —
  not just streamed and discarded.
- Ties into #5: a "session" spans a browser tab, an agent run, and possibly a
  background process, and Mill needs one identity that threads all three
  together so the user always knows which is which.
- Hard filter on any candidate mechanism (queue, durable-execution engine,
  job runner): must be embeddable directly in the Go binary — no
  separately-installed daemon/CLI, no dependency on a package manager
  (Homebrew etc.) at install time. See §1.2 for the pueue incident this came
  from. Still `OPEN` which specific mechanism satisfies that (DBOS's fit
  depends on whether it can run without a standalone Postgres server —
  unevaluated).

## 8. Guardrails / policy

- `OPEN` in detail, `LOCKED` in shape: modeled on Anthropic's Hooks structure
  — a PreToolUse-equivalent preview of the action about to run, checked
  against policy, shown to the user before execution, with sync/async waiting
  around the check and the eventual result.
- **Resolved (§2.1's tension)**: default is a preview/approval popup —
  fail-safe, not fail-open. It is *skipped* only when the action matches an
  explicit, user-configured condition/policy rule saying it's safe to
  auto-run. So friction is the default and speed is the opt-in, not the
  other way around — you only get interrupted "when it needs your
  attention." The hotkey from §2.1 triggers the check, not a bypass of it;
  whether a given hotkey-triggered command shows a popup or runs straight
  through depends on whether it matches a skip rule. `LOCKED` (as the
  default-safe/explicit-skip shape)
- **Skip-condition rules must be testable/validated, not just declared.**
  Whatever authors a "safe to auto-run" rule needs a way to verify the rule
  actually matches what the author thinks it matches (a dry-run / test
  mode against sample actions) before it's trusted live — a policy rule
  that's silently broader than intended is exactly how a guardrail fails
  quietly. Mechanism `OPEN`, requirement `LOCKED`.
- Still not yet decided: where policy/skip-rules are authored/stored, what
  they can express (allowlist commands? path scoping? connector-level
  rules?), how pass/fail/pending/skipped states are communicated in the UI.

## 9. Repo AI workflow (CLAUDE.md / SKILL.md / agent profiles)

Methodology below is `LOCKED` (researched against current Anthropic docs and
cross-checked against other agent frameworks). Which specific skills/agents
actually get built is `OPEN` — the list below is candidates, not commitments.

### 9.1 Conventions — `LOCKED`

- **CLAUDE.md** is instructions-you-write, loaded in full every session —
  keep it under ~200 lines (longer files measurably reduce instruction
  adherence), concrete and verifiable ("run `task build`" not "build the
  app"), structured with headers/bullets, and free of anything Claude can
  derive itself from the codebase (directory layout, dependency lists).
  Multi-step procedures or anything that only matters for part of the repo
  belongs in a skill or a path-scoped rule (`.claude/rules/*.md`), not in
  CLAUDE.md. `docs/SPEC.md` stays the living concept/architecture doc;
  CLAUDE.md only points at it plus encodes standing process (Research →
  Plan → Implement, the hard constraints) — the two must not duplicate
  content, since duplication is exactly how they drift.
- **SKILL.md** files use YAML frontmatter (only `description` is really
  required) + a markdown body that loads on demand rather than every
  session — this progressive disclosure is the entire point: put the
  common-case instructions in the body, push large reference material
  (specs, examples) into supporting files the skill only reads when needed.
  The `description` is a trigger for auto-invocation: lead with the concrete
  use case ("Use when adding a new connector type..." not "Helps with
  connectors"), since Claude matches intent against this text. Skills follow
  the open Agent Skills standard (agentskills.io), which is also what
  Claude.ai and the Skills API consume — sticking to the standard fields
  keeps a skill portable instead of Claude-Code-only.
- **Agent/subagent profiles** are markdown + YAML frontmatter under
  `.claude/agents/`: `name` and `description` are required, `description` is
  the delegation trigger (same discipline as skill descriptions — lead with
  when to use it, not what it is), `tools` is an explicit allowlist (omit to
  inherit everything, which is the wrong default for anything narrow-purpose
  like a read-only reviewer), and the markdown body is the subagent's entire
  system prompt (it does not inherit the parent's). Two agent descriptions
  should never overlap enough to make delegation ambiguous.
- **Cross-framework check**: OpenAI's Agents SDK (instructions + tools +
  explicit handoff list per agent), LangGraph (typed state passed between
  named nodes, explicit edges), and CrewAI (role + goal + explicit tool list
  per agent) all converge on the same shape Anthropic uses here — a scoped
  system prompt, an explicit tool allowlist, and a natural-language
  trigger/role description for routing. Nothing in this repo's setup is
  Anthropic-idiosyncratic; adopting it isn't a lock-in risk.
- Sources: Claude Code docs — memory (`/docs/en/memory`), skills
  (`/docs/en/skills`), subagents (`/docs/en/sub-agents`), all at
  `code.claude.com`; agentskills.io (Agent Skills open standard); OpenAI
  Agents SDK, LangGraph, and CrewAI framework docs for the cross-check.

### 9.2 Candidate skills/agents — `OPEN` (names + one-line justification only; none scaffolded yet)

- **ddd-modeling-helper** (skill) — guides entity/value-object/aggregate
  boundary decisions when domain logic starts landing (§1.1 SOLID/DRY/DDD
  discipline), so the split isn't ad hoc per contributor.
- **adr-writer** (skill) — turns an `OPEN` item in this doc into a proper
  decision record once it's resolved, keeping §10's open-questions log
  honest about what's actually been decided vs. still open.
- **go-wails-conventions** (skill, path-scoped to `*.go` / `frontend/**`) —
  house style for Go service structs, Wails3 binding patterns, and
  React/TS conventions once there's enough surface area to standardize.
- **spec-sync-checker** (skill or hook) — flags when code changes touch an
  area `docs/SPEC.md` marks `OPEN`/`LOCKED` without a corresponding doc
  update, so the living-spec promise in the doc's header doesn't silently
  lapse.
- **connector-scaffolder** (agent) — once §4's connector model is `LOCKED`,
  generates the boilerplate for a new connector against the settled schema —
  useful specifically to avoid point-solution drift per-connector (§0).
- **guardrail-policy-reviewer** (agent) — once §8's policy model is
  `LOCKED`, reviews a proposed guardrail/policy change for gaps before it's
  trusted to gate real command execution.

None of the above should be built before the section of the spec it depends
on (§3, §4, §8, etc.) moves off `OPEN` — building the helper before the
domain concept it encodes is settled is the inner-platform-effect failure
mode from §0 repeating itself one level up.

## 10. Open questions log

- Node/canvas composition model (§3)
- Credential/vault model for connectors (§4)
- Browser extension ↔ native app protocol details (§5)
- Env/shell determinism rules (§6)
- Session identity model spanning tab + agent run + process (§7)
- Policy authoring format and storage (§8)
- Bash-execution-through-our-process-but-nothing-is-ours reading (§1.1) —
  confirm with the user
