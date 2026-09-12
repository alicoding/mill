//go:build server

package backupsvc

import (
	"errors"
	"testing"

	"github.com/alicoding/mill/internal/adapters/osopen"
)

func TestBackupServiceRevealBackupFolderReportsUnsupportedInServerMode(t *testing.T) {
	svc := New("", "", "", t.TempDir(), "test")
	if err := svc.RevealBackupFolder(); !errors.Is(err, osopen.ErrUnsupportedInServerMode) {
		t.Fatalf("RevealBackupFolder error = %v", err)
	}
}
