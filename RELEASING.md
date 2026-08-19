# Releasing Mill

The operational-readiness checklist for a tagged release. Betas need
none of this — every merge to `main` publishes one automatically,
which is the continuous rehearsal of steps 3–4.

1. **Green line.** `main`'s latest run is green and the newest beta
   boots (`gh run list -b main -L 1`; install or update to the
   latest beta and open it).
2. **Changelog + version.** Review and merge the release-please PR —
   it assembles `CHANGELOG.md` from merge titles and bumps the
   version. `main.go`'s `millVersion`, `build/config.yml`, and the
   tag must agree (release.yml's verify step enforces it).
3. **Tag → publish.** Pushing the release-please tag runs
   `release.yml`: clean build, version-stamp verification, zip +
   SHA256SUMS, GitHub release. The release body keeps manual-install
   instructions below the in-app-notes marker.
4. **Prove the update path.** On a machine running the PREVIOUS
   release: Settings → Updates → Check for updates → Update now →
   Restart Mill; confirm the new version string. Then the
   manual-only registry pass (`.claude/rules/testing.md`) for
   OS-bound behavior: hotkey delivery, notification banner, dock
   badge, Quick Panel summon.
5. **Docs ride the release.** Any user-visible change since the last
   release has its `userdocs/` section updated (the DoD gate),
   `go generate ./internal/docsgen` output committed fresh
   (CI-enforced), and the two skills still accurate. Deferred work
   named during the release's goals has a tracking home (the
   deferred-capability register discipline) — no release ships
   "out of scope" sentences with nowhere to land.
6. **Rollback stance.** The previous release stays downloadable; a
   bad release is superseded by tagging the fix — releases are never
   deleted out from under updaters.
