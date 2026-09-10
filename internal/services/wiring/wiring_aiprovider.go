package wiring

import (
	"context"

	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
)

// WireAIProviderCheckAuthorizer routes provider inspection through the shared guardrail door.
func WireAIProviderCheckAuthorizer(configureService *configuresvc.ConfigureService, guardrailService *guardrailsvc.GuardrailService) {
	configuresvc.SetAIProviderCheckAuthorizer(configureService, func(ctx context.Context, request configuresvc.ProviderCheckPermissionRequest) (aiprovider.PermissionResult, error) {
		decision, err := guardrailService.RequestGuardedAction(ctx, guardrailsvc.GuardedAction{
			Kind:        "provider-inspect",
			Attributes:  map[string]string{"provider_id": request.ProviderID, "check_id": request.CheckID, "endpoint": request.Endpoint},
			Description: "Check this AI provider's metadata endpoint.",
			Source:      request.Actor,
		})
		result := aiprovider.PermissionResult{Status: aiprovider.PermissionDenied, Source: string(decision.Effect), RuleID: decision.RuleID, RuleLabel: decision.RuleLabel}
		if decision.Approved {
			result.Status = aiprovider.PermissionAllowed
		}
		return result, err
	})
}
