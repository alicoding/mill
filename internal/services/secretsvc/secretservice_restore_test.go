package secretsvc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/backup"
	"github.com/alicoding/mill/internal/adapters/credential"
)

// RestoreVaultFromLatestBackup is the key-mismatch state's own door out
// (goal 0359): archives whatever is currently at the vault's path
// (unreadable or not -- that's the whole point) and brings the newest
// backup's own vault copy in behind it, consuming that one backup's
// copy so a repeated attempt moves on to the next-older one.
func TestRestoreVaultFromLatestBackup_ArchivesCurrentFileAndBringsBackupIn(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "secrets.kdbx")
	creds := credential.NewInMemory()
	s := newVaultAt(t, path, creds)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	goodBytes, err := os.ReadFile(path) //nolint:gosec // t.TempDir()-scoped test fixture path
	if err != nil {
		t.Fatalf("read the just-created vault: %v", err)
	}
	s.LockVault()

	backupDir := filepath.Join(dir, "backups")
	backupSub := filepath.Join(backupDir, time.Now().Format(backup.TimestampLayout))
	if err := os.MkdirAll(backupSub, 0o750); err != nil {
		t.Fatalf("mkdir backup subdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(backupSub, "secrets.kdbx"), goodBytes, 0o600); err != nil { //nolint:gosec // t.TempDir()-scoped test fixture path
		t.Fatalf("seed backup vault copy: %v", err)
	}
	s.SetBackupDir(backupDir)

	// Stand in for the real defect: the file at path is still there but
	// broken/unrelated -- Backup() only requires it to EXIST, never that
	// it's readable.
	if err := os.WriteFile(path, []byte("corrupted-vault-bytes"), 0o600); err != nil {
		t.Fatalf("corrupt the live vault file: %v", err)
	}

	if err := s.RestoreVaultFromLatestBackup(); err != nil {
		t.Fatalf("RestoreVaultFromLatestBackup: %v", err)
	}

	got, err := os.ReadFile(path) //nolint:gosec // t.TempDir()-scoped test fixture path
	if err != nil {
		t.Fatalf("read restored vault: %v", err)
	}
	if string(got) != string(goodBytes) {
		t.Error("the live vault file after restore != the backup's own content")
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	var archived bool
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "secrets.") && strings.HasSuffix(e.Name(), ".bak.kdbx") {
			archived = true
			content, err := os.ReadFile(filepath.Join(dir, e.Name())) //nolint:gosec // t.TempDir()-scoped test fixture path
			if err != nil {
				t.Fatalf("read archived file: %v", err)
			}
			if string(content) != "corrupted-vault-bytes" {
				t.Error("the archived file doesn't carry the pre-restore (broken) content")
			}
		}
	}
	if !archived {
		t.Error("no .bak.kdbx archive of the pre-restore file was created")
	}

	if _, err := os.Stat(filepath.Join(backupSub, "secrets.kdbx")); !os.IsNotExist(err) {
		t.Errorf("the used backup's own vault copy should be consumed, stat err = %v", err)
	}
}

func TestRestoreVaultFromLatestBackup_NoVaultInBackupIsAnError(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "secrets.kdbx")
	s := newVaultAt(t, path, credential.NewInMemory())
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	s.LockVault()

	backupDir := filepath.Join(dir, "backups")
	// An existing backup subdirectory with no vault copy in it -- the
	// same shape a pre-goal-0359 backup, or one taken before a vault
	// ever existed, leaves behind.
	backupSub := filepath.Join(backupDir, time.Now().Format(backup.TimestampLayout))
	if err := os.MkdirAll(backupSub, 0o750); err != nil {
		t.Fatalf("mkdir backup subdir: %v", err)
	}
	s.SetBackupDir(backupDir)

	if err := s.RestoreVaultFromLatestBackup(); err == nil {
		t.Fatal("RestoreVaultFromLatestBackup with no vault in any backup = nil error, want one")
	}
}

func TestRestoreVaultFromLatestBackup_NoBackupDirConfiguredIsAnError(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "secrets.kdbx")
	s := newVaultAt(t, path, credential.NewInMemory())
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	s.LockVault()
	// SetBackupDir deliberately never called.

	if err := s.RestoreVaultFromLatestBackup(); err == nil {
		t.Fatal("RestoreVaultFromLatestBackup with no backup directory configured = nil error, want one")
	}
}
