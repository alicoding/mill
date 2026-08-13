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

## Acceptance (checkable)

- [ ] Every gap named in the Baseline section above is either SHIPPED
      (file/setting landed, verifiable in the repo) or REJECTED with a
      recorded reason in this file — no silent skips.
- [ ] Scorecard: Token-Permissions raised from 0 (permissions blocks
      on every workflow); the Vulnerabilities-check findings
      identified and each fixed or recorded as accepted; any other
      check adopted (e.g. SAST) green in its first run.
- [ ] Repo metadata (description, topics) set — the "is this
      abandoned?" smell gone.
- [ ] Anything deliberately deferred carries a named trigger (e.g.
      "first release when X"), not an open-ended someday.
