# 0024 — CI/CD target architecture + operating-model completion

## Goal
Finish what ADR-0034 started: main is ruleset-gated, green, and the
pipeline matches the researched target architecture (budgets, sharding,
path filtering, hardening) — done once, properly, per the owner's
explicit bar.

## Plan
1. [x] ADR-0034 (operating model), secret-scanning/push-protection/
   Dependabot-security enabled, 275-commit catch-up pushed (2026-08-11).
2. [ ] Land the e2e triage fixes + the test-go macos fix; push; verify
   the first green main run.
3. [x] Implement the target architecture from the research report
   (in the CI deep-research agent's output, treat as the brief):
   `changes` job (dorny/paths-filter, SHA-pinned, docs-only skip),
   per-job `timeout-minutes` (~3× baseline), `fail-fast: false` on
   build-go, e2e as 3-shard matrix with `workers: 1` (fixes the
   contention behind the 14 CI-only failures), single `ci-gate`
   aggregator job, dependabot.yml (grouped weekly, capped), SHA-pin all
   actions + enable `sha_pinning_required`, explicit
   `permissions: contents: read`, dependency-review job, CODEOWNERS on
   .github/, README CI badge.
   **Done 2026-08-11, file-level only** — `.github/workflows/ci.yml`
   restructured (the `changes`/`ci-gate` jobs, per-job timeouts,
   `fail-fast: false` on build-go, the 3-shard e2e matrix,
   `permissions: contents: read`, the `dependency-review` job),
   `.github/dependabot.yml` and `.github/CODEOWNERS` added, README CI
   badge added, `frontend/playwright.config.ts` moved to
   `workers: process.env.CI ? 1 : 4`. Every third-party action across
   `ci.yml`/`release.yml`/`seed-liveness.yml` is now pinned to a full
   commit SHA (verified to exist via `gh api repos/<owner>/<repo>/
   commits/<sha>` for all 11), with a `# vX.Y.Z` trailing comment
   Dependabot's `github-actions` ecosystem keeps current. **Enabling
   the repo-settings `sha_pinning_required` toggle itself is explicitly
   NOT part of this item's completion** — it's a GitHub repo setting,
   same category as the ruleset in item 4, left for the orchestrator
   to flip once these files are proven green in real CI (this session
   was scoped to files only, no repo-settings access).
4. [ ] Create the ruleset (block direct push/force-push/deletion,
   require PR + the `ci-gate` check, owner bypass "for pull requests
   only"); dry-run a direct push to confirm rejection.
5. [x] Amend ADR-0034 with the adopted budgets (≤7min target / 10min
   DORA ceiling; 3-consecutive-breach escalation rule; retry-quarantine
   policy) — un-defer its path-filtering deferral with the job-level
   `if:` pattern rationale. Done in the same change as item 3 — see
   ADR-0034's own Update section.

## Acceptance
A PR through the new ruleset goes green inside the budget; a direct
push to main is rejected; a docs-only PR merges via fast-skipped jobs
without hanging any required check.
