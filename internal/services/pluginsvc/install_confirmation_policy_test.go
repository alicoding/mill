package pluginsvc

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestConfirmInstallRechecksCurrentPolicyBeforePlacement(t *testing.T) {
	source := t.TempDir()
	writePlugin(t, source, "policy-swap", `{"id":"policy-swap","name":"New","version":"2.0.0"}`, nil)
	source = filepath.Join(source, "policy-swap")
	policyPath := filepath.Join(t.TempDir(), "plugin-policy.json")
	t.Setenv(PolicyPathEnv, policyPath)
	writeCurrentPolicy := func(body string) {
		t.Helper()
		if err := os.WriteFile(policyPath, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	writeCurrentPolicy(fmt.Sprintf(`{"version":2,"managedBy":"Org","sources":[{"kind":"path","locator":%q}]}`, source))

	service, installedRoot := newStoreService(t)
	installed := filepath.Join(installedRoot, "policy-swap")
	writePlugin(t, installedRoot, "policy-swap", `{"id":"policy-swap","name":"Old","version":"1.0.0"}`, nil)
	before, err := os.ReadFile(filepath.Join(installed, "manifest.json")) // #nosec G304 -- test-owned path
	if err != nil {
		t.Fatal(err)
	}
	reservation, err := service.ReserveInstallPreparation()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.PrepareInstall(reservation.Handle, InstallCandidate{Kind: "link", Locator: source}); err != nil {
		t.Fatal(err)
	}
	writeCurrentPolicy(`{"version":2,"managedBy":"Org","sources":[]}`)
	if _, err := service.ConfirmInstall(reservation.Handle); err == nil {
		t.Fatal("installation succeeded under changed policy")
	}
	after, err := os.ReadFile(filepath.Join(installed, "manifest.json")) // #nosec G304 -- test-owned path
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(before) {
		t.Fatal("placement-time refusal changed the installed package")
	}
}
