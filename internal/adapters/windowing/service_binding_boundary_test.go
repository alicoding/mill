package windowing_test

import (
	"os"
	"os/exec"
	"testing"

	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/secretsvc"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestProviderAvailabilityServiceBindingBoundary(t *testing.T) {
	const helperEnv = "MILL_WAILS_BINDING_BOUNDARY_HELPER"
	if os.Getenv(helperEnv) != "1" {
		cmd := exec.CommandContext(t.Context(), os.Args[0], "-test.run=^TestProviderAvailabilityServiceBindingBoundary$") //nolint:gosec // os.Args[0] is this test binary, not user input.
		cmd.Env = append(os.Environ(), helperEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("isolated binding check failed: %v\n%s", err, output)
		}
		return
	}

	// application.New installs process-global state. Run the upstream binding
	// setup in this helper process so it cannot change windowing's no-app tests.
	_ = application.New(application.Options{})
	bindings := application.NewBindings(nil, nil)
	if err := bindings.Add(application.NewService(&configuresvc.ConfigureService{})); err != nil {
		t.Fatalf("add ConfigureService bindings: %v", err)
	}
	if err := bindings.Add(application.NewService(&secretsvc.SecretService{})); err != nil {
		t.Fatalf("add SecretService bindings: %v", err)
	}

	const configurePrefix = "github.com/alicoding/mill/internal/services/configuresvc.ConfigureService."
	for _, name := range []string{
		"StartAIProviderCheck",
		"GetAIProviderAvailability",
		"ListAIProviderAvailability",
		"CancelAIProviderCheck",
	} {
		method := configurePrefix + name
		if got := bindings.Get(&application.CallOptions{MethodName: method}); got == nil {
			t.Errorf("intended ConfigureService binding %q is absent", method)
		}
	}

	for _, name := range []string{
		"SetAIProviderCheckAuthorizer",
		"StartAIProviderCheckWithActor",
		"InvalidateAIProviderAvailability",
		"InvalidateAIProviderAvailabilityForSecrets",
		"StopAIProviderChecks",
	} {
		method := configurePrefix + name
		if got := bindings.Get(&application.CallOptions{MethodName: method}); got != nil {
			t.Errorf("internal ConfigureService function %q is exposed as a binding", method)
		}
	}

	const sourceHookMethod = "github.com/alicoding/mill/internal/services/secretsvc.SecretService.SetSourceChangeHook"
	if got := bindings.Get(&application.CallOptions{MethodName: sourceHookMethod}); got != nil {
		t.Errorf("internal SecretService function %q is exposed as a binding", sourceHookMethod)
	}
}
