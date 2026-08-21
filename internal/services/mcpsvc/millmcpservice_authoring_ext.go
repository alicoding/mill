package mcpsvc

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Goal 0130: the last two authoring-surface gaps. test_request is the
// Try-it panel's MCP twin; atlas_propose_kind_write is card-write's
// sibling for the SCHEMA side. Both route through gateWrite -- a real
// outbound HTTP call and a vocabulary change are exactly as deliberate
// as any other agent write, even though test_request persists nothing
// (an agent-initiated external call is an external effect; the UI's
// own Try-it is ungated because a human clicked it).

// testRequestArgs mirrors ConfigureService.TestHTTPRequestInput's
// draft-testing surface, plus requestId-only convenience: naming an
// existing Integration fills its stored base URL/auth/headers/spec
// (and keychain secret) so an agent can test a CONFIGURED integration
// without re-supplying its definition.
type testRequestArgs struct {
	RequestID   string            `json:"requestId,omitempty" jsonschema:"an existing Integration's id -- its stored base URL/auth/headers/spec (and keychain secret) fill any field left empty below"`
	BaseURL     string            `json:"baseUrl,omitempty" jsonschema:"draft mode: the request URL (may embed path templates)"`
	AuthType    string            `json:"authType,omitempty" jsonschema:"draft mode: none|apikey|bearer|hmac|oauth1|oauth2|queryparam|mtls (empty = none)"`
	Secret      string            `json:"secret,omitempty" jsonschema:"used for this call only, never stored"`
	Headers     map[string]string `json:"headers,omitempty"`
	OpenAPISpec string            `json:"openApiSpec,omitempty" jsonschema:"the operation catalogue to test against; filled from the stored Integration when requestId is set"`
	Path        string            `json:"path" jsonschema:"the operation's path from the spec (e.g. '/')"`
	Method      string            `json:"method" jsonschema:"the operation's method (e.g. GET)"`
	Values      map[string]string `json:"values,omitempty" jsonschema:"operation input values keyed by field key"`
}

func (m *MillMCPService) resolveTestRequestInput(in testRequestArgs) (configuresvc.TestHTTPRequestInput, error) {
	out := configuresvc.TestHTTPRequestInput{
		RequestID: in.RequestID, BaseURL: in.BaseURL,
		AuthType: httprequest.AuthType(in.AuthType), Secret: in.Secret,
		Headers: in.Headers, OpenAPISpec: in.OpenAPISpec,
		Path: in.Path, Method: in.Method, Values: in.Values,
	}
	if in.RequestID == "" {
		return out, nil
	}
	for _, r := range m.cfg.HTTPRequests() {
		if r.ID != in.RequestID {
			continue
		}
		if out.BaseURL == "" {
			out.BaseURL = r.BaseURL
		}
		if in.AuthType == "" {
			out.AuthType = r.AuthType
		}
		if out.OpenAPISpec == "" {
			out.OpenAPISpec = r.OpenAPISpec
		}
		if len(out.Headers) == 0 {
			out.Headers = r.Headers
		}
		if out.Auth == nil {
			out.Auth = r.Auth
		}
		return out, nil
	}
	return out, fmt.Errorf("no integration with id %q", in.RequestID)
}

// kindProposedField is one typed field in a proposed Kind write.
type kindProposedField struct {
	Key     string   `json:"key" jsonschema:"the field's stable key (immutable once saved)"`
	Label   string   `json:"label"`
	Type    string   `json:"type,omitempty" jsonschema:"text|number|boolean|options|cardref (empty = text)"`
	Options []string `json:"options,omitempty" jsonschema:"for type options: the allowed values, in display-color order"`
	RefKind string   `json:"refKind,omitempty" jsonschema:"for type cardref: the target atlas kind's id (see atlas_list_kinds); empty allows any kind"`
	// ShowOnCard mirrors the Kinds dialog's Show-on-card toggle
	// (docs/goals/0152): the field's value surfaces on card faces.
	ShowOnCard bool `json:"showOnCard,omitempty"`
}

// atlasProposeKindWriteArgs mirrors atlas_propose_card_write's own
// mode split: create when kindId is empty (label required), update
// otherwise; delete via the explicit flag (refused server-side while
// any live card uses the kind).
type atlasProposeKindWriteArgs struct {
	KindID      string              `json:"kindId,omitempty" jsonschema:"update/delete mode: the existing Kind's id. Omit to create."`
	Label       string              `json:"label,omitempty" jsonschema:"create: required. update: replaces when given."`
	Description string              `json:"description,omitempty"`
	Icon        string              `json:"icon,omitempty"`
	Fields      []kindProposedField `json:"fields,omitempty" jsonschema:"the Kind's typed fields -- omit on update to keep the existing fields; a provided list must retain every saved key (removals are refused -- the schema-evolution guard)"`
	Delete      bool                `json:"delete,omitempty" jsonschema:"true deletes kindId (refused while any live card uses it)"`
}

func kindFieldsFromArgs(fields []kindProposedField) []typedfield.Field {
	out := make([]typedfield.Field, 0, len(fields))
	for _, f := range fields {
		t := typedfield.Type(f.Type)
		if f.Type == "" {
			t = typedfield.TypeText
		}
		out = append(out, typedfield.Field{Key: f.Key, Label: f.Label, Type: t, Options: f.Options, RefKind: f.RefKind, ShowOnCard: f.ShowOnCard})
	}
	return out
}

// registerAuthoringExtTools wires test_request + atlas_propose_kind_write.
func (m *MillMCPService) registerAuthoringExtTools() {
	m.registerTestRequestTool()
	m.registerKindWriteTool()
}

