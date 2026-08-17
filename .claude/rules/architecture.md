# Architecture & reuse discipline

No `paths` frontmatter on this file deliberately — these conventions
cut across both Go and TypeScript, so they load every session the same
way CLAUDE.md does (per Claude Code's own docs: rules without `paths`
load unconditionally, same priority as CLAUDE.md), rather than being
tied to one file type the way `frontend.md`/`backend.md` are.

**SOLID, DRY, DDD discipline — with a concrete reuse boundary, not just
a platitude.** Generic/commodity concerns (parsing, UI widgets, OS
plumbing, wire protocols) are fine to buy via a well-vetted library —
that's the "compose, don't reinvent" rule below. Mill's actual **core
domain** — what a guardrail evaluates and why, the Capture → Process →
Apply orchestration itself, the action/capability model and its
composition rules, session-identity resolution across tab/agent/process
— must stay hand-written, Mill's own code, never delegated to or
reimplemented by a library, because no library has an opinion on it;
it's the specific reason Mill exists. Keep commodity dependencies
behind a clean interface at the domain boundary (ports/adapters) so
swapping the underlying library later never means rewriting domain
logic.

**Research → Adopt → Compose — the standing order for any new capability (owner-restated 2026-08-17: "we never reinvent the wheel").** First research what already exists — an actual search of registries/docs/the platforms this repo already vets, never an assumption. Then adopt the proven commodity behind a ports/adapters boundary. Then compose the remainder from Mill's own primitives (nodes, triggers, Configure entities — ADR-0035) rather than building parallel machinery. Hand-rolling is the last resort, justified only when research shows nothing satisfies the hard constraints (§1.1). The paragraphs below are this rule's detail.

**Default to adopting an existing library/platform over hand-rolling,
even when hand-rolling would be smaller or have fewer dependencies.**
The deciding question is "who owns and maintains this six months from
now," not "which is leaner to write today." Mill effectively has one
maintainer, and infrastructure-shaped code — durable execution,
retry/backoff, checkpointing, queues, and similar — is exactly the
kind of thing that looks small at first and quietly becomes an
unbounded maintenance burden once hand-rolled. Prefer a well-vetted
library that already has the target capability, accept its dependency
weight as a real but bounded, one-time cost, and keep it behind a
ports/adapters boundary so it stays swappable. Hand-roll only when no
adopted option actually satisfies the hard constraints (single binary,
no Rust, no phone-home) — never merely because it would be smaller.
This applies one level down too: a *shape* (a UI component family, a
CLI flag parser) can be commodity even when the specific instance isn't
a named library — check before reaching for a `.map()` + custom markup
or a hand-rolled parser (see `.claude/rules/frontend.md` for the
concrete UI-collection instance of this).

**The core/composition boundary — before building ANY new capability,
ask: is this a node, a trigger, a connector, or a true kernel
change?** ([ADR-0035](../../docs/adr/0035-core-vs-composition-boundary.md),
`docs/SPEC.md` §9.5's Update.) If a user could plausibly say "I want
that, but to a different channel / with a condition / on a different
event," it's composition-shaped and MUST arrive as composition — a
self-registered `NodeType`, a trigger event, a Configure entity —
never a bespoke service path plus a Settings toggle. Settings toggles
configure the kernel; they never implement a side effect. Recorded
counterexample, the reason this rule exists: cross-device notification
shipped as a Settings checkbox wired to a private send path
(`ForwardPendingApproval`) instead of a connector + trigger
composition, caught live and refactored into a seeded, editable
workflow. The flip side of the same rule: platform-internal behavior
MAY and SHOULD consume Mill's own composition surface (a built-in,
seeded, fully-editable workflow) rather than hand-rolling a parallel
mini-pipeline for something the surface can already express — the app
dogfooding its own platform, inspectable and guarded like anything a
user builds. `docs/SPEC.md` §9.5 carries the protected-kernel list
(graph engine, guardrail gate, durable execution, registries, the
Configure recipe, the MCP plane) that composition never reaches into;
changes there need an ADR, same bar this file's other architecture
decisions already carry.

