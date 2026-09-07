package pluginsvc

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/alicoding/mill/internal/domain/usererror"
)

// The policy and the install checks at the install door (docs/goals/
// 0349 S6): a refused plugin leaves no folder, the scan stamps every
// folder with the verdict, and a broken policy closes the door.

func TestInstallFromMarketplace_PolicyRefusalLeavesNoFolder(t *testing.T) {
	writePolicy(t, `{"version": 1, "managedBy": "Example Bank", "block": [{"id": "mill-alpha"}]}`)
	svc, dir := newStoreService(t, "mill-alpha")
	_, err := svc.InstallFromMarketplace(ReservedMarketplaceName, "mill-alpha")
	if err == nil {
		t.Fatal("install of a blocked id succeeded")
	}
	var ue *usererror.Error
	if !errors.As(err, &ue) || ue.Code != PolicyRefusedCode || ue.Message != "Your organisation blocks this extension." {
		t.Fatalf("err = %v, want the policy refusal", err)
	}
	if _, statErr := os.Stat(filepath.Join(dir, "mill-alpha")); !os.IsNotExist(statErr) {
		t.Fatalf("a refused install left a folder: %v", statErr)
	}
}

func TestPreviewInstall_CarriesThePolicyRefusal(t *testing.T) {
	writePolicy(t, `{"version": 1, "managedBy": "Example Bank", "blockedCapabilities": ["fetch"]}`)
	svc, _ := newStoreService(t, "mill-alpha")
	pv, err := svc.PreviewInstall(ReservedMarketplaceName, "mill-alpha")
	if err != nil {
		t.Fatal(err)
	}
	if pv.PolicyRefusal != "Your organisation blocks extensions that can reach the network." {
		t.Fatalf("PolicyRefusal = %q", pv.PolicyRefusal)
	}
}

func TestInstallFromMarketplace_StaticRefusalLeavesNoFolder(t *testing.T) {
	fsys := exampleFS("mill-alpha")
	fsys[exampleMarketplaceRoot+"/mill-alpha/main.js"] = &fstest.MapFile{Data: []byte("export function activate() { eval('1') }")}
	dir := t.TempDir()
	svc := New(dir, nil, "")
	svc.SetExampleMarketplace(fsys)
	_, err := svc.InstallFromMarketplace(ReservedMarketplaceName, "mill-alpha")
	var ue *usererror.Error
	if !errors.As(err, &ue) || ue.Code != InstallRefusedCode || !strings.Contains(ue.Message, "eval") {
		t.Fatalf("err = %v, want the static-check refusal", err)
	}
	if _, statErr := os.Stat(filepath.Join(dir, "mill-alpha")); !os.IsNotExist(statErr) {
		t.Fatalf("a refused install left a folder: %v", statErr)
	}
}

func TestInstallFromMarketplace_RecordsTheWarnings(t *testing.T) {
	fsys := exampleFS("mill-alpha")
	fsys[exampleMarketplaceRoot+"/mill-alpha/main.js"] = &fstest.MapFile{Data: []byte("export function activate() {}\n" + strings.Repeat("function a(){return 1}\n", minifiedScriptBytes/20))}
	dir := t.TempDir()
	svc := New(dir, nil, "")
	svc.SetExampleMarketplace(fsys)
	rec, err := svc.InstallFromMarketplace(ReservedMarketplaceName, "mill-alpha")
	if err != nil {
		t.Fatal(err)
	}
	if len(rec.Warnings) != 1 || !strings.Contains(rec.Warnings[0], unreadableCodeSentence) {
		t.Fatalf("warnings = %v", rec.Warnings)
	}
	pv, err := svc.PreviewInstalled("mill-alpha")
	if err != nil {
		t.Fatal(err)
	}
	if len(pv.Warnings) != 1 {
		t.Fatalf("PreviewInstalled warnings = %v", pv.Warnings)
	}
	if _, statErr := os.Stat(filepath.Join(dir, "mill-alpha")); statErr != nil {
		t.Fatalf("a warned install did not land: %v", statErr)
	}
}

