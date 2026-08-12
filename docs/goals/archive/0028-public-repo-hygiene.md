# 0028 — Public-repo hygiene: the converged-standard baseline

## Goal
Owner-mandated ("configure rules for anything missing to keep the
codebase tight since we are now on public repo"). Research delivered
2026-08-12 (community-profile score 28%; exposure sweep CLEAN; LICENSE
already correct — Apache-2.0 with reasoning recorded): close the real
gaps, skip the ceremony.

## Plan (each item cites its standard; the research report is the brief)
1. [x] README rewrite replacing the Wails scaffold: what Mill is
   (SPEC §1's positioning), honest pre-1.0/UX-PROTOTYPE status, git
   clone + task setup:hooks + task dev install, pointers to
   SPEC/CLAUDE.md (never duplicating them), keep the CI badge.
   No screenshots of surfaces SPEC itself tags as PROTOTYPE.
2. [x] SECURITY.md: GitHub private-vulnerability-reporting as the
   channel (enable in repo settings — no email PII); an honest
   scope paragraph (guardrailed command execution, keychain secrets,
   loopback unauthenticated MCP listener); pre-1.0 rolling-main
   support note. PVR enabled live via `gh api
   repos/alicoding/mill/private-vulnerability-reporting -X PUT`,
   verified `{"enabled":true}`.
3. [x] Minimal CONTRIBUTING.md (solo-maintained; CLAUDE.md is the
   process; task setup:hooks mirrors CI; issue-before-large-PR).
   One minimal bug-report issue template (reuses the build-identity
   badge value as the version field — SPEC §3.8's own signal).
   `.ls-lint.yml`'s root regex extended for SECURITY/CONTRIBUTING
   (README's own pattern; CODE_OF_CONDUCT deliberately NOT
   pre-added, per the skip list).
4. [x] OpenSSF Scorecard workflow (official template, scheduled,
   README badge) — the repo's ADR-0034 posture should score well
   immediately; zero ongoing maintenance. Template + badge URL
   fetched live from ossf/scorecard-action's own README and
   ossf/scorecard's own scorecard-analysis.yml; actions pinned to
   the same SHAs this repo's other workflows already use for the
   same action versions (verified via `gh api .../tags`, not
   assumed).
5. [x] golangci-lint strengthening, first pass:
   gosec/bodyclose/noctx/revive/unparam enabled + full triage (see
   commit for the itemized findings/fixes — one real bug found and
   fixed: `mcpserving.Serve`'s `http.Server` had no
   `ReadHeaderTimeout`, a genuine Slowloris exposure even on a
   loopback listener). revive's `exported`/`package-comments` rules
   disabled in `.golangci.yml` with an inline reason (this repo has
   never doc-commented every exported symbol; enforcing it
   retroactively is ceremony, not a real finding — bodyclose found
   nothing to fix). **Second pass (gocritic/prealloc/contextcheck/
   sqlclosecheck) is explicitly NOT this goal — future work.**
6. [x] dependency-review-action gains deny-licenses (GPL/AGPL
   variants) — one line in ci.yml.
7. [x] The elkjs EPL-2.0 verdict note (SPEC flags it, never
   resolves): dynamic-import-as-separate-chunk under EPL-2.0, a
   short recorded paragraph.
8. [x] Cosmetic: de-literal the two /Users/ali paths
   (.claude/agents/test-investigator.md, launchatlogin test).

## Skip list (recorded so nobody re-litigates)
CODE_OF_CONDUCT (until a second contributor exists), PR templates,
FUNDING.yml, go-licenses as standing CI, golangci `all` preset —
each with reasons in the research report.

## Acceptance
Community profile score jumps; a security researcher knows where to
report and what's in scope; gosec-first-pass clean; a GPL dependency
cannot enter via PR; README describes Mill truthfully.

**DELIVERED 2026-08-12** — checked against what shipped: README/
SECURITY/CONTRIBUTING/issue-template all present and truthful (README
adds the actually-needed toolchain prerequisites CLAUDE.md's own
commands assume but never state — Go/Node/Task/Wails3 CLI — so the
documented install story is real, not aspirational); PVR verified
enabled live (`{"enabled":true}`); Scorecard workflow + badge live,
template/SHAs verified against upstream, not assumed; golangci-lint
first pass (gosec/bodyclose/noctx/revive/unparam) fully triaged to
zero issues on both the `server` and desktop build-tag variants (own
config-behavior check run before trusting the revive rule disables);
one real bug found and fixed along the way
(`mcpserving.Serve`'s missing `ReadHeaderTimeout`); dependency-review
deny-licenses live in ci.yml; elkjs EPL-2.0 verdict recorded in
SPEC.md §3; both literal `/Users/ali` paths de-literalized, with the
touched test re-run. Full local suite (Go, frontend static, e2e) green
via test-investigator — 4 known-flaky e2e specs unrelated to any file
this goal touched (canvas-click timing, resizable-table drag timing,
live-run-state polling, activity-row propagation), reproduced as
flaky (pass-on-retry) in isolation, not a regression.
