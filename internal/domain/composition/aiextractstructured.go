package composition

import (
	"encoding/json"
	"fmt"

	"github.com/alicoding/mill/internal/adapters/aiclient"
	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// aiExtractOutputField is this node's own output-field declaration --
// a type alias of typedfield.Field, same convergence decision.OutputField
// already made (ADR-0029): the canonical leaf field shape, not a fourth
// near-duplicate. Authored node-locally (AIExtractFieldsEditor.tsx),
// NOT referencing a Configure entity's schema -- unlike decision-outcome
// (which binds against an existing Decision's declared Outputs), this
// node DEFINES its own typed result shape per step, since two different
// extraction steps legitimately want different fields.
type aiExtractOutputField = typedfield.Field

// parseAIExtractFields decodes this node's own outputFields config --
// exported spelling kept lowercase (package-internal) since only this
// file and its test need it, same visibility as ParseRulesetRules's own
// sibling functions in this package.
func parseAIExtractFields(raw string) ([]aiExtractOutputField, error) {
	if raw == "" {
		return nil, nil
	}
	var fields []aiExtractOutputField
	if err := json.Unmarshal([]byte(raw), &fields); err != nil {
		return nil, fmt.Errorf("outputFields must be a JSON list of {Key,Label,Type}: %w", err)
	}
	return fields, nil
}

// jsonSchemaType maps typedfield.Type to its JSON Schema "type" -- the
// wire vocabulary internal/adapters/aiclient's two adapters actually
// send to each provider's structured-output request. TypeOptions
// becomes "string" (its Options list becomes the schema's "enum",
// applied by buildExtractSchema below); TypeDate/TypeDatetime become
// "string" (RFC 3339 is the universal, unambiguous text
// representation neither adapter has any reason to special-case).
func jsonSchemaType(t typedfield.Type) string {
	switch t {
	case typedfield.TypeNumber:
		return "number"
	case typedfield.TypeInteger:
		return "integer"
	case typedfield.TypeBoolean:
		return "boolean"
	case typedfield.TypeObject, typedfield.TypeMap:
		return "object"
	case typedfield.TypeArray:
		return "array"
	default: // TypeText, TypeOptions, TypeDate, TypeDatetime
		return "string"
	}
}

// buildExtractSchema turns this node's declared output fields into a
// JSON Schema object document -- every declared field is required (an
// extraction step's whole point is to populate its full declared
// shape; a partial response is exactly what the schema-forcing request
// exists to prevent), mirroring resolveDecisionOutputs' own
// "the outcome's shape is always the full declared contract" stance
// one layer up (decisionoutcome.go).
func buildExtractSchema(fields []aiExtractOutputField) ([]byte, error) {
	properties := make(map[string]any, len(fields))
	required := make([]string, 0, len(fields))
	for _, f := range fields {
		prop := map[string]any{"type": jsonSchemaType(f.Type)}
		if f.Type == typedfield.TypeOptions && len(f.Options) > 0 {
			prop["enum"] = f.Options
		}
		properties[f.Key] = prop
		required = append(required, f.Key)
	}
	schema := map[string]any{
		"type":                 "object",
		"properties":           properties,
		"required":             required,
		"additionalProperties": false,
	}
	return json.Marshal(schema)
}

// applyExtractedFields decodes the provider's structured JSON result and
// writes each declared field's value into ctx.Attributes -- unlike
// resolveDecisionOutputs (attributebinding.go/decisionoutcome.go), which
// coerces a STRING binding against a target type, the values here are
// ALREADY natively typed (encoding/json decodes a JSON number into
// float64, a JSON bool into bool, etc, exactly what
// internal/adapters/aiclient.Result.JSON contains for a schema-forced
// response) -- so this copies them through directly rather than
// re-stringifying and re-coercing. A field missing from the response
// (a provider that didn't fully honor the schema) falls back to
// zeroForOutputType (decisionoutcome.go), the same permissive "still
// appears, zero-valued" contract decision-outcome's own outputs give.
func applyExtractedFields(resultJSON []byte, fields []aiExtractOutputField, ctx *ExecContext) error {
	var decoded map[string]any
	if err := json.Unmarshal(resultJSON, &decoded); err != nil {
		return fmt.Errorf("parse structured result: %w", err)
	}
	if ctx.Attributes == nil {
		ctx.Attributes = map[string]any{}
	}
	for _, f := range fields {
		if v, ok := decoded[f.Key]; ok {
			ctx.Attributes[f.Key] = v
		} else {
			ctx.Attributes[f.Key] = zeroForOutputType(f.Type)
		}
	}
	return nil
}

func init() {
	RegisterNodeType(NodeType{
		ID: "process-ai-extract-structured", Kind: KindProcess,
		Effect:      guardrail.ClassExternal, // dynamic downgrade for a loopback provider -- aiprovider.go's aiNodeEffectOverride
		Complexity:  ComplexityAdvanced,      // authors a JSON-shaped output-field schema, not a plain value
		Output:      "unchanged payload -- the extracted typed result is written into the named Attributes below",
		Label:       "AI: Extract structured data",
		Description: "Sends a prompt (plus the running payload) to a Configure-authored AI provider, requests a JSON-schema-constrained structured response, and writes each declared output field into this workflow's Attributes by the same key -- the step that composes with Branch for real decisioning (docs/goals/0031-ai-node-family.md). Composition matches process-ai-completion: user content = Prompt + payload. Every declared field is required in the requested schema; a field the provider's response omits still appears in Attributes, zero-valued for its type.",
		ConfigFields: []ConfigField{
			{
				Key: aiProviderIDConfigKey, Label: "AI provider",
				Description: "Which Configure-authored AI provider (local Ollama or a BYO endpoint) this step calls.",
				Default:     "", Type: FieldText, RefKind: "aiprovider",
			},
			{
				Key: "prompt", Label: "Prompt", Multiline: true,
				Description: "The extraction instruction sent as the user message, followed by the current payload (if any).",
				Default:     "", Type: FieldText,
			},
			{
				// Rendered by AIExtractFieldsEditor.tsx (NodeInspector.tsx),
				// same "own dedicated editor, not a generic ConfigField
				// widget" precedent DecisionOutcomeBindingsEditor.tsx and
				// MCPToolArgsEditor.tsx already establish for this package's
				// other structured, non-generic config shapes.
				Key: "outputFields", Multiline: true,
				Label:       "Output fields",
				Description: "The typed fields this step extracts -- each becomes an Attribute of the same key, authored via the field editor below (not raw JSON).",
				Default:     "", Type: FieldText,
			},
		},
	}, func(node Node, ctx ExecContext) (ExecContext, error) {
		rp, err := lookupAIProviderFn(node.Config[aiProviderIDConfigKey])
		if err != nil {
			return ctx, fmt.Errorf("process-ai-extract-structured: %w", err)
		}
		fields, err := parseAIExtractFields(node.Config["outputFields"])
		if err != nil {
			return ctx, fmt.Errorf("process-ai-extract-structured: %w", err)
		}
		if len(fields) == 0 {
			return ctx, fmt.Errorf("process-ai-extract-structured: no output fields configured")
		}
		schema, err := buildExtractSchema(fields)
		if err != nil {
			return ctx, fmt.Errorf("process-ai-extract-structured: build schema: %w", err)
		}

		result, err := aiCompleteFn(aiclient.Request{
			Kind:    aiclient.Kind(rp.Kind),
			BaseURL: rp.BaseURL,
			Model:   rp.Model,
			APIKey:  rp.APIKey,
			Prompt:  composeAIUserContent(node.Config["prompt"], ctx.Payload),
			Schema:  &aiclient.SchemaSpec{Name: "extraction", Schema: schema},
		})
		if err != nil {
			return ctx, fmt.Errorf("process-ai-extract-structured: %w", err)
		}
		if err := applyExtractedFields(result.JSON, fields, &ctx); err != nil {
			return ctx, fmt.Errorf("process-ai-extract-structured: %w", err)
		}
		return ctx, nil
	})
}
