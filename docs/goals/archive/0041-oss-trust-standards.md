# Goal 0041 — OSS trust standards: adopt the signals, reject the ceremony

Owner-directed 2026-08-13 ("anything to make our project follow more of
the OSS standard and create trust — let's research and establish that
too"), immediately after the README hero landed (PR #61). Successor to
archived goal 0028 (public-repo hygiene), which delivered the first
wave: README rewrite, SECURITY.md + PVR, CONTRIBUTING.md, bug-report
template, Scorecard workflow + badge, golangci-lint triage,
dependency-review.

## Goal

Mill reads as a trustworthy, standards-following open-source project to
a stranger evaluating it — via the signals high-trust projects actually
converge on — while explicitly rejecting solo-repo ceremony (the
anti-proliferation rule: every adoption names the concrete trust signal
it buys; every rejection records why).

## Baseline (inventoried 2026-08-13, facts not guesses)

- HAS: Apache-2.0 LICENSE; SECURITY.md + private vulnerability
  reporting; CONTRIBUTING.md; bug_report.md; CODEOWNERS (workflow
  files); dependabot.yml (gomod/npm/actions weekly grouped); Scorecard
  workflow + badge; ruleset-protected main + required checks;
  SHA-pinned actions; release.yml (tag-triggered, macOS, provenance
  attestation) that has NEVER run — zero tags/releases; README
  hero/badges.
- GAPS: repo description/homepage EMPTY; no topics; no PR template; no
  feature-request template / issue config.yml; no SUPPORT.md; no
  CHANGELOG or any release ever cut; Discussions off.
- Live Scorecard 5.0/10 — zeros on Token-Permissions (workflows lack
  `permissions:` blocks), SAST (no CodeQL), CII-Best-Practices (no
  badge), Maintained (repo <90 days — time fixes it), Code-Review
  (solo self-merge — structural); Branch-Protection 3; Vulnerabilities
  5 (findings unidentified); Pinned-Dependencies 7.
- Recorded prior decisions that stand: CODE_OF_CONDUCT deferred until
  a second contributor exists (goal 0028); no GoReleaser (ADR-0002).

## Plan

Research first (agent dispatched 2026-08-13): the OpenSSF/GitHub
community-standards checklist + what visibly high-trust solo projects
adopt vs. skip, mapped against the baseline above. Then implement the
accepted subset as one PR (or two if config-only GitHub-settings
changes separate cleanly from file changes), recording each
reject-with-reason below as the research resolves.

## Slice 1 — mechanical Scorecard fixes (2026-08-13, ahead of the
research report since the tool itself names the fix)

- Vulnerabilities (was 5 findings): `golang.org/x/image` v0.41.0 →
  v0.43.0 (4 advisories: GO-2026-4961/5061/5062/5066, webp/tiff decode
  panics — indirect dep, CI govulncheck was green because the
  vulnerable paths are uncalled; bumped anyway, zero-cost);
  `nanoid` 3.3.17 → 3.3.18 (GHSA-2v37-7h3g-55p8, transitive of
  vite→postcss, lockfile-only bump).
- Token-Permissions (was 0): top-level `permissions: read-all` added
  to release.yml and seed-liveness.yml — both already had correct
  job-level elevations; only the workflow-level default was missing.
  ci.yml and scorecard.yml were already compliant.
- Pinned-Dependencies (was 7): the three container base images
  digest-pinned (Dockerfile.cross's golang:1.26-bookworm,
  Dockerfile.server's golang:alpine + distroless/static-debian12,
  digests as resolved by Scorecard's own remediation output);
  dependabot.yml gains a `docker` ecosystem entry so the digests
  don't rot. ACCEPTED, not fixed, two remaining warns:
  Dockerfile.cross's Zig download already verifies sha256 against
  Zig's official manifest (Scorecard can't see through the manifest
  indirection — a false positive in effect), and
  build/linux/appimage/build.sh downloads linuxdeploy's `continuous`
  tag (a rolling release with no stable digest; the whole file is
  Wails scaffold for a PARKED platform per release.yml's own note —
  not worth hand-patching vendored scaffold for a platform Mill
  doesn't ship).

## Slice 2 — research verdicts applied (2026-08-13; the research
report's full sources live in the session transcript, its verdicts
here)

