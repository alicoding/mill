# Architecture & reuse discipline

No `paths` frontmatter — these conventions cut across both Go and
TypeScript, so they load every session the same way CLAUDE.md does,
rather than being tied to one file type the way `frontend.md`/
`backend.md` are.

**SOLID, DRY, DDD discipline — with a concrete reuse boundary, not just a
platitude.** Generic/commodity concerns (parsing, UI widgets, OS
plumbing, wire protocols) are fine to buy via a well-vetted library —
that's the "compose, don't reinvent" rule below. Mill's actual **core
domain** — what a guardrail evaluates and why, the Capture → Process →
Apply orchestration itself, the action/capability model and its
composition rules, session-identity resolution across tab/agent/process
— must stay hand-written, Mill's own code, never delegated to or
reimplemented by a library, because no library has an opinion on it;
it's the specific reason Mill exists. Keep commodity dependencies behind
a clean interface at the domain boundary (ports/adapters) so swapping the
underlying library later never means rewriting domain logic.

**Research → Adopt → Compose — the standing order for any new
capability.** First research what already exists — an actual search of
registries/docs/the platforms this repo already vets, never an
assumption. Then adopt the proven commodity behind a ports/adapters
boundary. Then compose the remainder from Mill's own primitives (nodes,
triggers, Configure entities — ADR-0035) rather than building parallel
machinery. Hand-rolling is the last resort, justified only when research
shows nothing satisfies the hard constraints (§1.1).

**Default to adopting an existing library/platform over hand-rolling,
even when hand-rolling would be smaller or have fewer dependencies.** The
deciding question is "who owns and maintains this six months from now,"
not "which is leaner to write today." Mill effectively has one
maintainer, and infrastructure-shaped code — durable execution,
retry/backoff, checkpointing, queues, and similar — is exactly the kind
of thing that looks small at first and quietly becomes an unbounded
maintenance burden once hand-rolled. Prefer a well-vetted library that
already has the target capability, accept its dependency weight as a
real but bounded, one-time cost, and keep it behind a ports/adapters
boundary so it stays swappable. Hand-roll only when no adopted option
actually satisfies the hard constraints (single binary, no Rust, no
phone-home) — never merely because it would be smaller. This applies one
level down too: a *shape* (a UI component family, a CLI flag parser) can
be commodity even when the specific instance isn't a named library —
check before reaching for a `.map()` + custom markup or a hand-rolled
parser (see `.claude/rules/frontend.md` for the concrete UI-collection
instance of this).

**Adopting a dependency means reading its API, not just the part you
needed on day one.** Research → Adopt → Compose above governs whether to
take a dependency. This governs what happens next, and it is a distinct
failure: we adopt something, use the four calls the first feature
needed, and then months later hand-build a capability the same
dependency already ships. Before building ANY capability inside a domain
an adopted dependency already owns — windows, tray/menu bar, menus,
dialogs, notifications, storage, the update channel — **enumerate that
dependency's API for the domain first, from its own vendored source, and
state what you found in the goal or brief, including "it offers nothing
here."** The check is one grep of `~/go/pkg/mod` or `node_modules` and
costs minutes; skipping it has cost real defects. Three confirmed
instances, all in the platform-configuration seam (goal 0190 has the
audit): `SystemTray` was used as a launcher while its own API offers an
attachable window, a menu-bar label and a full click vocabulary;
`Mac.ActivationPolicy` was never declared at all, so Mill inherited the
document-app archetype while behaving like a menu-bar app and AppKit
terminated it on a background summon (goal 0188); and `SetIcon` was
chosen where `SetTemplateIcon` is the API that adapts to a light or dark
menu bar. The counter-example proving the rule is satisfiable:
`internal/adapters/dockbadge` correctly wraps Wails' own
`dock.DockService` rather than reimplementing it.

