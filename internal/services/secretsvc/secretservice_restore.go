package secretsvc

import (
	"fmt"

	"github.com/alicoding/mill/internal/adapters/backup"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// SetBackupDir wires the local backup rotation's own root directory
// (main.go's MILL_BACKUP_DIR-resolved path) -- called once from
// wiring.WireSecrets, after that path is resolved. Exported for wiring
// only, never a frontend RPC.
//
//wails:ignore
func (s *SecretService) SetBackupDir(dir string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.backupDir = dir
}

// RestoreVaultFromLatestBackup is the key-mismatch state's own door out
// (goal 0359) when the current vault file is unreadable but a local
// backup still carries one: archives the current file exactly as
// ResetVault does (its own timestamped .bak.kdbx sibling, nothing
// deleted), copies the newest backup's vault copy into the now-empty
// target, and consumes that one backup's own copy so a repeated attempt
// (this one didn't help either) moves on to the next-older backup
// rather than restoring the identical file again. Never unlocks on its
// own -- the restored file's identity picks its own key slot, and
// whether THAT key is still in the keychain is exactly what the next
// Unlock click answers.
func (s *SecretService) RestoreVaultFromLatestBackup() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.vault.Exists() {
		return fmt.Errorf("no vault file to restore over")
	}
	if s.backupDir == "" {
		return fmt.Errorf("no backup directory configured")
	}

	backupDir, _, err := backup.LatestVaultBackupDir(s.backupDir)
	if err != nil {
		return fmt.Errorf("finding a backup with a vault: %w", err)
	}
	if backupDir == "" {
		return fmt.Errorf("no backup carries a vault")
	}

	if _, err := s.vault.Backup(); err != nil {
		return fmt.Errorf("archiving the current vault file: %w", err)
	}

	restored, err := backup.RestoreVault(backupDir, s.vault.Path())
	if err != nil {
		return fmt.Errorf("restoring the vault from backup: %w", err)
	}
	if !restored {
		return fmt.Errorf("restore vault: target still occupied after archiving it")
	}

	if err := backup.ConsumeVaultBackup(backupDir); err != nil {
		return fmt.Errorf("consuming the used backup: %w", err)
	}

	dataevent.Emit("secret", "")
	return nil
}
