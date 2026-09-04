package composition

import (
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/list"
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

	const (
		jiraSyncTriggerID = "atlassian-jira-sync-trigger"
		jiraSyncHTTPID    = "atlassian-jira-sync-http"
		jiraSyncApplyID   = "atlassian-jira-sync-apply"
	)
	jiraSyncNodes, err := ResolveNodeDefaults([]Node{
		{ID: jiraSyncTriggerID, NodeTypeID: "trigger-schedule", Position: Position{X: 0, Y: 0},
			Config: map[string]string{"cron": "*/15 * * * *"}},
		{ID: jiraSyncHTTPID, NodeTypeID: "integration-http", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"requestId": httprequest.ExampleJiraSearchID}},
		{ID: jiraSyncApplyID, NodeTypeID: "apply-list-sync", Position: Position{X: 0, Y: 200},
			Config: map[string]string{
				"listId": list.ExampleJiraIssuesID, "itemsPath": "issues", "keyColumn": "key", "expireMissing": "true",
				"fieldMap": `{"key":"key","summary":"fields.summary","status":"fields.status.name",` +
					`"assignee":"fields.assignee.displayName","updated":"fields.updated",` +
					`"url":"https://jira.example.com/browse/{{key}}"}`,
			}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return []Workflow{
		{
			ID:    "example-jira-issues-sync-workflow",
			Label: "Example: Jira issues → List",
			Description: "Every 15 minutes, runs the Example: Jira search (PAT) integration and mirrors the " +
				"issues it returns into the Example: Jira issues List, one row per issue matched by key. " +
				"The sync is one-way; nothing is written back to Jira. Configure the integration's base URL and token, " +
				"set the url column's base in the sync step, then enable this workflow.",
			Nodes: jiraSyncNodes,
			Edges: []Edge{
				{ID: "atlassian-jira-sync-e0", Source: jiraSyncTriggerID, Target: jiraSyncHTTPID},
				{ID: "atlassian-jira-sync-e1", Source: jiraSyncHTTPID, Target: jiraSyncApplyID},
			},
			BuiltIn:  true,
			Seed:     seedorigin.Stamp(2),
			Disabled: true,
		},
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
			BuiltIn: true,
			// SeedRevision 2: OfferOnRequestID added (goal 0126) --
			// this workflow appears as an offered action on any card
			// whose Source host matches the configured Confluence
			// integration, the seeded recognition proof.
			Seed:             seedorigin.Stamp(2),
			Disabled:         true,
			OfferOnRequestID: httprequest.ExampleConfluencePageReadID,
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
