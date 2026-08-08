---
paths:
  - "**/*.go"
---

# Backend (Go) conventions

**Domain packages (`internal/domain/*`) stay pure: types +
validation/execution logic only, no persistence, no state.** Storage (a
settings-store-backed JSON blob, in-memory state, CRUD) lives one layer
up, in the root-package `*service.go` Wails-binding file that owns that
domain's lifecycle (`compositionservice.go` for `composition`,
`triggerservice.go` for `trigger`). Where one package's execution needs
data another layer owns (e.g. a Decision node's connector lookup), wire
it with an injected function var or a small interface (see
`composition.SetConnectorLookup`, `CompositionService`'s `Syncer`), not
a direct import of the owning service — keeps the domain package
testable standalone and free of Wails-binding concerns.

See `docs/SPEC.md` §1.4's Logical/Component-view diagram for the full
layering this rule maintains (`Bindings` → `Domain` → `Adapters`), and
`.claude/rules/architecture.md` for the broader SOLID/DRY/DDD reuse
boundary this is one concrete instance of.
