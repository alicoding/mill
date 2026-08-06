# ADR-0002: CI/CD pipeline, phased rollout

## Status
accepted — Phase 1 (module rename + lint/build CI) shipped 2026-08-06;
Phases 2-4 not yet done

## Context
Mill currently has zero CI (no `.github/` at all), zero lint config, zero
tests, and zero test framework in either the Go module or `frontend/`.
CLAUDE.md already locks "CI/CD from day one" in principle; this ADR is what
makes that real, sequenced so each phase is independently mergeable and low-
risk rather than one large PR. wailsapp/wails's own v3 CI
(`build-and-test-v3.yml`, `cross-compile-test-v3.yml`, `release-v3.yml`) is
directly reusable precedent, already researched: native-OS runner matrix,
`arduino/setup-task@v2` driving the same Taskfile-based build Mill already
has, a cheap preflight job before the expensive matrix, no GoReleaser
(hand-rolled `go build` + release steps — wailsapp/wails#747 was closed
wont-fix on native GoReleaser support). One real constraint shapes the test
plan directly: `HotkeyService` needs a live macOS Cocoa run loop to register
and fire global hotkeys, which desktop mode has and Wails3's server mode
does not — no headless/CI environment can exercise it, and the test plan
below treats that as a documented gap, not something to silently skip.

This ADR assumes ADR-0001's module rename lands first (Phase 1 needs a real
module path to reference in `go.mod`-aware CI steps).

## Decision drivers
- There are currently zero tests. A test job that runs against nothing is
  theater, not a gate — it must not be added until it has something real to
  block on.
- No Rust/cargo anywhere in the build/dependency pipeline (golangci-lint,
  govulncheck, and Playwright's prebuilt browser binaries are all
  cargo-free — confirmed, not assumed, against what each actually ships).
- No AI API calls / phone-home telemetry from Mill's shipped binary. This is
  a constraint on what Mill *ships*, not on CI tooling's own build-time
  network use — worth stating explicitly so it isn't misapplied to, e.g.,
  `govulncheck`'s query to the Go vulnerability DB, which never touches the
  shipped binary. Any CI tool that *does* phone home by default must still
  be disableable; flagged per-tool below where relevant.
- Single Go module, single binary — no release artifact that isn't
  `task build`'s own output plus OS packaging already defined in
  `build/Taskfile.yml` and its per-platform includes.
- "Small, reviewable steps" (CLAUDE.md) — each phase must be a mergeable
  unit on its own, not a placeholder for a future big-bang.

## Options

### Phase sequencing: big-bang vs. phased (recommended: phased)
- **Big-bang**: land lint + test + E2E + release CI in one PR.
  - Cons: violates "small, reviewable steps" directly; couples unrelated
    risk (a flaky new Playwright job blocking an unrelated lint fix);
    forces writing tests just to justify the CI job that runs them, rather
    than tests arriving when there's real logic to test (ADR-0001's
    `internal/domain`/`internal/adapters` split hasn't landed yet, so
    there's nothing real to unit-test today).
- **Phased** (recommended): four independently-mergeable phases, each
  useful on its own even if the next phase never lands.

### Phase 1 — module rename + minimal CI (lint + build only)
- `go.mod`: `module changeme` → confirmed path (ADR-0001).
- `.github/workflows/ci.yml`, triggered on push/PR to `main`:
  - `lint-go`: `golangci-lint-action@v9`, v2 config schema
    (`version: "2"` in `.golangci.yml`, per Q2). **Merge-blocking.**
  - `build-go`: `go build ./...` on `macos-latest` (primary target —
    Mill is a macOS-first desktop app per SPEC.md) and `ubuntu-latest`
    running `task build:server` (confirmed working this session in server
    mode, so a Linux compile check is real signal, not speculative).
    **Merge-blocking.**
  - `lint-frontend`: ESLint flat config + typescript-eslint (matches the
    current `npm create vite -- --template react-ts` default per Q3).
    **Merge-blocking.**
  - `build-frontend`: `tsc && vite build` (existing `npm run build`
    script, unmodified). **Merge-blocking.**
