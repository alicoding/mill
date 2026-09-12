//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package pluginsvc

import (
	"context"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestCompleteArtifactIdentityRefusesFIFOWithoutBlocking(t *testing.T) {
	root := t.TempDir()
	if err := syscall.Mkfifo(filepath.Join(root, "pipe"), 0o600); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := completeArtifactIdentity(context.Background(), root)
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("FIFO entered a complete artifact identity")
		}
	case <-time.After(time.Second):
		t.Fatal("complete artifact identity blocked opening a FIFO")
	}
}

func TestCompleteArtifactIdentityRefusesFinalEntryReplacement(t *testing.T) {
	for _, replacement := range []struct {
		name    string
		replace func(string) error
	}{
		{name: "in-root symlink", replace: func(path string) error {
			if err := os.Rename(path, path+".original"); err != nil {
				return err
			}
			return os.Symlink("main.js.original", path)
		}},
		{name: "fifo", replace: func(path string) error {
			if err := os.Remove(path); err != nil {
				return err
			}
			return syscall.Mkfifo(path, 0o600)
		}},
	} {
		t.Run(replacement.name, func(t *testing.T) {
			root := t.TempDir()
			writeArtifactFile(t, root, "main.js", "fixture")
			replaced := false
			done := make(chan error, 1)
			go func() {
				_, err := completeArtifactIdentityWithOpen(context.Background(), root, func(opened *os.Root, name string) (*os.File, error) {
					if !replaced {
						replaced = true
						if err := replacement.replace(filepath.Join(root, name)); err != nil {
							return nil, err
						}
					}
					return openArtifactFile(opened, name)
				})
				done <- err
			}()
			select {
			case err := <-done:
				if err == nil {
					t.Fatal("replacement entered a complete artifact identity")
				}
			case <-time.After(time.Second):
				t.Fatal("complete artifact identity blocked on a replaced entry")
			}
		})
	}
}