Calibration finding that frames everything: live Scorecard for
respected small projects — fzf 6.5, bat 5.5, glow 4.9, cli/cli 6.8 —
with Token-Permissions 0 for ALL of them, SAST 0 for 3/4,
CII-Best-Practices 0 for all (none even has a bestpractices.dev
entry, checked directly). Mill's 5.0 was never broken relative to its
peer set; only specific cheap items were worth fixing.

ADOPTED:
- PR template (`.github/pull_request_template.md`) — the one
  community-checklist item 3/4 of the comparison set carries that
  Mill lacked.
- Repo description + topics set via `gh repo edit` (was empty — the
  "is this abandoned?" smell). Homepage left unset: there is no
  website, and pointing it at the repo itself is noise.
- CodeQL default setup enabled (Go + JS/TS) — additive to the gosec
  already running in golangci (Scorecard's SAST check only recognizes
  CodeQL/SonarCloud uploads; gosec is real but structurally
  invisible to it); free on public-repo runners; GitHub-managed, no
  workflow file to maintain.
- (Slice 1 above: permissions, vulnerability bumps, image pins.)

DEFERRED, each with a named trigger:
- GitHub Discussions — flip when a second contributor/user exists
  (the same trigger already recorded for CODE_OF_CONDUCT).
- release-please changelog automation — after the 2nd+ release
  exists; automating notes before one release ever shipped is
  ceremony. (git-cliff REJECTED outright regardless: Rust binary,
  hard-constraint violation even CI-only.)
- SBOM on releases — when an actual consumer asks.
- Uploading the provenance-attestation bundle as a release asset —
  only moves Scorecard's Signed-Releases number; the substantive
  mechanism (`gh attestation verify <binary> -R alicoding/mill`)
  already works via the existing attest-build-provenance step.

