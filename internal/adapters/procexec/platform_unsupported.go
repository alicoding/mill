//go:build !darwin && !linux

package procexec

import "os/exec"

func platformSupported() bool { return false }

// These helpers exist so shared lifecycle code compiles on unsupported
// platforms. Start returns ErrUnsupportedPlatform before any of them can run.
func configureProcess(_ *exec.Cmd) {}

func terminateProcessGroup(_ int) {}

func forceKillProcessGroup(_ int) {}
