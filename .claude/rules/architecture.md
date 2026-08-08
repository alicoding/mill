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