**Configure entity vs. node-local config — the owner's own framing:
"business rules on canvas, integration rules in Configure."** A
`ConfigField`'s value is a Configure-entity reference (`RefKind`,
ADR-0009) exactly when two different workflows authored independently
would want the *same* value and drifting apart would be a bug — a
credential, an endpoint, a model, anything that names WHICH external
thing a step talks to. It stays a plain node-local field exactly when
the value is this one workflow's own decision-making — a condition, a
threshold, a category list, a literal piece of text — the kind of
thing every workflow legitimately answers differently, where forcing a
shared Configure entity would just be indirection with no real reuse
behind it. Codified here after a pre-flight audit (goal 0031, run
before building the AI node family, since a wrong call here is exactly
how a `RefKind` gets bolted on after the fact instead of designed in):
every current `NodeType`'s `ConfigFields` was checked against this
test, one by one. Verdict: **already fully consistent, zero
misplacements found** — every field carrying a credential or an
endpoint (`integration-http`'s `requestId`, `mcp-tool-call`'s
`mcpServerId`, `code-execution`'s `envId`, `list-lookup`/`list-search`'s
`listId`, `decision-outcome`'s `decisionId`, `child-workflow`'s
`workflowId`) already carries `RefKind` and resolves through
Configure; every field that's a workflow's own business/routing
decision (`ruleset`'s `rulesJSON`, `human-review`'s `inputAttributes`,
`capture-file`'s literal `path`, Branch's edge conditions) is correctly
node-local, with no reusable "thing" behind it to promote (the same
"nothing to configure" reasoning `docs/SPEC.md` §3.5's own two-axis
recheck already applied to `capture-clipboard-html`/
`process-html-to-markdown`). The AI node family built immediately
after this audit follows the same split by construction: `aiproviderId`
(which endpoint/model/credential) is `RefKind: "aiprovider"`;
`ai-classify`'s `categories` list stays node-local (a Dify-precedent
product decision, docs/goals/0031) since two workflows classifying into
different category sets is normal, not drift. Revisit this audit's
verdict only when a new `NodeType` actually adds a field that fails the
test above — not on a schedule.

**Max 500 lines per hand-written source file (`.go`/`.ts`/`.tsx`).**
Enforced by `scripts/check-loc.sh`, run by both Lefthook (pre-commit)
and CI's `file-loc-limit` job, so it can't land un-caught either way. A
file crossing the limit means a real seam got missed — split along it
(e.g. one package, multiple files; one component, extracted
sub-components/hooks), don't truncate arbitrarily or suppress the
check. Generated Wails bindings (`frontend/bindings/`) and the vendored
gomobile scaffold (`build/ios/`, `build/android/`) are exempt — Mill
doesn't own their shape. `docs/SPEC.md` §1.3 has the checked-not-assumed
reasoning for why this stays one hand-rolled script rather than
splitting into ESLint's built-in `max-lines` (TS-only) plus a separate
Go mechanism (no shipped file-length linter exists in golangci-lint as
of the version this repo uses).

**The repo root is an allowlist, not a scratch space.** Enforced by
ls-lint (`.ls-lint.yml`, run unconditionally by both Lefthook's
`root-file-naming` job and CI's) — its `.*` catch-all flags any file at
the repo root whose name isn't one of the established root families, so
a stray screenshot, one-off script, or notes file can't quietly land or
get committed there. Temporary/working files (probe scripts, downloaded
artifacts, screenshots taken during verification) belong in the
session scratchpad directory, never the repo root — even "just for a
moment," since a moment is exactly how `cmd/` (an empty rogue
directory) and a stray verification `.png` actually appeared. Adding a
genuinely new root file or top-level directory is an ADR-0001 layout
decision: extend `.ls-lint.yml`'s regex/`ignore:` deliberately in the
same change, with a comment saying why. Known accepted limitation
(probed against ls-lint v2.3.1, documented in `.ls-lint.yml`'s header):
extensionless files are invisible to ls-lint, so `LICENSE` needs no
rule and a bare extensionless rogue won't be caught.
