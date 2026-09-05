package pluginsvc

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Install trust tiers (docs/goals/0349, ADR-0047): what actually
// checked this folder's bytes, recorded at install time and shown on
// every row and detail afterwards. The tier is a fact about the
// download, not a permission -- the allow-list, the content lock and
// the signing policy all still apply exactly as before.
//
// Four tiers, narrowest first: a signed release whose hash the index
// declared, a release whose hash the index declared, anything with
// neither, and a folder the user pointed at on this Mac.

const (
	TierVerified   = "verified"
	TierHashPinned = "hash-pinned"
	TierUnverified = "unverified"
	TierDev        = "dev"
)

// InstallRecordFile is the receipt an install writes inside the plugin
// folder. Hidden, so the content hash's own walk skips it and
// reinstalling the same version never changes the hash.
const InstallRecordFile = ".mill-install.json"

// InstallRecord is that receipt: where the folder came from, what it
// hashed to when it landed, and which tier that earned.
type InstallRecord struct {
	Source      PluginSource `json:"source"`
	Marketplace string       `json:"marketplace"`
	Version     string       `json:"version"`
	ContentHash string       `json:"contentHash"`
	Tier        string       `json:"tier"`
	InstalledAt string       `json:"installedAt"`
}

// TierInputs are the facts a tier is computed from.
type TierInputs struct {
	// FromFolder is true when the user pointed Mill at a folder on this
	// Mac rather than at a download.
	FromFolder bool
	// DeclaredSHA256 is the hash the source declared, "" when it
	// declared none (a branch archive always does).
	DeclaredSHA256 string
	// ActualSHA256 is the archive's own hash.
	ActualSHA256 string
	// Signed reports a minisign signature that verified against a
	// pinned key.
	Signed bool
}

// TierFor computes the install tier. A declared hash that does NOT
// match never reaches here -- the install refuses first -- so the
// mismatch case below is the defensive one.
func TierFor(in TierInputs) string {
	if in.FromFolder {
		return TierDev
	}
	declared := strings.TrimSpace(in.DeclaredSHA256)
	if declared == "" || !strings.EqualFold(declared, strings.TrimSpace(in.ActualSHA256)) {
		return TierUnverified
	}
	if in.Signed {
		return TierVerified
	}
	return TierHashPinned
}

// WriteInstallRecord stores the receipt in the installed folder.
func WriteInstallRecord(dir string, rec InstallRecord) error {
	if rec.InstalledAt == "" {
		rec.InstalledAt = time.Now().UTC().Format(time.RFC3339)
	}
	raw, err := json.MarshalIndent(rec, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, InstallRecordFile), raw, 0o600)
}

// ReadInstallRecord reads the receipt back, reporting false when the
// folder carries none (every plugin installed by hand before this, and
// every built-in).
func ReadInstallRecord(dir string) (InstallRecord, bool) {
	if dir == "" {
		return InstallRecord{}, false
	}
	raw, err := os.ReadFile(filepath.Join(dir, InstallRecordFile)) // #nosec G304 G703 -- the plugin's own folder, resolved by the scan
	if err != nil {
		return InstallRecord{}, false
	}
	var rec InstallRecord
	if err := json.Unmarshal(raw, &rec); err != nil {
		return InstallRecord{}, false
	}
	if rec.Tier == "" {
		return InstallRecord{}, false
	}
	return rec, true
}

// InstalledTier answers the tier an installed plugin wears: its
// recorded one, or "dev" for a folder that was placed by hand (nothing
// checked it, which is exactly what dev means).
func InstalledTier(dir string, builtin bool) string {
	if builtin {
		return ""
	}
	if rec, ok := ReadInstallRecord(dir); ok {
		return rec.Tier
	}
	return TierDev
}
