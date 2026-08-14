# 0050 — Codebase structure audit against OSS conventions

**Raised:** 2026-08-13, owner-directed alongside 0049: audit Mill's
repo layout and code organization against what the OSS community
actually expects — the owner notes flat structure is a recurring
critique target in OSS review. Mill is heading to open source
(SPEC §0's dogfood→open-source arc), so first-contributor legibility
is a real requirement, not cosmetics.

## Research first (this goal OPENS with it, per CLAUDE.md)

The known landscape to audit against — verify current state, don't
assume:

- **Go layout:** the official guidance is go.dev/doc/modules/layout
  (modest: `internal/` for private packages, `cmd/` only for multiple
  binaries). The community's golang-standards/project-layout repo
  (~50k stars) is NOT official and is itself the most-critiqued
  "standard" in Go (its own issue tracker carries the core-team
  pushback — verify and cite the current state). Mill today: single
  root `main.go` (deliberate, CLAUDE.md's layout section), `internal/`
  split into `domain/`, `adapters/`, `services/` (ports-and-adapters —
  already a named, defensible shape), no `cmd/`, no `pkg/`. A rogue
  empty `cmd/` was once removed (architecture.md's root-allowlist
  story) — any move to reintroduce it needs the multiple-binaries
  justification, which single-binary Mill deliberately lacks.
- **Frontend:** bounded-context folders enforced by dependency-cruiser
  (ADR-0012) — audit is about whether folder *contents* have stayed
  coherent (file counts per folder, dumping-ground drift in
  `shared/`), not about inventing a new scheme.
- **Root surface:** ls-lint allowlists the root; audit what a
  first-time OSS visitor sees against peer CLI/desktop repos
  (fzf/bat/glow-class, the peer set goal 0041 already calibrated
  against).
- **The flat-structure critique specifically:** identify what
  reviewers actually flag (giant packages, no domain seams, util/
  grab-bags) and check Mill's packages against those markers —
  package size distribution, `shared/`'s member count, any util-shaped
  accumulation.

## Plan shape

Audit → verdict table (conforms / deviates-deliberately-with-ADR /
deviates-fix) → an ADR recording the layout position (so future
critique has one citable answer) → only the moves the audit actually
justifies, executed with `git mv` history preservation. No
speculative reshuffling: a deliberate deviation with a recorded reason
beats conformance churn (anti-proliferation rule).

## Acceptance (checkable)

- [ ] Audit table committed (in the ADR or this file): every
      top-level directory + every `internal/` package + every
      `frontend/src/` folder, each with a verdict and a reason.
- [ ] An ADR states Mill's layout position against the official Go
      guidance and the project-layout controversy, citable when OSS
      contributors ask.
- [ ] Any structural moves the audit justified are done via `git mv`,
      green suite, no import-cycle regressions; if the audit
      justifies zero moves, the ADR says so explicitly (a verdict,
      not silence).
- [ ] ls-lint/dependency-cruiser configs updated in the same change
      for anything that moved.
- [ ] SPEC.md layout/§9 status bullet updated (same-change rule).