**The core/composition boundary — before building ANY new capability,
ask: is this a node, a trigger, a connector, or a true kernel change?**
([ADR-0035](../../docs/adr/0035-core-vs-composition-boundary.md),
`docs/SPEC.md` §9.5's Update.) If a user could plausibly say "I want
that, but to a different channel / with a condition / on a different
event," it's composition-shaped and MUST arrive as composition — a
self-registered `NodeType`, a trigger event, a Configure entity — never
a bespoke service path plus a Settings toggle. Settings toggles configure
the kernel; they never implement a side effect. The flip side of the
same rule: platform-internal behavior MAY and SHOULD consume Mill's own
composition surface (a built-in, seeded, fully-editable workflow) rather
than hand-rolling a parallel mini-pipeline for something the surface can
already express — the app dogfooding its own platform, inspectable and
guarded like anything a user builds. `docs/SPEC.md` §9.5 carries the
protected-kernel list (graph engine, guardrail gate, durable execution,
registries, the Configure recipe, the MCP plane) that composition never
reaches into; changes there need an ADR, same bar this file's other
architecture decisions already carry.

**Build the multi-purpose surface, not the hardcoded use case.** When a
new user-facing affordance is needed — a notification, a banner, a pill,
a panel, an inline hint — ask whether a SECOND consumer is plausible
before building. If yes, the affordance arrives as a named, reusable
surface whose triggering use case is merely its first consumer — never a
one-off hardcoded to that use case, which the next need then overlaps
and duplicates (first instance: goal 0122's in-app notice surface, whose
update-ready relaunch pill and update-available badge are consumers of
one generic notice channel, not two bespoke update widgets). The test
mirrors the ADR-0035 one: if a user or future feature could plausibly say
"I want that, but for a different event/message," it's surface-shaped —
build the surface.

**Every user-facing action arrives as a registry command, with an
honest enablement predicate — buttons render commands, they never own a
second code path.** (goal 0222, `shared/commands.ts`'s VSCode-derived
architecture: the command is the atom, palette/keyboard/buttons are
renderings of it.) A button's `onClick` calls `findCommand(id)?.run()`
rather than performing the action inline; a command whose validity
depends on live state (an open editor tab, a locked resource, an
in-flight pipeline) declares that in `Command.enabled`, never as an
inline guard inside `run()` that returns silently — the palette omits
a disabled command entirely rather than showing something that does
nothing. Shipping a mouse-only action — a click handler with no
matching registry command — needs a stated reason (a live on-screen
selection the palette structurally can't supply is the one already-
accepted shape, see `Command.paletteHidden`'s own doc comment); "it's
just one button" is not a reason, since the next surface that wants
the identical action is exactly how a bespoke click handler and a
registry command drift apart.

**Configure entity vs. node-local config — "business rules on canvas,
integration rules in Configure."** A `ConfigField`'s value is a
Configure-entity reference (`RefKind`, ADR-0009) exactly when two
different workflows authored independently would want the *same* value
and drifting apart would be a bug — a credential, an endpoint, a model,
anything that names WHICH external thing a step talks to. It stays a
plain node-local field exactly when the value is this one workflow's own
decision-making — a condition, a threshold, a category list, a literal
piece of text — the kind of thing every workflow legitimately answers
differently, where forcing a shared Configure entity would just be
indirection with no real reuse behind it. Every current `NodeType`'s
`ConfigFields` was checked against this test and found already fully
consistent, zero misplacements (goal 0031's pre-flight audit has the
full field-by-field record). Revisit this verdict only when a new
`NodeType` actually adds a field that fails the test above — not on a
schedule.

**Max 500 lines per hand-written source file (`.go`/`.ts`/`.tsx`).**
Enforced by `scripts/check-loc.sh`, run by both Lefthook (pre-commit) and
CI's `file-loc-limit` job. A file crossing the limit means a real seam
got missed — split along it (e.g. one package, multiple files; one
component, extracted sub-components/hooks), don't truncate arbitrarily
or suppress the check. Generated Wails bindings (`frontend/bindings/`)
and the vendored gomobile scaffold (`build/ios/`, `build/android/`) are
exempt — Mill doesn't own their shape. `docs/SPEC.md` §1.3 has the
reasoning for why this stays one hand-rolled script rather than splitting
by language.

**The repo root is an allowlist, not a scratch space.** Enforced by
ls-lint (`.ls-lint.yml`, run unconditionally by both Lefthook's
`root-file-naming` job and CI's) — its `.*` catch-all flags any file at
the repo root whose name isn't one of the established root families.
Temporary/working files (probe scripts, downloaded artifacts, screenshots
taken during verification) belong in the session scratchpad directory,
never the repo root — even "just for a moment." Adding a genuinely new
root file or top-level directory is an ADR-0001 layout decision: extend
`.ls-lint.yml`'s regex/`ignore:` deliberately in the same change, with a
comment saying why. Known accepted limitation (probed against ls-lint
v2.3.1, documented in `.ls-lint.yml`'s header): extensionless files are
invisible to ls-lint, so `LICENSE` needs no rule and a bare extensionless
rogue won't be caught.

**Adopting a library means adopting its CONTRACT, not just its API — and
the load-bearing parts of that contract are invisible in the type
signature.** Thread affinity ("which thread may call this?"),
reentrancy, blocking behavior, and error semantics don't appear in a
function's shape; they live in the library's source and docs. Before
calling an adopted library from a callback, goroutine, or event handler
that the library did not itself create, VERIFY the affinity contract
against that library's own source, and state it at Mill's boundary — a
named seam, a comment carrying the constraint, or both. Never infer one
call's contract from a sibling's: a same-family API can split behavior
silently — one call auto-dispatches to the platform main thread
internally, a sibling call doesn't — which has cost a P0 crash class
here. This is the seam-risk that replaces implementation risk once
commodity is adopted; it is not an argument for hand-rolling, it is the
discipline that makes adoption safe. Where the platform's own rules are
non-negotiable (AppKit main-thread affinity, single-threaded webviews),
the seam belongs in Mill's code as an explicit, testable indirection
rather than a convention someone must remember.
