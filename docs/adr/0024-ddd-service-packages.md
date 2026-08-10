# ADR-0024: DDD application-service packages replace the flat root

## Status
accepted (supersedes the repo-layout half of ADR-0001; the module-path
half of ADR-0001 stands unchanged)

## Context

ADR-0001 kept all Wails-bound `*service.go` files flat at the repo
root in `package main`, following wailsapp/wails v3's own CLI repo
convention. That was 2 files then; it grew to ~44 hand-written Go
files (nine services plus their tests and trigger-dispatch files) —
and the owner decided directly: "I still see a lot of files in the
root, I want no flat structure enforced," refined when offered the
single-package alternative to "I want to do proper DDD."

## Research (a prior architect pass, verified against primary sources)

- **Wails3 does not require bound services in `package main`** —
  proven from the SDK's own generator source and committed test
  fixtures (`struct_literal_multiple_other` binds a service from a
  subpackage; `FindServices` scans all loaded packages and keys off
  the resolved type argument, not the call site's package). Binding
  IDs hash `<pkgpath>.<Type>.<Method>`, so every ID changes with the
  move — bindings must be regenerated and the frontend's import paths
  updated, and only the e2e suite catches a stale-bindings mismatch
  (a silent runtime failure, not a compile error).
- **`cmd/mill/` is mechanically blocked**, not merely unconventional
  (ADR-0001's original grounds): `//go:embed` cannot reach `..`, and
  `main.go` embeds `frontend/dist` and `build/appicon.png` (and now
  `docs/SPEC.md`, absorbed from the spec service, whose own embed
  could not survive its move). `main.go` stays at root.
- Root files carried no build tags; the desktop/server split lives
  entirely in `internal/adapters/{hotkey,launchatlogin}`.
- CI, lefthook, and `scripts/check-loc.sh` already operate on
  `. ./internal/...` — placing services under `internal/` needs no
  pipeline changes.

## Decision

**Per-bounded-context application-service packages under
`internal/services/`, completing the DDD layering the repo already
half-had** (domain → application → infrastructure):

```
main.go                          — entrypoint only: embeds, window/tray,
                                   event registration, service wiring
internal/services/<ctx>svc/      — application layer: Wails-bound services
internal/domain/<ctx>/           — pure domain (unchanged)
internal/adapters/<name>/        — infrastructure/ports (unchanged)
```

- **The `svc` suffix is load-bearing, not decoration**: it prevents
  package-name collisions with the `internal/domain` twins
  (composition, guardrail, trigger, capabilities) and the
  `internal/adapters` twins (execution, settings) — no alias imports
  anywhere, which was per-context packaging's worst cost in the
  design pass.
- **Cross-package wiring methods are exported with `//wails:ignore`**
  (the directive the codebase already used for `Shutdown`/
  `SetMCPService`) so nothing wiring-internal becomes a frontend RPC.
- **Shared test helpers** move to `internal/services/servicetest`;
  genuinely cross-service production helpers get a small named home
  rather than duplication.
- **Enforcement**: `.ls-lint.yml`'s root rule now allows exactly one
  root Go file (`main.go`) — a stray root `.go` fails lint locally
  (Lefthook) and in CI, the same one-rule-two-enforcers shape every
  other layout rule here uses.
- **Frontend**: generated bindings move to
  `frontend/bindings/.../internal/services/<pkg>/`; a
  `frontend/src/shared/bindings.ts` barrel makes any future
  package move a one-file frontend change.

## Consequences

- The compile-enforced service dependency graph is now real: a service
  reaching into another's internals is a compile error, the Go-side
  analogue of the frontend's dependency-cruiser boundaries (ADR-0012).
- ADR-0001's flat-root text and every doc describing "root
  `*service.go`" (CLAUDE.md, `.claude/rules/backend.md`, SPEC §1.3/
  §1.4) are updated in the same change — SPEC-tracks-everything, not
  a follow-up.
- The one-time cost paid here: full bindings regeneration, ~27
  frontend files' import rewrites, and the full verification ladder
  (build/vet/lint/tests/bindings/tsc/e2e) as the gate.
