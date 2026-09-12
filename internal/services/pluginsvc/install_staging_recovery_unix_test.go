//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package pluginsvc

import (
	"context"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestStagingRecoveryPreservesLinksAndSpecialFiles(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(*testing.T, stagingRecoveryFixture) string
	}{
		{name: "candidate link", mutate: func(t *testing.T, fixture stagingRecoveryFixture) string {
			if err := os.MkdirAll(fixture.workspace, 0o700); err != nil {
				t.Fatal(err)
			}
			external := t.TempDir()
			if err := os.WriteFile(filepath.Join(external, "outside"), []byte("outside evidence"), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(external, fixture.candidate); err != nil {
				t.Fatal(err)
			}
			return filepath.Join(external, "outside")
		}},
		{name: "fifo in candidate", mutate: func(t *testing.T, fixture stagingRecoveryFixture) string {
			if err := os.MkdirAll(fixture.candidate, 0o700); err != nil {
				t.Fatal(err)
			}
			fifo := filepath.Join(fixture.candidate, "special")
			if err := syscall.Mkfifo(fifo, 0o600); err != nil {
				t.Fatal(err)
			}
			return fifo
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := newStagingRecoveryFixture(t)
			evidence := test.mutate(t, fixture)
			service := restartPluginService(t, fixture.service)
			if err := service.RecoverInstallations(); userErrorCode(err) != "install-recovery-required" {
				t.Fatalf("RecoverInstallations error = %v", err)
			}
			if _, err := os.Lstat(evidence); err != nil {
				t.Fatalf("unexpected evidence was removed: %v", err)
			}
			records, err := service.state.ListInstallTransactions(context.Background())
			if err != nil || len(records) != 1 {
				t.Fatalf("retained rows = %+v, %v", records, err)
			}
		})
	}
}
