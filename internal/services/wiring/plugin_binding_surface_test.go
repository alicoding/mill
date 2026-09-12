package wiring

import (
	"testing"

	"github.com/alicoding/mill/internal/services/pluginsvc"
	"github.com/alicoding/mill/internal/services/settingssvc"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestPluginInstallRuntimeBindingSurface(t *testing.T) {
	application.New(application.Options{})
	bindings := application.NewBindings(nil, nil)
	if err := bindings.Add(application.NewService(new(pluginsvc.PluginService))); err != nil {
		t.Fatalf("bind PluginService: %v", err)
	}
	if err := bindings.Add(application.NewService(new(settingssvc.SettingsService))); err != nil {
		t.Fatalf("bind SettingsService: %v", err)
	}

	pluginFQN := "github.com/alicoding/mill/internal/services/pluginsvc.PluginService."
	settingsFQN := "github.com/alicoding/mill/internal/services/settingssvc.SettingsService."
	for _, method := range []string{
		"ReserveInstallPreparation",
		"PrepareInstall",
		"ConfirmInstall",
		"CancelInstallPreparation",
		"RecoverInstallations",
	} {
		assertBindingPresent(t, bindings, pluginFQN+method)
	}
	for _, method := range []string{"GetAllowedPlugins", "GetPluginLock"} {
		assertBindingPresent(t, bindings, settingsFQN+method)
	}

	for _, method := range []string{
		"InstallFromMarketplace",
		"InstallFromLink",
		"UpdatePlugin",
		"ImportTheme",
		"ClosePreparations",
		"LoadApprovalState",
		"UpdateApprovalState",
		"WithPluginMutation",
		"WidenedAgainst",
		"PackageApprovalMatches",
		"CaptureGrantLocked",
	} {
		assertBindingAbsent(t, bindings, pluginFQN+method)
	}
	for _, method := range []string{"SetPluginApprovalStore", "ReadPluginApprovalSnapshot", "WirePluginRemoval"} {
		assertBindingAbsent(t, bindings, settingsFQN+method)
	}
}

func assertBindingPresent(t *testing.T, bindings *application.Bindings, name string) {
	t.Helper()
	if got := bindings.Get(&application.CallOptions{MethodName: name}); got == nil {
		t.Errorf("runtime binding %q is absent", name)
	}
}

func assertBindingAbsent(t *testing.T, bindings *application.Bindings, name string) {
	t.Helper()
	if got := bindings.Get(&application.CallOptions{MethodName: name}); got != nil {
		t.Errorf("runtime binding %q is present", name)
	}
}