- No test job. None exist; not adding a hollow one.
- Risk: near-zero — these are checks against code that already has to
  compile and lint cleanly to be mergeable today by hand anyway.

### Phase 2 — internal/ restructuring (ADR-0001)
- Not new CI surface — `go build ./...` and golangci-lint already recurse
  into new packages automatically. Called out here only for sequencing:
  this phase must land *after* Phase 1's CI exists (so the restructuring
  PR is itself checked by real CI) and *before* Phase 3 (so there's
  something real — `internal/adapters/markdown`, etc. — to write tests
  against).

### Phase 3 — real tests + test job + Playwright E2E smoke
- **Go unit tests**: first table-driven tests land against the packages
  Phase 2 created — `internal/adapters/markdown` (pure function, easy),
  `internal/domain/runbook` (orchestration logic, mockable adapters).
  `internal/adapters/clipboard` is harder: it depends on real macOS
  clipboard state via `osascript`. Flag explicitly, same caveat class as
  `HotkeyService` below — either skip it in CI with a documented reason
  (`t.Skip` behind a `-short`/CI env check) or accept it's covered only by
  the manual `run-mill` check, not faked with a mock that proves nothing
  about the real macOS clipboard API. Recommend skip-with-reason, not mock —
  a passing mock-only test for an `osascript` wrapper gives false
  confidence about the one thing that can actually break (macOS clipboard
  flavor handling).
  - `go test ./... -race -cover`, **merge-blocking once these tests exist**
    (not before — matching the "no hollow gate" driver above).
- **govulncheck**: `golang/govulncheck-action@v1`, added as **advisory,
  non-blocking** (`continue-on-error: true` or a non-required status check)
  — it's self-described experimental per Q2, and its outbound query to the
  vuln DB is CI-time-only, never in the shipped binary (see driver above).
  Cheap enough to include now for visibility rather than waiting for it to
  formally stabilize.
- **Frontend unit tests**: Vitest, sharing the existing Vite config (Q3).
  Scope honestly: `frontend/` today is mostly composition over Primer
  components with little pure logic — this phase wires the *capability*
  (config, CI job) even if the initial test count is small; it does not
  invent test scope that doesn't exist yet.
