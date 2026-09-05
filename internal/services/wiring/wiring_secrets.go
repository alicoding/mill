// Secret-vault wiring, split out of wiring.go along the same seam every
// other Wire* function follows (CLAUDE.md's 500-line convention): the
// vault, the redaction sink it feeds, and the coding loop's resolution
// chain over it.

package wiring

import (
	"log/slog"
	"os"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/adapters/secretvault"
	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/secretsource"
	"github.com/alicoding/mill/internal/services/codeloopsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/secretsvc"
)

// WireSecrets constructs the vault (goal 0185) at vaultPath, sharing
// credentials with configuresvc's own HTTPRequest/AIProvider secrets --
// same OS keychain, its own well-known id. Pulled out of main.go for the
// same 500-line reason WireRemoteAuth above is; vaultPath/backupDir's
// own MILL_SECRETS_PATH/MILL_BACKUP_DIR-override-or-default resolution
// stays in main.go (depguard: this package doesn't import
// wails/v3/pkg/application). backupDir feeds SecretService.SetBackupDir
// (goal 0359's own restore-from-backup door on the key-mismatch state).
// WireSecrets also wires configureService's own two vault-reference
// seams onto the newly-constructed SecretService: SetSecretResolver
// (goal 0185 S3, "vault:" env/header values) and, goal 0203 S2,
// SetSecretLabelsLister (DeriveSecretLabels' title lookup) plus the
// derivation's own path into the guardrail gate
// (guardrailsvc.SetSecretLabelsLookup, Attributes["secrets"]) --
// folded in here rather than as separate main.go call-site lines, same
// 500-line reason every other Wire* function here already gives.
// Order-independent of GuardrailService's own construction:
// SetSecretLabelsLookup only sets a package-level var, read lazily by
// GuardrailStep at evaluation time, never at wiring time.
func WireSecrets(vaultPath, backupDir string, credentials credential.Store, store settings.Store, configureService *configuresvc.ConfigureService) *secretsvc.SecretService {
	secretService := secretsvc.NewSecretService(secretvault.New(vaultPath), credentials, store)
	// goal 0359: the key-mismatch state's own restore-from-backup door
	// needs to know where local backups live.
	secretService.SetBackupDir(backupDir)
	// One-time move off the inert ACL-gated keychain item onto the
	// setting-backed unlock gate (goal 0330). No-op on every launch after
	// the first, and on every install that never enabled the old one.
	secretService.MigrateLegacyPresenceProtection()
	configureService.SetSecretResolver(secretService.ResolveSecretValue)
	secretService.SetSourcesLister(configureService.SecretSources)
	// Goal 0306 S4: "Add as sources" on the .env scan creates the same
	// Configure entity the Sources page's own form does, through this
	// one seam -- secretsvc never depends on configuresvc.
	secretService.SetSourceCreator(func(label, kind, path string) error {
		_, err := configureService.CreateSecretSource(label, secretsource.Kind(kind), path)
		return err
	})
	configureService.SetSecretLabelsLister(secretService.ListSecrets)
	guardrailsvc.SetSecretLabelsLookup(configureService.DeriveSecretLabels)
	// Goal 0306: a credential can only be created in the store, and the
	// store only exists open. Every unlock therefore adopts whatever is
	// still unadopted -- a value left in a per-entity keychain item by
	// an older Mill, or a seeded example's demo credential -- and does
	// nothing once there is nothing left to adopt.
	configureService.SetSecretCreator(secretService.CreateStoredSecret)
	secretService.OnUnlock(func() {
		adopted, err := configureService.AdoptSecretsIntoStore()
		if err != nil {
			slog.Warn("moving saved credentials into the secret store", "error", err)
		}
		if adopted > 0 {
			slog.Info("moved saved credentials into the secret store", "entries", adopted)
		}
	})
	return secretService
}

// WireSecretRedaction wires composition's mcp-tool-call node error path
// to secretService's own known-secret scrubber (goal 0185 S4) -- a
// server launched with an injected vault secret could echo it back in
// its own failure text.
func WireSecretRedaction(secretService *secretsvc.SecretService) {
	composition.SetSecretRedactor(secretService.RedactKnownSecrets)
}

// WireCodingLoopSecrets connects the coding loop's secret resolution
// CHAIN (goal 0240 S2, closing goal 0203 S4's held design) to its two
// composition seams: SetVaultSecretLookup (preview-time, a cheap label
// match, never a decrypt/audit) and SetShellSecretResolver (run-time,
// the real three-source chain -- codeLoopService's own typed-secrets
// stash, then a vault decrypt through secretService.ResolveSecretValue
// (leaving the existing goal-0203 audit line via
// secretaudit.ContextCodingLoopShell, never a second audit store), then
// the process's own shell environment). "Fail to resolve" is banned by
// the goal's own decision -- every branch below either returns a value
// or falls through to the next source, ending in found=false, never an
// error.
func WireCodingLoopSecrets(codeLoopService *codeloopsvc.CodeLoopService, secretService *secretsvc.SecretService) {
	composition.SetVaultSecretLookup(func(varName string) (string, bool) {
		_, label, found := secretService.LookupVaultSecretByEnvName(varName)
		return label, found
	})
	composition.SetShellSecretResolver(func(varName, secretsToken string, run composition.SecretAccessRun) (string, composition.SecretSource, bool) {
		if secretsToken != "" {
			if v, ok := codeLoopService.TakeTypedSecret(secretsToken, varName); ok {
				return v, composition.SecretSourcePrompt, true
			}
		}
		if id, _, found := secretService.LookupVaultSecretByEnvName(varName); found {
			actx := secretaudit.AccessContext{Context: secretaudit.ContextCodingLoopShell, RunID: run.RunID, WorkflowID: run.WorkflowID}
			if v, err := secretService.ResolveSecretValue(id, actx); err == nil {
				return v, composition.SecretSourceVault, true
			}
			// A vault resolution error (a lock raced with this run, a
			// deleted entry) falls through rather than failing the run --
			// the goal's own "never fail to resolve" mandate.
		}
		if v := os.Getenv(varName); v != "" {
			return v, composition.SecretSourceEnv, true
		}
		return "", "", false
	})
}
