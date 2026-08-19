package composition

import (
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/seedorigin"
)

// The Atlassian PAT family (goal 0111): two DISABLED example workflows
// demonstrating the two seeded bring-your-own-host HTTPRequest
// integrations (httprequest.ExampleConfluencePageReadID/
// ExampleJiraSearchID) end to end. Ship disabled, same as the
// disabled-schedule/disabled-filesystem-watch examples elsewhere in
// this package, since both integrations ship a placeholder
// (never-resolving) host and no PAT -- neither can run for real until
// a user supplies their own Atlassian host and token. Split into its
// own file following builtinworkflows_clipbridge.go's shape (a
// self-contained family with no nodes referenced elsewhere in this
// package).
func builtInAtlassianWorkflows() []Workflow {
	const (
		confluenceTriggerID  = "atlassian-confluence-trigger"
		confluenceHTTPID     = "atlassian-confluence-http"
		confluenceMarkdownID = "atlassian-confluence-markdown"
		confluenceApplyID    = "atlassian-confluence-apply"
	)
	confluenceNodes, err := ResolveNodeDefaults([]Node{
		{ID: confluenceTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: confluenceHTTPID, NodeTypeID: "integration-http", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"requestId": httprequest.ExampleConfluencePageReadID}},
		{ID: confluenceMarkdownID, NodeTypeID: "process-html-to-markdown", Position: Position{X: 0, Y: 200}},
		{ID: confluenceApplyID, NodeTypeID: "apply-clipboard-write-text", Position: Position{X: 0, Y: 300}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	const (
		jiraTriggerID = "atlassian-jira-trigger"
		jiraHTTPID    = "atlassian-jira-http"
		jiraApplyID   = "atlassian-jira-apply"
	)
	jiraNodes, err := ResolveNodeDefaults([]Node{
		{ID: jiraTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: jiraHTTPID, NodeTypeID: "integration-http", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"requestId": httprequest.ExampleJiraSearchID}},
		{ID: jiraApplyID, NodeTypeID: "apply-clipboard-write-text", Position: Position{X: 0, Y: 200}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return []Workflow{
		{
			ID:    "example-confluence-to-markdown-workflow",
			Label: "Example: Confluence page → Markdown",
			Description: "Fetches a Confluence page over your personal access token, converts the " +
				"rendered HTML to Markdown, and puts it on your clipboard. Configure the Example: " +
				"Confluence page (PAT) integration first, then run with a page id.",
			Nodes: confluenceNodes,
			Edges: []Edge{
				{ID: "atlassian-confluence-e0", Source: confluenceTriggerID, Target: confluenceHTTPID},
				{ID: "atlassian-confluence-e1", Source: confluenceHTTPID, Target: confluenceMarkdownID},
				{ID: "atlassian-confluence-e2", Source: confluenceMarkdownID, Target: confluenceApplyID},
			},
			BuiltIn:  true,
			Seed:     seedorigin.Stamp(1),
			Disabled: true,
		},
		{
			ID:    "example-jira-search-workflow",
			Label: "Example: Jira search → clipboard",
			Description: "Runs a JQL search over your personal access token and puts the JSON result " +
				"on your clipboard for inspection. Configure the Example: Jira search (PAT) integration " +
				"first.",
			Nodes: jiraNodes,
			Edges: []Edge{
				{ID: "atlassian-jira-e0", Source: jiraTriggerID, Target: jiraHTTPID},
				{ID: "atlassian-jira-e1", Source: jiraHTTPID, Target: jiraApplyID},
			},
			BuiltIn:  true,
			Seed:     seedorigin.Stamp(1),
			Disabled: true,
		},
	}
}
