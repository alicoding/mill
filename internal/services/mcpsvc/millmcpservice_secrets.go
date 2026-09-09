package mcpsvc

import (
	"context"
	"fmt"

	"github.com/alicoding/mill/internal/services/secretsvc"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Secrets over MCP (goal 0408 S3 decision 7): one read-only tool
// naming every secret REFERENCE this Mill instance knows -- a vault
// entry's own reference, and every enabled source's own keys -- so an
// agent can point a field at "vault:<id>" or "env:<source>/<KEY>" by
// NAME. Never a value: resolving one over MCP stays the 0203 OPEN
// item, deliberately not built here (docs/SPEC.md's own OPEN entry).
//
// SetSecretService late-binds the same way SetAtlasService/
// SetExecutionService do: main.go constructs SecretService before
// MillMCPService, but the setter call happens after NewMillMCPService
// returns, so the handler below reads m.secrets at CALL time.

// SetSecretService late-binds the secrets surface for
// secrets_list_references -- mcpsvc is not a Wails-bound service, so no
// //wails:ignore is needed (SetExecutionService's own doc comment).
func (m *MillMCPService) SetSecretService(s *secretsvc.SecretService) { m.secrets = s }

func (m *MillMCPService) requireSecrets() error {
	if m.secrets == nil {
		return fmt.Errorf("secret service not wired")
	}
	return nil
}

// registerSecretsTools wires secrets_list_references -- called from
// registerTools alongside every other tool tier.
func (m *MillMCPService) registerSecretsTools() {
	mcp.AddTool(m.server, &mcp.Tool{
		Name: "secrets_list_references",
		Description: "Every secret reference this Mill instance knows, by NAME only -- never a value: the " +
			"vault's own entries (\"vault:<id>\") and every enabled source's own keys (\"env:<source>/<KEY>\" " +
			"and friends), each with its label, its source (kind/label, when one backs it), and whether it " +
			"currently resolves. Point a field's secret reference at one of these ref strings. Read-only.",
		Annotations: readOnlyAnnotations,
	}, func(_ context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
		if err := m.requireSecrets(); err != nil {
			return nil, nil, err
		}
		refs, err := m.secrets.ListReferences()
		if err != nil {
			return nil, nil, err
		}
		res, err := jsonResult(refs)
		return res, nil, err
	})
}
