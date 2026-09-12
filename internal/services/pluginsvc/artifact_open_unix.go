//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package pluginsvc

import (
	"os"
	"syscall"
)

func openArtifactFile(root *os.Root, name string) (*os.File, error) {
	return root.OpenFile(name, os.O_RDONLY|syscall.O_NONBLOCK, 0)
}