- **Playwright E2E smoke**: `playwright.config.ts` `webServer` launches
  `task build:server && ./bin/mill-server` and polls the URL before running
  tests — confirmed directly from Playwright's own docs (Q3), not assumed;
  this turns the exact manual server-mode+Playwright pattern used earlier
  this session into a real CI job. Runs on `ubuntu-latest`,
  `npx playwright install --with-deps`, `reuseExistingServer:
  !process.env.CI` (Playwright's documented CI-safe default). Covers
  Runbook List/Run and any other browser-visible behavior. **Merge-blocking**
  once it exists and is stable (allow one settle-in period as non-blocking
  if it proves flaky at first — a judgment call at implementation time, not
  decided here).
  - Before this lands: verify Playwright's own opt-out telemetry mechanism
    (Microsoft added anonymous CLI telemetry to Playwright; the exact
    disable knob needs a one-time check at implementation time against
    current Playwright docs, not asserted here from memory) — the
    "CI tool telemetry must be disableable" driver applies to it directly
    and this hasn't been verified yet, flagging rather than guessing.
- **`HotkeyService` — explicit non-CI gate.** Three options considered:
  - **A. Silently skip / best-effort**: rejected outright — this is exactly
    the "fake-pass, silently skip" failure mode this ADR was explicitly told
    not to allow.
  - **B. Explicit manual verification checklist (recommended)**: any PR
    touching `hotkeyservice.go` or `internal/adapters/hotkey` (ADR-0001)
    requires a manual desktop-mode check via the project's own `run-mill`
    skill, recorded in the PR description — not a CI job, because there is
    no way to make it a real CI job without a macOS session with
    Accessibility permission granted, which a stock `macos-latest` GitHub
    runner doesn't have and shouldn't be given.
  - **C. Self-hosted macOS runner with Accessibility pre-granted**: would
    give real CI coverage, but is real ongoing operational overhead (a
    physical or persistent VM under Ali's maintenance, credential/permission
    management) for one feature. Not justified today at two Runbook
    actions. `PARKED` — revisit if hotkey-triggered logic grows complex
    enough that manual-only verification becomes the actual bottleneck.
  - Recommend **B** now, **C** parked explicitly rather than silently
    dropped.

### Phase 4 — release pipeline
- `.github/workflows/release.yml`, triggered on `v*.*.*` tag push.
- Preflight job: tag-version-match check before the expensive matrix runs
  (wails3's own pattern, Q1) — cheap fail-fast.
- Matrix: `macos-latest`, `windows-latest`, `ubuntu-latest`,
  `ubuntu-24.04-arm` (matches wails3's own v3 release matrix, Q1).
- `task build` (native per-platform, via existing `build/Taskfile.yml` +
  platform includes) — no GoReleaser (Q6: wailsapp/wails#747 closed
  wont-fix; the community post-build-hook pattern adds a config file and
  indirection for nothing Task + `gh release create` doesn't already do
  simpler, matching what the Wails team does for its own releases).
- `actions/attest-build-provenance` on release artifacts (wails3 precedent,
  Q1).
- Server-mode Docker image (`task build:docker`) explicitly **out of v1
  release scope** — no confirmed hosted-deployment use case in SPEC.md;
  Mill's install story is `git clone` + local build, not a hosted service.
  `PARKED`, not built into Phase 4.

## Recommendation
Phased rollout, Phases 1→4 in order, each independently mergeable: Phase 1
(module rename + lint/build, merge-blocking, no tests) lands first since it
has zero dependency on anything else and closes the "zero CI at all" gap
immediately; Phase 2 is ADR-0001's restructuring riding on Phase 1's new
checks; Phase 3 adds real tests only once Phase 2 creates something worth
testing, with `HotkeyService` verification kept explicitly manual (Option B)
rather than faked; Phase 4 (release) waits until 1–3 are real. This ordering
means CI is genuinely useful after Phase 1 alone, not a hollow gate waiting
for a big-bang.

## Consequences
- Locks: golangci-lint v2 + ESLint flat config as the lint baseline; Task
  (via `arduino/setup-task@v2`) as the CI build driver, matching local dev;
  no GoReleaser; `HotkeyService` verification stays a documented manual
  step, not CI, until/unless Phase 4-C is revisited.
- Unlocks: every subsequent PR gets real, immediate lint/build feedback
  starting at Phase 1; the E2E smoke job reuses the exact server-mode
  pattern already validated manually this session, so Phase 3 isn't
  inventing a new verification path, just automating one that already
  works.
- Follow-ups: verify Playwright's telemetry opt-out mechanism at Phase 3
  implementation time (flagged, not resolved, here); revisit Phase 4-C
  (self-hosted macOS runner) if hotkey logic complexity grows; `govulncheck`
  may graduate from advisory to blocking once it's no longer
  self-described experimental.

## Lifecycle
- Owner: architect + Ali (raised the question)
- Maintains: this decision; the phase sequencing and blocking/advisory
  classification of each job
- Update triggers: ADR-0001 landing (Phase 2 dependency); first real test
  files existing (fires Phase 3's test-job-blocking condition);
  `govulncheck-action` graduating out of experimental status; hotkey-logic
  complexity growth reopening Phase 4-C
- Last reviewed: 2026-08-06
- Review interval: 30 days while `proposed`; 365 days once `accepted`
