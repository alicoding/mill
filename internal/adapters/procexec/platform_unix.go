//go:build darwin || linux

package procexec

import (
	"os/exec"
	"syscall"
)

func platformSupported() bool { return true }

func configureProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// terminateProcessGroup signals every process sharing pgid. Errors are
// deliberately ignored because cancellation races a process exiting naturally.
func terminateProcessGroup(pgid int) {
	_ = syscall.Kill(-pgid, syscall.SIGTERM)
}

func forceKillProcessGroup(pgid int) {
	_ = syscall.Kill(-pgid, syscall.SIGKILL)
}