func TestListPlugins_StampsThePolicyVerdict(t *testing.T) {
	svc, _ := newStoreService(t, "mill-alpha", "mill-beta")
	for _, id := range []string{"mill-alpha", "mill-beta"} {
		if _, err := svc.InstallFromMarketplace(ReservedMarketplaceName, id); err != nil {
			t.Fatal(err)
		}
	}
	writePolicy(t, `{"version": 1, "managedBy": "Example Bank", "allow": [{"id": "mill-alpha"}]}`)
	infos, err := svc.ListPlugins()
	if err != nil {
		t.Fatal(err)
	}
	verdicts := map[string]string{}
	for _, info := range infos {
		verdicts[info.Manifest.ID] = info.PolicyBlocked
	}
	if verdicts["mill-alpha"] != "" {
		t.Errorf("mill-alpha refused: %q", verdicts["mill-alpha"])
	}
	if verdicts["mill-beta"] != "Your organisation allows only the extensions on its list." {
		t.Errorf("mill-beta = %q", verdicts["mill-beta"])
	}
	if !svc.PolicyAllows("mill-alpha") || svc.PolicyAllows("mill-beta") {
		t.Error("PolicyAllows disagrees with the scan")
	}
}

func TestListPlugins_MalformedPolicyBlocksEveryNonBuiltIn(t *testing.T) {
	svc, _ := newStoreService(t, "mill-alpha")
	if _, err := svc.InstallFromMarketplace(ReservedMarketplaceName, "mill-alpha"); err != nil {
		t.Fatal(err)
	}
	writePolicy(t, `not json at all`)
	infos, err := svc.ListPlugins()
	if err != nil {
		t.Fatal(err)
	}
	for _, info := range infos {
		if info.Builtin && info.PolicyBlocked != "" {
			t.Errorf("built-in %s refused by a broken policy", info.Manifest.ID)
		}
		if !info.Builtin && info.PolicyBlocked != ErrPolicyUnreadable.Message {
			t.Errorf("%s = %q, want the fail-closed sentence", info.Manifest.ID, info.PolicyBlocked)
		}
	}
	view, _ := svc.PluginPolicy()
	if !view.Managed || view.Error != ErrPolicyUnreadable.Message {
		t.Fatalf("PluginPolicy() = %+v", view)
	}
}

func TestPluginPolicy_SummarisesTheFile(t *testing.T) {
	writePolicy(t, `{"version": 1, "managedBy": "Example Bank", "requiredTier": "verified", "blockedCapabilities": ["fetch"], "allowedSources": ["bank-market"], "block": [{"id": "x"}]}`)
	svc, _ := newStoreService(t)
	view, _ := svc.PluginPolicy()
	if !view.Managed || view.ManagedBy != "Example Bank" || view.RequiredTier != TierVerified || view.BlockCount != 1 {
		t.Fatalf("view = %+v", view)
	}
	if len(view.BlockedCapabilities) != 1 || len(view.AllowedSources) != 1 {
		t.Fatalf("view lists = %+v", view)
	}
}

func TestAddMarketplaceSource_RefusedByAllowedSources(t *testing.T) {
	writePolicy(t, `{"version": 1, "managedBy": "Example Bank", "allowedSources": ["bank-market"]}`)
	svc, _ := newStoreService(t)
	_, err := svc.AddMarketplaceSource("someone/marketplace")
	var ue *usererror.Error
	if !errors.As(err, &ue) || ue.Code != PolicyRefusedCode {
		t.Fatalf("err = %v, want the source refusal", err)
	}
	_, err = svc.InstallFromLink("someone/plugin")
	if !errors.As(err, &ue) || ue.Code != PolicyRefusedCode {
		t.Fatalf("link install err = %v, want the source refusal", err)
	}
}