REJECTED with reasons (don't relitigate):
- OpenSSF Best Practices badge — zero adoption in the comparison set
  (fzf/bat/cli-cli/wails all absent from bestpractices.dev's index);
  ~40% hand-written self-certification prose.
- SUPPORT.md / issue-template config.yml / feature-request template —
  optional-only per GitHub's own docs; absent from every comparison
  repo without registering as a gap.
- REUSE/SPDX per-file headers — solves multi-license ambiguity Mill
  (single Apache-2.0, copyleft-denylisted ingestion in CI) doesn't
  have.
- ADOPTERS.md / ROADMAP.md — BACKLOG.md already is the public
  roadmap; a second register is the exact anti-pattern
  delivery-discipline.md forbids.
- Chasing Scorecard checks a solo repo structurally can't move:
  Code-Review (needs a second human), Maintained (time-gated — repo
  created 2026-08-06, floored at 0 until ~2026-11-04, then resolves
  itself given daily commits), Branch-Protection's
  require-approvers items (would deadlock the solo self-merge flow
  ADR-0034 built).

OWNER DECISION SURFACED (outward-facing, not taken autonomously):
- Cut v0.1.0 via the existing never-fired release.yml — **owner
  approved 2026-08-13, DELIVERED same day** after three attempts that
  were themselves the dogfood payoff: attempt 1 hung 63 minutes
  (cancelled by hand), attempt 2 hit the new 30-minute job timeout,
  and the flushed logs surfaced TWO real latent defects fixed in the
  process — (a) `generate:bindings` always runs on a fingerprint-less
  fresh checkout and extracts bindings by LAUNCHING the real app,
  which never exits headless (`MILL_SKIP_BINDINGS=1`, set only by
  release.yml, now uses the committed bindings; PR #79, plus
  timeout-minutes 5/30/10 on the three jobs); (b) the root `build`
  task's help echo wrapped `task package`/`task run` in backticks
  inside a sh string — command substitution, so printing the message
  executed both tasks and launched the app; both hangs died in
  `darwin:run`, and any local `task build` did the same (the probable
  source of Standing #8's phantom concurrent instances; PR #80,
  plain quotes). Attempt 3: green in ~6 minutes end to end. Release
  v0.1.0 is live with `mill-0.1.0-macos-arm64` + `SHA256SUMS`,
  generated notes, and `gh attestation verify
  mill-0.1.0-macos-arm64 -R alicoding/mill` confirmed passing against
  the actually-downloaded asset. The git-clone install story is
  unchanged; the release is the provenance/verification artifact the
  research framed it as.

## CodeQL first-run triage (2026-08-13, same day)

First scan (Go/TS/JS/Java/Actions) + the post-merge Scorecard SARIF
re-upload produced 21 code-scanning alerts; triage outcome:
- The fixed-this-goal items (Token-Permissions, Vulnerabilities, the
  server-image pins, the actions/missing-workflow-permissions hit)
  auto-closed on the post-merge runs — confirmed via the open-alerts
  API, not assumed.
- 3 real CodeQL findings, ALL in `build/android/` (java/path-injection
  ×2, unsafe-content-uri-resolution): vendored Wails3 scaffold for a
  parked platform Mill doesn't build — dismissed won't-fix with that
  reason on each alert (CodeQL dismissals persist across runs).
- Zero CodeQL findings in Mill's own Go/TS code.
- Remaining open alerts are Scorecard's own weekly-regenerating
  meta-state and match this file's recorded verdicts exactly
  (CII/Fuzzing rejected, Maintained time-gated, Code-Review/
  Branch-Protection solo-structural, the two accepted
  downloadThenRun pins, gradle-wrapper.jar in the same parked
  scaffold); SASTID should self-clear once Scorecard's next run
  detects the now-active github-code-scanning app. Left open
  deliberately — dismissing regenerating SARIF alerts is churn, and
  the Security tab staying honest about accepted state is the point.

## Acceptance (checked against what SHIPPED, 2026-08-13)

- [x] Every gap named in the Baseline section above is either SHIPPED
      (file/setting landed, verifiable in the repo) or REJECTED with a
      recorded reason in this file — no silent skips. (Shipped: PR
      template, description+topics, CodeQL, permissions, vuln bumps,
      image pins + docker Dependabot, v0.1.0 release + CHANGELOG-via-
      generated-notes. Rejected/deferred with reasons: everything in
      Slice 2's lists, incl. SUPPORT.md/config.yml/feature-request
      template, Discussions, homepage.)
- [x] Scorecard: Token-Permissions fixed (both flagged workflows;
      confirmed auto-closed in code scanning); all five
      Vulnerabilities findings identified and fixed (x/image 0.43,
      nanoid 3.3.18; confirmed auto-closed); CodeQL adopted and its
      first scan green on Mill's own code (3 vendored-scaffold
      findings dismissed with reasons). Scorecard's own aggregate
      re-scores on its weekly cron — the peer-calibration verdict
      stands regardless.
- [x] Repo metadata (description, topics) set — verified via
      gh repo edit, 10 topics live.
- [x] Anything deliberately deferred carries a named trigger:
      Discussions (second contributor), release-please (2nd+
      release), SBOM (a consumer asks), attestation-as-release-asset
      (only if the Scorecard number ever matters), TS 7 (TS 7.1
      stable compiler API — recorded in dependabot.yml itself).

Delivered across PRs #63, #70, #73 (icon rides goal 0001), #76
(version), #79/#80 (release-pipeline fixes the release exercise
itself surfaced), release run 31738976103 (v0.1.0 live, attestation
verified). Archived same day.
