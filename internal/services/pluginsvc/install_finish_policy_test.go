package pluginsvc

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFinishInstallRechecksCurrentPolicyBeforePlacement(t *testing.T) {
	const allowed = `{"version":2,"managedBy":"Org","sources":[{"kind":"github","locator":"acme/catalog"}]}`
	for _, tc := range []struct {
		name        string
		finalPolicy string
		wantRefusal bool
		existing    bool
	}{
		{name: "stable allowed", finalPolicy: allowed, existing: true},
		{name: "changed to deny", finalPolicy: `{"version":2,"managedBy":"Org","sources":[{"kind":"github","locator":"other/catalog"}]}`, wantRefusal: true, existing: true},
		{name: "changed to malformed", finalPolicy: `{`, wantRefusal: true, existing: true},
		{name: "fresh install changed to deny", finalPolicy: `{"version":2,"managedBy":"Org","sources":[]}`, wantRefusal: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			policyPath := filepath.Join(t.TempDir(), "plugin-policy.json")
			t.Setenv(PolicyPathEnv, policyPath)
			writeCurrentPolicy := func(body string) error {
				return os.WriteFile(policyPath, []byte(body), 0o600)
			}
			if err := writeCurrentPolicy(allowed); err != nil {
				t.Fatal(err)
			}

			svc, installedRoot := newStoreService(t)
			const id = "policy-swap"
			installed := filepath.Join(installedRoot, id)
			var (
				oldManifest []byte
				oldReceipt  []byte
				err         error
			)
			if tc.existing {
				writePlugin(t, installedRoot, id, `{"id":"policy-swap","name":"Old","version":"1.0.0"}`, nil)
				if err := WriteInstallRecord(installed, InstallRecord{Tier: TierUnverified, Origin: SourceOrigin{Kind: "github", Locator: "old/catalog"}}); err != nil {
					t.Fatal(err)
				}
				oldManifest, err = os.ReadFile(filepath.Join(installed, "manifest.json")) // #nosec G304 -- test-owned path
				if err != nil {
					t.Fatal(err)
				}
				oldReceipt, err = os.ReadFile(filepath.Join(installed, InstallRecordFile)) // #nosec G304 -- test-owned path
				if err != nil {
					t.Fatal(err)
				}
			}

			stageParent := t.TempDir()
			writePlugin(t, stageParent, id, `{"id":"policy-swap","name":"New","version":"2.0.0"}`, nil)
			stage := filepath.Join(stageParent, id)
			rechecks := 0
			_, err = svc.finishInstallModeWith(stage, InstallRecord{
				Tier:        TierUnverified,
				Marketplace: "catalog",
				Origin:      SourceOrigin{Kind: "github", Locator: "acme/catalog"},
			}, true, nil, installFinalizationDeps{beforePolicyRecheck: func() error {
				rechecks++
				return writeCurrentPolicy(tc.finalPolicy)
			}})
			if rechecks != 1 {
				t.Fatalf("placement policy callbacks = %d, want 1", rechecks)
			}
			if tc.wantRefusal {
				if err == nil {
					t.Fatal("installation succeeded under changed policy")
				}
				if !tc.existing {
					if _, statErr := os.Stat(installed); !os.IsNotExist(statErr) {
						t.Fatalf("placement-time refusal left a fresh installation: %v", statErr)
					}
					return
				}
				gotManifest, readErr := os.ReadFile(filepath.Join(installed, "manifest.json")) // #nosec G304 -- test-owned path
				if readErr != nil {
					t.Fatal(readErr)
				}
				gotReceipt, readErr := os.ReadFile(filepath.Join(installed, InstallRecordFile)) // #nosec G304 -- test-owned path
				if readErr != nil {
					t.Fatal(readErr)
				}
				if string(gotManifest) != string(oldManifest) || string(gotReceipt) != string(oldReceipt) {
					t.Fatal("placement-time refusal changed the installed package or receipt")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			gotManifest, readErr := os.ReadFile(filepath.Join(installed, "manifest.json")) // #nosec G304 -- test-owned path
			if readErr != nil {
				t.Fatal(readErr)
			}
			if string(gotManifest) == string(oldManifest) {
				t.Fatal("stable allowed policy did not place the staged package")
			}
		})
	}
}
