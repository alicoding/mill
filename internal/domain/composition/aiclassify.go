package composition

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/alicoding/mill/internal/adapters/aiclient"
	"github.com/alicoding/mill/internal/domain/guardrail"
)

// parseAIClassifyCategories decodes this node's own newline-separated
// categories config -- one category per line, blank lines ignored.
// Deliberately a plain multiline text field, not a JSON array or a
// dedicated row-editor component: docs/goals/0031-ai-node-family.md's
// own design ("categories: node-local list -- business rule stays on
// canvas") only needs a flat list of short labels, the same shape
// ai-completion's own Prompt field already renders generically
// (Multiline FieldText), so a bespoke editor here would be indirection
// with no real authoring benefit over one line per category.
func parseAIClassifyCategories(raw string) []string {
	var out []string
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			out = append(out, line)
		}
	}
	return out
}

// buildClassifySchema constrains the AI provider's structured response
// to exactly one field, "category", whose value must be one of the
// declared categories -- the JSON Schema "enum" keyword, honored by
// both internal/adapters/aiclient wire shapes (OpenAI-compatible
// response_format.json_schema, Anthropic's forced tool input_schema).
func buildClassifySchema(categories []string) []byte {
	schema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"category": map[string]any{"type": "string", "enum": categories},
		},
		"required":             []string{"category"},
		"additionalProperties": false,
	}
	data, _ := json.Marshal(schema) // map[string]any with only string/[]string values never fails to marshal
	return data
}

func init() {
	RegisterNodeType(NodeType{
		ID: "process-ai-classify", Kind: KindProcess,
		Effect: guardrail.ClassExternal, // dynamic downgrade for a loopback provider -- aiprovider.go's aiNodeEffectOverride
		Output: "unchanged payload -- the chosen category is written into the named Attribute below",
		Label:  "AI: Classify",
		Description: "Sends the running payload (plus an optional instruction) to a Configure-authored AI provider and asks it to pick exactly one of this step's own declared categories, writing the choice into a named Attribute -- a dedicated classification node (Dify's own precedent researched in docs/goals/0031-ai-node-family.md), not composed from extract-structured, since \"pick one of these labels\" is common enough across real workflows to deserve its own shape. Pairs with Branch: route on the written Attribute to act on the classification. The category list is this workflow's own business decision (node-local, not Configure-authored) -- two workflows classifying into different category sets is normal, not drift.",
		ConfigFields: []ConfigField{
			{
				Key: aiProviderIDConfigKey, Label: "AI provider",
				Description: "Which Configure-authored AI provider (local Ollama or a BYO endpoint) this step calls.",
				Default:     "", Type: FieldText, RefKind: "aiprovider",
			},
			{
				Key: "instruction", Label: "Instruction", Multiline: true,
				Description: "Optional guidance sent as the user message, followed by the current payload. Leave empty to classify the payload with no extra instruction.",
				Default:     "", Type: FieldText,
			},
			{
				Key: "categories", Label: "Categories", Multiline: true,
				Description: "One category per line -- the AI picks exactly one of these.",
				Default:     "", Type: FieldText,
			},
			{
				Key: "outputAttribute", Label: "Write category to",
				Description: "The declared Attribute key the chosen category is written into.",
				Default:     "", Type: FieldText,
			},
		},
	}, func(node Node, ctx ExecContext) (ExecContext, error) {
		outputAttr := strings.TrimSpace(node.Config["outputAttribute"])
		if outputAttr == "" {
			return ctx, fmt.Errorf("process-ai-classify: no output attribute configured")
		}
		categories := parseAIClassifyCategories(node.Config["categories"])
		if len(categories) == 0 {
			return ctx, fmt.Errorf("process-ai-classify: no categories configured")
		}

		rp, err := lookupAIProviderFn(node.Config[aiProviderIDConfigKey])
		if err != nil {
			return ctx, fmt.Errorf("process-ai-classify: %w", err)
		}

		result, err := aiCompleteFn(aiclient.Request{
			Kind:    aiclient.Kind(rp.Kind),
			BaseURL: rp.BaseURL,
			Model:   rp.Model,
			APIKey:  rp.APIKey,
			Prompt:  composeAIUserContent(node.Config["instruction"], ctx.Payload),
			Schema:  &aiclient.SchemaSpec{Name: "classification", Schema: buildClassifySchema(categories)},
		})
		if err != nil {
			return ctx, fmt.Errorf("process-ai-classify: %w", err)
		}

		var decoded struct {
			Category string `json:"category"`
		}
		if err := json.Unmarshal(result.JSON, &decoded); err != nil {
			return ctx, fmt.Errorf("process-ai-classify: parse structured result: %w", err)
		}
		// Fail-safe (node-standard item 6): the schema constrains the
		// request, but doesn't guarantee every provider/model honors an
		// enum perfectly -- a category outside the declared list is
		// treated as an unevaluable/ambiguous result, not silently
		// written through.
		valid := false
		for _, c := range categories {
			if c == decoded.Category {
				valid = true
				break
			}
		}
		if !valid {
			return ctx, fmt.Errorf("process-ai-classify: provider returned category %q, not one of the declared categories", decoded.Category)
		}

		if ctx.Attributes == nil {
			ctx.Attributes = map[string]any{}
		}
		ctx.Attributes[outputAttr] = decoded.Category
		return ctx, nil
	})
}
