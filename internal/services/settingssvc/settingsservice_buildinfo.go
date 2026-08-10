package settingssvc

import "runtime/debug"

// BuildInfo is what's actually running, not what the source tree looks
// like -- the two silently diverged this session (a desktop app process
// stayed up across an entire session's worth of commits, showing hours-
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
}

// readBuildInfo extracts the vcs.* build settings Go's own toolchain
// embeds by default (-buildvcs=true, the default in a git checkout) --
// confirmed directly, not assumed: Wails3's own startup log
// ("Build Info: ... vcs.revision=... vcs.modified=...") already proved
// this data is present in exactly this build setup, this just reads the
// same stdlib source unconditionally instead of Wails3's !production-
// gated copy of it.
func readBuildInfo() BuildInfo {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return BuildInfo{}
	}
	var bi BuildInfo
	for _, s := range info.Settings {
		switch s.Key {
		case "vcs.revision":
			bi.Revision = s.Value
			if len(bi.Revision) > 12 {
				bi.Revision = bi.Revision[:12]
			}
		case "vcs.modified":
			bi.Modified = s.Value == "true"
		}
	}
	return bi
}
