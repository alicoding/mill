package pluginsvc

import (
	"encoding/json"
	"strings"
	"testing"
)

// Every rule the automation contribution states, each proved by a
// manifest that breaks exactly it (goal 0324). The error text IS the
// contract: an author sees only this string, so each case pins the
// phrase that tells them what to change.

func schema(body string) json.RawMessage { return json.RawMessage(body) }

const objectSchema = `{"type":"object","properties":{}}`

func caseStep() StepContribution {
	return StepContribution{ID: "text-case", Label: "Text case", Config: []StepConfigContribution{{Key: "mode", Label: "Mode", Type: "options", Options: []string{"upper"}}}}
}

func stepToolSchema() json.RawMessage {
	return schema(`{"type":"object","properties":{"text":{"type":"string"},"mode":{"type":"string"}}}`)
}

func TestValidateContributes_ToolsAndCommands(t *testing.T) {
	tests := []struct {
		name       string
		contribute ManifestContributes
		want       string
	}{
		{
			name: "a step tool naming a declared step and its config passes",
			contribute: ManifestContributes{
				Steps: []StepContribution{caseStep()},
				Tools: []ToolContribution{{Name: "change_text_case", Description: "Changes the case of text.", InputSchema: stepToolSchema(), Effect: "read", Run: ToolRun{Kind: "step", StepID: "text-case"}}},
			},
		},
		{
			name: "an argument-less command tool naming a declared command passes",
			contribute: ManifestContributes{
				Commands: []CommandContribution{{ID: "refresh", Label: "Refresh"}},
				Tools:    []ToolContribution{{Name: "refresh_index", Description: "Lists the board again.", InputSchema: schema(objectSchema), Effect: "read", Run: ToolRun{Kind: "command", CommandID: "refresh"}}},
			},
		},
		{
			name: "a query tool declaring only the index's own filters passes",
			contribute: ManifestContributes{
				Tools: []ToolContribution{{Name: "list_board", Description: "Lists the board.", InputSchema: schema(`{"type":"object","properties":{"kind":{"type":"string"},"parentId":{"type":"string"}}}`), Effect: "read", Run: ToolRun{Kind: "query"}}},
			},
		},
		{
			name: "a name that is not verb_noun is refused",
			contribute: ManifestContributes{
				Tools: []ToolContribution{{Name: "ChangeCase", Description: "d", InputSchema: schema(objectSchema), Effect: "read", Run: ToolRun{Kind: "query"}}},
			},
			want: "must be named verb_noun",
		},
		{
			name: "a duplicate tool name is refused",
			contribute: ManifestContributes{
				Tools: []ToolContribution{
					{Name: "list_board", Description: "d", InputSchema: schema(objectSchema), Effect: "read", Run: ToolRun{Kind: "query"}},
					{Name: "list_board", Description: "d", InputSchema: schema(objectSchema), Effect: "read", Run: ToolRun{Kind: "query"}},
				},
			},
			want: "is declared twice",
		},
		{
			name: "a missing description is refused",
			contribute: ManifestContributes{
				Tools: []ToolContribution{{Name: "list_board", Description: "  ", InputSchema: schema(objectSchema), Effect: "read", Run: ToolRun{Kind: "query"}}},
			},
			want: "needs a description",
		},
		{
			name: "a description over the limit is refused",
			contribute: ManifestContributes{
				Tools: []ToolContribution{{Name: "list_board", Description: strings.Repeat("x", maxToolDescriptionLen+1), InputSchema: schema(objectSchema), Effect: "read", Run: ToolRun{Kind: "query"}}},
			},
			want: "200 characters or fewer",
		},
		{
			name: "an effect outside read and write is refused",
			contribute: ManifestContributes{
				Tools: []ToolContribution{{Name: "list_board", Description: "d", InputSchema: schema(objectSchema), Effect: "delete", Run: ToolRun{Kind: "query"}}},
			},
			want: `must declare effect "read" or "write"`,
		},
		{
			name: "an inputSchema that is not a JSON Schema object is refused",
			contribute: ManifestContributes{
				Tools: []ToolContribution{{Name: "list_board", Description: "d", InputSchema: schema(`{"type":"string"}`), Effect: "read", Run: ToolRun{Kind: "query"}}},
			},
			want: `"type": "object"`,
		},
		{
			name: "an unparseable inputSchema is refused",
			contribute: ManifestContributes{
				Tools: []ToolContribution{{Name: "list_board", Description: "d", InputSchema: schema(`not json`), Effect: "read", Run: ToolRun{Kind: "query"}}},
			},
			want: `"type": "object"`,
		},
		{
			name: "a run kind outside the three is refused",
			contribute: ManifestContributes{
				Tools: []ToolContribution{{Name: "list_board", Description: "d", InputSchema: schema(objectSchema), Effect: "read", Run: ToolRun{Kind: "shell"}}},
			},
			want: `must declare run.kind "command", "step" or "query"`,
		},
		{
			name: "a command tool naming an undeclared command is refused",
			contribute: ManifestContributes{
				Tools: []ToolContribution{{Name: "refresh_index", Description: "d", InputSchema: schema(objectSchema), Effect: "read", Run: ToolRun{Kind: "command", CommandID: "refresh"}}},
			},
			want: `names command "refresh", which contributes.commands does not declare`,
		},
		{
			name: "a command tool that takes arguments is refused",
			contribute: ManifestContributes{
				Commands: []CommandContribution{{ID: "refresh", Label: "Refresh"}},
				Tools:    []ToolContribution{{Name: "refresh_index", Description: "d", InputSchema: schema(`{"type":"object","properties":{"scope":{"type":"string"}}}`), Effect: "read", Run: ToolRun{Kind: "command", CommandID: "refresh"}}},
			},
			want: "must declare no properties",
		},
		{
			name: "a step tool naming an undeclared step is refused",
			contribute: ManifestContributes{
				Tools: []ToolContribution{{Name: "change_text_case", Description: "d", InputSchema: stepToolSchema(), Effect: "read", Run: ToolRun{Kind: "step", StepID: "text-case"}}},
			},
			want: `names step "text-case", which contributes.steps does not declare`,
		},
		{
			name: "a step tool without the payload argument is refused",
			contribute: ManifestContributes{
				Steps: []StepContribution{caseStep()},
				Tools: []ToolContribution{{Name: "change_text_case", Description: "d", InputSchema: schema(`{"type":"object","properties":{"mode":{"type":"string"}}}`), Effect: "read", Run: ToolRun{Kind: "step", StepID: "text-case"}}},
			},
			want: `must declare a "text" property`,
		},
		{
			name: "a step tool declaring an argument the step has no config for is refused",
			contribute: ManifestContributes{
				Steps: []StepContribution{caseStep()},
				Tools: []ToolContribution{{Name: "change_text_case", Description: "d", InputSchema: schema(`{"type":"object","properties":{"text":{"type":"string"},"locale":{"type":"string"}}}`), Effect: "read", Run: ToolRun{Kind: "step", StepID: "text-case"}}},
			},
			want: `declares the argument "locale", which step "text-case" has no config field for`,
		},
		{
			name: "a query tool declaring an argument outside the index's filters is refused",
			contribute: ManifestContributes{
				Tools: []ToolContribution{{Name: "list_board", Description: "d", InputSchema: schema(`{"type":"object","properties":{"title":{"type":"string"}}}`), Effect: "read", Run: ToolRun{Kind: "query"}}},
			},
			want: `may declare only "kind" and "parentId"`,
		},
		{
			name:       "a command id outside the slug shape is refused",
			contribute: ManifestContributes{Commands: []CommandContribution{{ID: "Refresh Index", Label: "Refresh"}}},
			want:       "must be lowercase letters, digits, and hyphens",
		},
		{
			name:       "a duplicate command id is refused",
			contribute: ManifestContributes{Commands: []CommandContribution{{ID: "refresh", Label: "Refresh"}, {ID: "refresh", Label: "Again"}}},
			want:       `contributed command "refresh" is declared twice`,
		},
		{
			name:       "a command without a label is refused",
			contribute: ManifestContributes{Commands: []CommandContribution{{ID: "refresh", Label: " "}}},
			want:       `contributed command "refresh" needs a label`,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := validateContributes(tc.contribute)
			if tc.want == "" {
				if got != "" {
					t.Fatalf("validateContributes = %q, want no problem", got)
				}
				return
			}
			if !strings.Contains(got, tc.want) {
				t.Fatalf("validateContributes = %q, want it to state %q", got, tc.want)
			}
		})
	}
}
