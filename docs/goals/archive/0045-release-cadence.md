# Goal 0045 — v0.2.0 and release cadence

Owner-picked 2026-08-13, deliberately tiny. v0.1.0 (goal 0041)
proved the pipeline; this makes releases a rhythm instead of a
one-off, without adding tooling before the recorded trigger
(release-please stays deferred until the 2nd+ release exists — see
archived goal 0041's defer list).

## Goal

A recorded, lightweight cadence rule plus the next release cut by it.

## Plan

Cadence rule (adopt unless the owner objects at cut time): **a
release tags when a user-visible capability goal archives**, not on a
clock — the release notes then describe something a user can feel.
Concretely next: v0.2.0 cuts when goal 0042 (markdown fidelity pass
2) archives, bundling whatever else landed since v0.1.0 (icon,
React 19, fidelity pass 1). Mechanics per 0041: bump
build/config.yml version in a PR, tag the merged commit, release.yml
does the rest (now with timeouts and the headless-bindings guard).

## Acceptance (checked against what SHIPPED, 2026-08-13)

- [x] v0.2.0 live on GitHub Releases with attestation verified, cut
      after 0042 archived — asset is the launchable `mill.app` zip
      (structure + ad-hoc signature + arm64 binary verified against
      the actually-downloaded artifact; `gh attestation verify`
      passing). Delivered via PRs #86 (task package + ditto zip +
      install notes; the owner's real v0.1.0 download hitting
      Finder's no-application dialog was the trigger), #87 (version +
      SPEC), #88 (two more latent-defect fixes the cut surfaced:
      run:| indentation broke release.yml's YAML — now gated by
      scripts/check-workflow-yaml.sh in lefthook + CI's new
      workflow-lint job with actionlint; and arduino/setup-task's
      GPL-3 action wrapper tripping deny-licenses — replaced by
      go install of the MIT tool). Release run 31746776720 green.
- [x] The cadence rule recorded in SPEC.md §1.3 (LOCKED) in the same
      change as the version bump (PR #87), including the
      app-is-the-asset / clone-build-stays-documented split.
