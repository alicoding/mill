package settingssvc

import (
	"fmt"

	"github.com/alicoding/mill/internal/adapters/buildinfo"
	"github.com/alicoding/mill/internal/adapters/windowing"
)

// BuildInfo is what's actually running, not what the source tree looks
// like -- the two can silently diverge (a desktop app process
// staying up across many commits, showing hours-
// stale UI, with nothing anywhere flagging it). Wails3's own SDK reads
// the identical runtime/debug.ReadBuildInfo() data (application_debug.go)
// but only wires it up under `!production` and never exposes it to the
// frontend -- this is Mill's own copy, unconditional on any build tag,
// specifically so it's visible in every build, not just dev.
type BuildInfo struct {
	// Revision is the short (12-char) git commit hash the running binary
	// was built from, or "" if `go build` couldn't determine one (e.g.
	// building outside a git checkout, or with -buildvcs=false).
	Revision string
	// Modified is true when the working tree had uncommitted changes at
	// build time -- the single most useful bit here: it's the difference
	// between "this binary is an old commit" (rebuild it) and "this
	// binary has changes that were never committed at all" (a different,
	// more concerning kind of stale).
	Modified bool
	// Server is true in the `server` build (headless HTTP mode) -- the
	// AUTHORITATIVE native-vs-server signal for the frontend. Found the
	// hard way (goal 0021 dogfooding): `'_wails' in window` is true in a
	// plain browser tab on the server-mode interface too (the Wails JS
	// runtime injects it in every mode), so frontend-side detection was
	// silently wrong -- native-only chrome (the titlebar traffic-light
	// inset) rendered in server mode, and the INSTALLED/SERVER badge
	// split never actually worked. The build tag is the one place that
	// genuinely knows.
	Server bool
	// BuiltAt is the unix-millis mtime of THIS PROCESS'S OWN executable
	// file -- when it was actually linked, not when its source was last
	// committed. Deliberately not vcs.time (goal 0029, dev-liveness
	// honesty): vcs.time reflects the last COMMIT's timestamp, which
	// stays frozen across every `wails3 dev` relink of an uncommitted
	// change (vcs.modified just goes true) -- exactly the case a wedged
	// or slow rebuild watcher needs distinguished from "healthy." A
	// binary's own mtime moves on every real relink regardless of git
	// state, so the frontend can compare it against the newest mtime of
	// internal/**/*.go (vite's dev-only middleware, vite.config.ts) to
	// tell "rebuilt after this save" from "still running the old one."
	BuiltAt int64
}

// readBuildInfo delegates to internal/adapters/buildinfo -- the same
// underlying runtime/debug.ReadBuildInfo() read the state manifest
// (internal/contract, ADR-0036 decision 4) uses, extracted there at
// goal 0052 slice 2 so mcpsvc (which cannot import settingssvc, a
// one-way edge) reads identical values instead of a second copy of this
// logic. Confirmed directly, not assumed: Wails3's own startup log
// ("Build Info: ... vcs.revision=... vcs.modified=...") already proved
// this data is present in exactly this build setup.
func readBuildInfo() BuildInfo {
	info := buildinfo.Read()
	return BuildInfo{
		Revision: info.Revision,
		Modified: info.Modified,
		Server:   info.Server,
		BuiltAt:  info.BuiltAt,
	}
}

// ExportContract returns the root contract document (goal 0052 item 6):
// every envelope schema, the node-type catalog, the import/update rule,
// and this instance's live manifest, as one JSON document -- the
// Settings page's Export contract action, and the same document
// mill://contract serves over MCP (MillMCPService.ContractDocument).
func (s *SettingsService) ExportContract() (string, error) {
	if s.mcpService == nil {
		return "", fmt.Errorf("MCP service not running")
	}
	return s.mcpService.ContractDocument()
}

// ExportSkillDoc returns the mill://skill proficiency doc (goal 0160):
// the practice-layer companion to ExportContract's reference document,
// alongside it rather than merged into it -- mill://contract stays a
// pure JSON schema document, and the skill doc is markdown prose, so
// the two travel as separate exports through the same Settings →
// Contract section and the same late-bound s.mcpService proxy.
func (s *SettingsService) ExportSkillDoc() (string, error) {
	if s.mcpService == nil {
		return "", fmt.Errorf("MCP service not running")
	}
	return s.mcpService.SkillDocument()
}

// QuitApp closes this application instance -- the stale-build badge's
// one-click action (docs/SPEC.md §3.8): when a fresh bundle detects an
// orphaned old binary behind it, the fix is quitting the stale
// instance (the current `task dev` already runs a fresh one), and
// making the badge itself the action beats hunting for the right
// window (asked for directly). The frontend only offers it inside the
// native webview -- a browser tab on the shared server-mode instance
// must never be able to kill the server out from under other clients.
func (s *SettingsService) QuitApp() {
	if s.confirmLeaveOnce(leaveReasonQuit) {
		windowing.Quit()
	}
}