func (m *MillMCPService) registerTestRequestTool() {
	m.registerWriteExecutor("test_request", m.executeTestRequest)
	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "test_request",
		Description: "Execute ONE real HTTP call to test an Integration draft (pass baseUrl/authType/secret/openApiSpec inline) or an existing Integration (pass requestId; stored config and keychain secret fill in). Nothing is persisted -- this is the Configure Try-it panel's agent twin. Requires the human-set 'Allow MCP clients to import data' toggle (default off) and parks pending human approval like every write; poll check_write_status with the returned id -- the approved result carries statusCode/body/headers.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in testRequestArgs) (*mcp.CallToolResult, any, error) {
		if err := m.requireWriteEnabled(); err != nil {
			return nil, nil, err
		}
		if strings.TrimSpace(in.Path) == "" || strings.TrimSpace(in.Method) == "" {
			return nil, nil, fmt.Errorf("path and method are required")
		}
		resolved, err := m.resolveTestRequestInput(in)
		if err != nil {
			return nil, nil, err
		}
		if strings.TrimSpace(resolved.BaseURL) == "" {
			return nil, nil, fmt.Errorf("baseUrl is required (or pass requestId for a configured integration)")
		}
		argsJSON, err := marshalArgs(in)
		if err != nil {
			return nil, nil, err
		}
		desc := fmt.Sprintf("Test HTTP call: %s %s against %s", strings.ToUpper(resolved.Method), resolved.Path, resolved.BaseURL)
		res, err := m.gateWrite("test_request", desc, argsJSON)
		return res, nil, err
	})
}

func (m *MillMCPService) registerKindWriteTool() {
	m.registerWriteExecutor("atlas_propose_kind_write", m.executeAtlasProposeKindWrite)
	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "atlas_propose_kind_write",
		Description: "Propose creating a new Atlas Kind (label required, plus optional description/icon/fields), updating an existing one (kindId; omit fields to keep them; a provided list must retain every saved key -- removals are refused by the schema-evolution guard), or deleting one (kindId + delete:true; refused while any live card uses it). Same gate and approval queue as every write; poll atlas_get_write_status or check_write_status.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in atlasProposeKindWriteArgs) (*mcp.CallToolResult, any, error) {
		if err := m.requireWriteEnabled(); err != nil {
			return nil, nil, err
		}
		if err := m.requireAtlas(); err != nil {
			return nil, nil, err
		}
		if in.KindID == "" && strings.TrimSpace(in.Label) == "" {
			return nil, nil, fmt.Errorf("label is required to create a Kind (or pass kindId to update/delete an existing one)")
		}
		if in.Delete && in.KindID == "" {
			return nil, nil, fmt.Errorf("delete requires kindId")
		}
		argsJSON, err := marshalArgs(in)
		if err != nil {
			return nil, nil, err
		}
		res, err := m.gateWrite("atlas_propose_kind_write", kindWriteDescription(in), argsJSON)
		return res, nil, err
	})
}

func kindWriteDescription(in atlasProposeKindWriteArgs) string {
	switch {
	case in.Delete:
		return fmt.Sprintf("Delete the Atlas kind %q", in.KindID)
	case in.KindID != "":
		return fmt.Sprintf("Update the Atlas kind %q (%d fields)", in.KindID, len(in.Fields))
	default:
		return fmt.Sprintf("Create the Atlas kind %q (%d fields)", in.Label, len(in.Fields))
	}
}

func (m *MillMCPService) executeTestRequest(argsJSON string) (string, error) {
	var in testRequestArgs
	if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
		return "", fmt.Errorf("test_request: %w", err)
	}
	resolved, err := m.resolveTestRequestInput(in)
	if err != nil {
		return "", err
	}
	result, err := m.cfg.TestHTTPRequestOperation(resolved)
	if err != nil {
		return "", err
	}
	// Keep the durable record bounded -- a huge body belongs in a real
	// workflow run, not an approval record.
	const maxBody = 16 * 1024
	if len(result.Body) > maxBody {
		result.Body = result.Body[:maxBody] + "… (truncated)"
	}
	out, err := json.Marshal(result)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func (m *MillMCPService) executeAtlasProposeKindWrite(argsJSON string) (string, error) {
	var in atlasProposeKindWriteArgs
	if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
		return "", fmt.Errorf("atlas_propose_kind_write: %w", err)
	}
	switch {
	case in.Delete:
		if err := m.atlas.DeleteKind(in.KindID); err != nil {
			return "", err
		}
		return fmt.Sprintf(`{"kindId":%q,"deleted":true}`, in.KindID), nil
	case in.KindID != "":
		return m.executeKindUpdate(in)
	default:
		kind, err := m.atlas.CreateKind(in.Label, in.Description, in.Icon, kindFieldsFromArgs(in.Fields))
		if err != nil {
			return "", err
		}
		return fmt.Sprintf(`{"kindId":%q,"label":%q}`, kind.ID, kind.Label), nil
	}
}

func (m *MillMCPService) executeKindUpdate(in atlasProposeKindWriteArgs) (string, error) {
	fields := kindFieldsFromArgs(in.Fields)
	if in.Fields == nil {
		// Omitted fields mean "keep them" -- ADR-0040's removal guard
		// refuses a shrunk list, and an update that only renames the
		// kind must never have to restate its schema.
		for _, k := range m.atlas.Kinds() {
			if k.ID == in.KindID {
				fields = k.Fields
				break
			}
		}
	}
	kind, err := m.atlas.UpdateKind(in.KindID, in.Label, in.Description, in.Icon, fields, nil)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf(`{"kindId":%q,"label":%q}`, kind.ID, kind.Label), nil
}
