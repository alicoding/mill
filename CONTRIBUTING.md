# Contributing to Mill

Mill is solo-maintained. Contributions are welcome, but the process is
kept deliberately light — there's no separate contributor doc to
maintain in parallel with reality.

## Process

- **Read `CLAUDE.md` first.** It's the actual working process for this
  repo (Research → Plan → Implement, coding conventions in
  `.claude/rules/`), not an AI-only artifact — it applies whether you're
  a human or an agent making the change.
- **Open an issue before a large PR.** Small fixes (typos, an obvious
  bug with an obvious fix) can go straight to a PR. Anything that adds a
  capability, changes a schema, or touches more than a couple of files
  should start as an issue so the approach can be agreed before the work
  is done — `docs/SPEC.md` is the source of truth for what Mill is and
  why, and a PR that conflicts with it needs to resolve that first.
- **Run the local checks before opening a PR.** `task setup:hooks`
  installs Lefthook's pre-commit hooks, which mirror what CI runs
  (lint, vet, build, the file-length and root-layout checks). A PR
  that fails CI's `ci-gate` required check won't merge.
- **Tests are part of the change, not a follow-up.** See
  `.claude/rules/testing.md` for what layer a given bug or feature's
  proof belongs at.

## Getting set up

See the [README](README.md#install) for the clone-and-run steps.

## Reporting a bug

Use the bug report issue template. It's short by design: what happened,
what you expected, your macOS version, and the build-identity badge
value shown in Mill's own UI (`DEV · live` / `INSTALLED · <commit>` /
`SERVER · <commit>`) — that one field tells us exactly which build you
were running.

## Reporting a security issue

Don't open a public issue — see [SECURITY.md](SECURITY.md).
