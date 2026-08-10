---
paths:
  - "**/*.go"
---

# Backend (Go) conventions

**Domain packages (`internal/domain/*`) stay pure: types +
validation/execution logic only, no persistence, no state.** Storage (a
settings-store-backed JSON blob, in-memory state, CRUD) lives one layer
up, in the Wails-bound service package under `internal/services/` that
owns that domain's lifecycle (`internal/services/compositionsvc` for
`composition`, `internal/services/triggersvc` for `trigger`). The repo
root holds exactly one Go file, `main.go` (embeds, window/tray setup,
service construction + wiring); each service is its own
bounded-context package named `<ctx>svc` — the `svc` suffix exists to
prevent package-name collisions with `internal/domain/*` and
`internal/adapters/*`, so never alias-import to work around a name.
Cross-service wiring methods called from `main.go` are exported but
marked `//wails:ignore` so they never become frontend RPCs (see
`ExecutionService.WireChildWorkflowRunner`,
`SettingsService.SetMCPService`). Shared cross-service helpers live in
`internal/services/seeding` (slug IDs, seed tombstones) and
`internal/services/servicetest` (test fakes) — a helper used by only
one package stays in that package. Where one package's execution needs
data another layer owns (e.g. a Decision node's connector lookup), wire
it with an injected function var or a small interface (see
`composition.SetConnectorLookup`, `CompositionService`'s `Syncer`), not
a direct import of the owning service — keeps the domain package
testable standalone and free of Wails-binding concerns.

See `docs/SPEC.md` §1.4's Logical/Component-view diagram for the full
layering this rule maintains (`Bindings` → `Domain` → `Adapters`), and
`.claude/rules/architecture.md` for the broader SOLID/DRY/DDD reuse
boundary this is one concrete instance of.
