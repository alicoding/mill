package configuresvc

import (
	"log/slog"
	"os"
	"path/filepath"

	"github.com/alicoding/mill/internal/domain/secretsource"
	"github.com/alicoding/mill/internal/services/entitystore"
	"github.com/alicoding/mill/internal/services/seeding"
)

// Seeded secret sources (goal 0367): secretsource.BuiltIn()'s dotenv
// golden names its file by marker only -- the pure domain package knows
// nothing of where user data lives, so this layer writes the fixture
// under the app's data dir and hands reconcile the resolved source.
// Atlas's own seed-asset machinery (atlasservice_builtinobjects.go) is
// the template, down to the deferral: until SetSeedAssetsDir wires a
// directory in, the golden is omitted from the BuiltIn set entirely,
// never inserted pointing at a file that does not exist.

// SetSeedAssetsDir wires the directory seed assets materialize into
// (the data dir the vault itself lives in), then re-runs reconcile so
// a construction-time pass that preceded this wiring catches up.
// Exported for wiring only, never a frontend RPC.
//
//wails:ignore
func (c *ConfigureService) SetSeedAssetsDir(dir string) {
	c.mu.Lock()
	c.seedAssetsDir = dir
	c.mu.Unlock()
	c.reconcileBuiltInSecretSources()
}

// builtInSecretSources resolves secretsource.BuiltIn()'s goldens into
// insertable sources: the dotenv example's fixture is written under
// the seed assets dir and its marker Path replaced with the real one.
// Without a wired dir the golden is omitted -- same posture as
// builtInBoardObjectsLocked, never a half-built seed.
func (c *ConfigureService) builtInSecretSources() []secretsource.Source {
	goldens := secretsource.BuiltIn()
	out := make([]secretsource.Source, 0, len(goldens))
	// Only called as entitystore.Reconcile's BuiltIn(), which holds
	// c.mu for the duration -- never lock again here.
	dir := c.seedAssetsDir
	for _, golden := range goldens {
		if golden.Path != secretsource.DotenvSeedPathMarker {
			out = append(out, golden)
			continue
		}
		if dir == "" {
			continue
		}
		path, err := materializeExampleDotenv(dir)
		if err != nil {
			slog.Error("failed to materialize the example dotenv file", "error", err)
			continue
		}
		golden.Path = path
		out = append(out, golden)
	}
	return out
}

// materializeExampleDotenv writes the example source's own dotenv file
// under dir. A file already present is left untouched: the example's
// content is what the reader may edit, never Mill's to rewrite on top
// of (the same posture materializeSeedBoardObjectAsset gives its own
// fixtures).
func materializeExampleDotenv(dir string) (string, error) {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", err
	}
	path := filepath.Join(dir, "example-dotenv.env")
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}
	if err := os.WriteFile(path, []byte(secretsource.ExampleDotenvFileContent), 0o600); err != nil {
		return "", err
	}
	return path, nil
}

// reconcileBuiltInSecretSources mirrors reconciledBuiltInDecisions for
// the seeded example source (goal 0367) via secretSourceDescriptor,
// substituting the materializing BuiltIn set above.
func (c *ConfigureService) reconcileBuiltInSecretSources() {
	tombstones := seeding.LoadTombstones(c.store)
	descriptor := secretSourceDescriptor
	descriptor.BuiltIn = c.builtInSecretSources
	if _, changed := entitystore.Reconcile(&c.mu, &c.secretSources, tombstones, descriptor); changed {
		if err := c.persistSecretSources(); err != nil {
			slog.Error("failed to reconcile built-in secret sources", "error", err)
		}
	}
}
