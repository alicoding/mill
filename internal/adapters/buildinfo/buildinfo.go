// Package buildinfo reads what's actually running, not what the
// source tree looks like -- the two can silently diverge (a process
// staying up across many commits). It owns no domain logic, just
// runtime/debug + os plumbing, so it can be imported from either side
// of the settingssvc/mcpsvc split (settingssvc -> mcpsvc is a one-way
// edge already; neither may import the other, but both need this same
// data) without creating a cycle. Originally settingssvc's own private
// readBuildInfo (goal 0029); extracted here at goal 0052 slice 2 so the
// state manifest (internal/contract, ADR-0036 decision 4) reads the
// identical values the Settings footer already shows, instead of a
// second copy of this logic.
package buildinfo

import (
	"os"
	"runtime/debug"
)

// Info is what's actually running: the git commit the binary was built
// from, whether the tree was dirty at build time, desktop-vs-server
// mode, and when this process's own executable was last linked.
type Info struct {
	// Revision is the short (12-char) git commit hash the running binary
	// was built from, or "" if `go build` couldn't determine one (e.g.
	// building outside a git checkout, or with -buildvcs=false).
	Revision string
	// Modified is true when the working tree had uncommitted changes at
	// build time -- the difference between "this binary is an old
	// commit" (rebuild it) and "this binary has changes that were never
	// committed at all."
	Modified bool
	// Server is true in the `server` build (headless HTTP mode) -- the
	// authoritative native-vs-server signal (the build tag is the one
	// place that genuinely knows; a frontend-side runtime sniff is
	// wrong, see settingssvc.BuildInfo.Server's fuller history).
	Server bool
	// BuiltAt is the unix-millis mtime of THIS PROCESS'S OWN executable
	// file -- when it was actually linked, not when its source was last
	// committed (deliberately not vcs.time, which stays frozen across an
	// uncommitted rebuild).
	BuiltAt int64
}

// Read extracts the vcs.* build settings Go's own toolchain embeds by
// default (-buildvcs=true, the default in a git checkout).
func Read() Info {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return Info{}
	}
	var bi Info
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
	bi.Server = isServerBuild
	if exe, err := os.Executable(); err == nil {
		if st, err := os.Stat(exe); err == nil {
			bi.BuiltAt = st.ModTime().UnixMilli()
		}
	}
	return bi
}
