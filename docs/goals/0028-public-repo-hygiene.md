# 0028 — Public-repo hygiene: the converged-standard baseline

## Goal
Owner-mandated ("configure rules for anything missing to keep the
codebase tight since we are now on public repo"). Research delivered
2026-08-12 (community-profile score 28%; exposure sweep CLEAN; LICENSE
already correct — Apache-2.0 with reasoning recorded): close the real
gaps, skip the ceremony.

## Plan (each item cites its standard; the research report is the brief)
1. [ ] README rewrite replacing the Wails scaffold: what Mill is
   (SPEC §1's positioning), honest pre-1.0/UX-PROTOTYPE status, git
   clone + task setup:hooks + task dev install, pointers to
   SPEC/CLAUDE.md (never duplicating them), keep the CI badge.
   No screenshots of surfaces SPEC itself tags as PROTOTYPE.
2. [ ] SECURITY.md: GitHub private-vulnerability-reporting as the
   channel (enable in repo settings — no email PII); an honest
   scope paragraph (guardrailed command execution, keychain secrets,
   loopback unauthenticated MCP listener); pre-1.0 rolling-main
   support note.
3. [ ] Minimal CONTRIBUTING.md (solo-maintained; CLAUDE.md is the
   process; task setup:hooks mirrors CI; issue-before-large-PR).
   One minimal bug-report issue template (reuses the build-identity
   badge value as the version field — SPEC §3.8's own signal).
4. [ ] OpenSSF Scorecard workflow (official template, scheduled,
   README badge) — the repo's ADR-0034 posture should score well
   immediately; zero ongoing maintenance.
5. [ ] golangci-lint strengthening, two passes: first
   gosec/bodyclose/noctx/revive/unparam (security + HTTP-client
   hygiene matching what the code actually does) + full triage;
   second pass gocritic/prealloc/contextcheck/sqlclosecheck once
   clean. NEVER the `all` preset (ceremony linters fight house
   conventions).
6. [ ] dependency-review-action gains deny-licenses (GPL/AGPL
   variants) — one line in ci.yml.
7. [ ] The elkjs EPL-2.0 verdict note (SPEC flags it, never
   resolves): dynamic-import-as-separate-chunk under EPL-2.0, a
   short recorded paragraph.
8. [ ] Cosmetic: de-literal the two /Users/ali paths
   (.claude/agents/test-investigator.md, launchatlogin test).

## Skip list (recorded so nobody re-litigates)
CODE_OF_CONDUCT (until a second contributor exists), PR templates,
FUNDING.yml, go-licenses as standing CI, golangci `all` preset —
each with reasons in the research report.

## Acceptance
Community profile score jumps; a security researcher knows where to
report and what's in scope; gosec-first-pass clean; a GPL dependency
cannot enter via PR; README describes Mill truthfully.
