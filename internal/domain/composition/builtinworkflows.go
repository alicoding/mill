package composition

import (
	"github.com/alicoding/mill/internal/domain/decision"
	"github.com/alicoding/mill/internal/domain/execenv"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/mcpserver"
)

// BuiltInWorkflows are the workflows this prototype ships seeded --
// the same real clipboard/markdown capability internal/domain/runbook
// already ships, decomposed into nodes with explicit positions so they
// render sensibly on first canvas load without needing auto-layout. Not
// deletable (see CompositionService.DeleteWorkflow). Split out of
// nodetypes.go once that file crossed the 500-line limit
// (.claude/rules/architecture.md) -- see that file's own doc comment
// for the seam this split follows.
func BuiltInWorkflows() []Workflow {
	const loadSampleTriggerID = "load-sample-html-trigger"
	loadSample, err := ResolveNodeDefaults([]Node{
		{ID: loadSampleTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: "load-sample-html", NodeTypeID: "apply-clipboard-write-html", Position: Position{X: 0, Y: 100}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	const (
		triggerID = "clipboard-to-markdown-trigger"
		captureID = "clipboard-to-markdown-capture"
		processID = "clipboard-to-markdown-process"
		applyID   = "clipboard-to-markdown-apply"
	)
	clipboardToMarkdown, err := ResolveNodeDefaults([]Node{
		{ID: triggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: captureID, NodeTypeID: "capture-clipboard-html", Position: Position{X: 0, Y: 100}},
		{ID: processID, NodeTypeID: "process-html-to-markdown", Position: Position{X: 0, Y: 200}},
		{ID: applyID, NodeTypeID: "apply-clipboard-write-text", Position: Position{X: 0, Y: 300}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	// The guardrail proof (docs/adr/0022, and the standing seeded-
	// examples principle): an external-effect step whose run parks
	// awaiting approval by default. References the seeded no-auth
	// HTTPRequest by its exported ID constant rather than a string that
	// could drift.
	const (
		guardedTriggerID = "example-guarded-trigger"
		guardedHTTPID    = "example-guarded-http"
	)
	guardedNodes, err := ResolveNodeDefaults([]Node{
		{ID: guardedTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: guardedHTTPID, NodeTypeID: "integration-http", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"requestId": httprequest.ExampleNoneID}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	// A seeded parent/child pair demonstrating docs/adr/0010 end to end
	// (prompted directly): the child is callable-only with a typed input
	// (its declared "message" Attribute, read into the payload by
	// capture-attribute); the parent invokes it with a bound input and
	// stores the child's typed output into its own "childResult"
	// Attribute via child-workflow's outputAttribute.
	const (
		childTriggerID = "example-child-trigger"
		childCaptureID = "example-child-capture"
		childInjectID  = "example-child-inject"
	)
	// The child ships with TWO definitions (ADR-0021, and the standing
	// seeded-examples principle: a seed must exercise the feature it
	// demonstrates): v1 -- published, what the pinned parent and any
	// live caller executes -- and a newer, deliberately different DRAFT
	// head, proving edits never leak into production until published.
	childV1Nodes, err := ResolveNodeDefaults([]Node{
		{ID: childTriggerID, NodeTypeID: "trigger-callable", Position: Position{X: 0, Y: 0}},
		{ID: childCaptureID, NodeTypeID: "capture-attribute", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"attribute": "message"}},
		{ID: childInjectID, NodeTypeID: "process-inject-text", Position: Position{X: 0, Y: 200},
			Config: map[string]string{"text": "(processed by the child workflow, v1)", "placement": "append"}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}
	childDraftNodes, err := ResolveNodeDefaults([]Node{
		{ID: childTriggerID, NodeTypeID: "trigger-callable", Position: Position{X: 0, Y: 0}},
		{ID: childCaptureID, NodeTypeID: "capture-attribute", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"attribute": "message"}},
		{ID: childInjectID, NodeTypeID: "process-inject-text", Position: Position{X: 0, Y: 200},
			Config: map[string]string{"text": "(child DRAFT -- publish to make this live)", "placement": "append"}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	const (
		parentTriggerID = "example-parent-trigger"
		parentChildID   = "example-parent-child-step"
	)
	parentNodes, err := ResolveNodeDefaults([]Node{
		{ID: parentTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: parentChildID, NodeTypeID: "child-workflow", Position: Position{X: 0, Y: 100},
			Config: map[string]string{
				"workflowId": ExampleChildWorkflowID,
				// Pinned to v1 (ADR-0021): the child's draft says
				// something different on purpose -- running this parent
				// proves the pin (and that drafts never leak).
				"version":         "1",
				"inputBindings":   `{"message":"hello from the parent workflow"}`,
				"outputAttribute": "childResult",
			}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	// Human review + ruleset in one seed (docs/adr/0023, and the
	// standing seeded-examples principle): running it parks in the
	// Review queue; the reviewer's typed input (the 'note' Attribute)
	// flows into the resumed run, is read into the payload, and is then
	// validated by a ruleset -- both new concepts proven in one flow.
	const (
		reviewTriggerID = "example-review-trigger"
		reviewStepID    = "example-review-step"
		reviewCaptureID = "example-review-capture"
		reviewRulesetID = "example-review-ruleset"
	)
	reviewNodes, err := ResolveNodeDefaults([]Node{
		{ID: reviewTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: reviewStepID, NodeTypeID: "human-review", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"message": "Provide a note for this run, then approve"}},
		{ID: reviewCaptureID, NodeTypeID: "capture-attribute", Position: Position{X: 0, Y: 200},
			Config: map[string]string{"attribute": "note"}},
		{ID: reviewRulesetID, NodeTypeID: "ruleset", Position: Position{X: 0, Y: 300},
			Config: map[string]string{"rulesJSON": `[{"name":"note provided","condition":"Attributes['note'] != ''"}]`}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	// A disabled scheduled workflow (ADR-0021's inactive state): its
	// every-minute schedule never arms while Disabled -- flip the
	// toggle to watch it start firing into Activity.
	const (
		disabledTriggerID = "example-disabled-trigger"
		disabledInjectID  = "example-disabled-inject"
	)
	disabledNodes, err := ResolveNodeDefaults([]Node{
		{ID: disabledTriggerID, NodeTypeID: "trigger-schedule", Position: Position{X: 0, Y: 0},
			Config: map[string]string{"cron": "* * * * *"}},
		{ID: disabledInjectID, NodeTypeID: "process-inject-text", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"text": "the disabled example fired -- you enabled it", "placement": "append"}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	// Decision as a reusable, typed TERMINAL outcome (docs/adr/0027,
	// and the standing seeded-examples principle): a branch (decision-
	// route, relabeled "Branch" in the UI) routes on the captured
	// "amount" Attribute to one of two Configure-authored Decisions --
	// proving routing-vs-terminal in one picture, and a typed value
	// (amount) flowing through outputBindings into the terminal outcome
	// JSON, not just a hardcoded literal.
	const (
		branchTriggerID = "example-branch-trigger"
		branchCaptureID = "example-branch-capture"
		branchRouteID   = "example-branch-route"
		branchApproveID = "example-branch-approve"
		branchDenyID    = "example-branch-deny"
	)
	branchNodes, err := ResolveNodeDefaults([]Node{
		{ID: branchTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: branchCaptureID, NodeTypeID: "capture-attribute", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"attribute": "amount"}},
		{ID: branchRouteID, NodeTypeID: "decision-route", Position: Position{X: 0, Y: 200}},
		{ID: branchApproveID, NodeTypeID: "decision-outcome", Position: Position{X: -120, Y: 300},
			Config: map[string]string{"decisionId": decision.ExampleApproveID, "outputBindings": `{"score":"attr:amount"}`}},
		{ID: branchDenyID, NodeTypeID: "decision-outcome", Position: Position{X: 120, Y: 300},
			Config: map[string]string{"decisionId": decision.ExampleDenyID, "outputBindings": `{"score":"attr:amount"}`}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	// A second Decision seed proving the manual-review park path
	// specifically (ADR-0027's own "nothing new invented" mechanism --
	// the same Review-queue park human-review already uses).
	const decisionReviewTriggerID = "example-decision-review-trigger"
	const decisionReviewOutcomeID = "example-decision-review-outcome"
	decisionReviewNodes, err := ResolveNodeDefaults([]Node{
		{ID: decisionReviewTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: decisionReviewOutcomeID, NodeTypeID: "decision-outcome", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"decisionId": decision.ExampleManualReviewID}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	// MCP tool call (docs/goals/0010 item 5, docs/SPEC.md §3.6): calls
	// the seeded "Example: Reference server (npx)" MCP Server's real
	// "echo" tool -- the exact round trip SPEC.md §3.6 already verified
	// live against the official MCP reference server
	// ({"message":"hello from mill"} -> "Echo: hello from mill"). A
	// real user with Node/npx installed gets a genuinely working
	// example; the committed test suite never spawns it (see
	// mcpserver.BuiltIn's own doc comment -- Go tests use an
	// in-process/in-memory MCP transport instead, e2e only asserts
	// presence/config).
	const (
		mcpTriggerID = "example-mcp-trigger"
		mcpCallID    = "example-mcp-call"
	)
	mcpNodes, err := ResolveNodeDefaults([]Node{
		{ID: mcpTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: mcpCallID, NodeTypeID: "mcp-tool-call", Position: Position{X: 0, Y: 100},
			Config: map[string]string{
				"mcpServerId": mcpserver.ExampleReferenceServerID, "toolName": "echo",
				"argumentsJSON": `{"message":"hello from mill"}`,
			}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	// A disabled filesystem-watch workflow (docs/goals/0010 item 6,
	// mirroring the disabled-schedule seed above): ships with BOTH an
	// empty path and Disabled -- belt and suspenders, since
	// triggerfilesystemwatch.go's own starter already no-ops on an
	// empty path regardless of Disabled -- so it never watches
	// anything on a real machine until a user both points it at a real
	// directory and enables it.
	const (
		fsTriggerID = "example-fswatch-trigger"
		fsInjectID  = "example-fswatch-inject"
	)
	fsNodes, err := ResolveNodeDefaults([]Node{
		{ID: fsTriggerID, NodeTypeID: "trigger-filesystem-watch", Position: Position{X: 0, Y: 0},
			Config: map[string]string{"path": ""}},
		{ID: fsInjectID, NodeTypeID: "process-inject-text", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"text": "the disabled filesystem-watch example fired", "placement": "append"}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	// Code execution (docs/adr/0026, goal 0004b, and the standing
	// seeded-examples principle): SPEC §2.1's core loop -- a command
	// runs locally, guardrailed -- minus the browser bridge, proven
	// with a deterministic literal script rather than a real clipboard
	// capture (ADR-0026's own seed decision: "ships manual-triggered ...
	// keep it minimal + deterministic"). Runs inside the seeded "Safe
	// sandbox" ExecEnv (Configure > Execution Environments); the run
	// parks awaiting approval by default (code-execution's Effect is
	// ClassExternal, same as integration-http) -- approve it from this
	// workflow's own Runs tab. The description points at the one-click
	// hotkey swap SPEC §2.1 actually wants, since a hotkey can't ship
	// pre-bound (no combo is safe to claim on every user's machine) and
	// a clipboard-watch trigger firing on every copy would be
	// obnoxious as a default.
	const (
		codeExecTriggerID = "example-codeexec-trigger"
		codeExecStepID    = "example-codeexec-step"
		codeExecApplyID   = "example-codeexec-apply"
	)
	codeExecNodes, err := ResolveNodeDefaults([]Node{
		{ID: codeExecTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: codeExecStepID, NodeTypeID: "code-execution", Position: Position{X: 0, Y: 100},
			Config: map[string]string{
				"envId": execenv.ExampleSafeSandboxID, "source": "literal",
				"script": `echo "hello from mill"`, "timeoutSeconds": "30",
			}},
		{ID: codeExecApplyID, NodeTypeID: "apply-clipboard-write-text", Position: Position{X: 0, Y: 200}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	workflows := []Workflow{
		{
			ID:          "load-sample-html-workflow",
			Label:       "Load sample HTML",
			Description: "A single-step workflow: puts real HTML on the clipboard.",
			Nodes:       loadSample,
			Edges: []Edge{
				{ID: "load-sample-html-e1", Source: loadSampleTriggerID, Target: "load-sample-html"},
			},
			BuiltIn: true,
		},
		{
			ID:          "clipboard-html-to-markdown-workflow",
			Label:       "Clipboard → Markdown",
			Description: "Capture the clipboard's HTML, convert it to Markdown, write it back.",
			Nodes:       clipboardToMarkdown,
			Edges: []Edge{
				{ID: "clipboard-to-markdown-e0", Source: triggerID, Target: captureID},
				{ID: "clipboard-to-markdown-e1", Source: captureID, Target: processID},
				{ID: "clipboard-to-markdown-e2", Source: processID, Target: applyID},
			},
			BuiltIn: true,
		},
		{
			ID:          ExampleChildWorkflowID,
			Label:       "Example: Echo message (callable child)",
			Description: "Only runnable by another workflow (its trigger is \"callable by another workflow\"). Takes a typed input -- its declared 'message' Attribute -- reads it into the payload, and appends a marker. Ships with v1 PUBLISHED and a deliberately different DRAFT (ADR-0021): callers see v1; the draft's changed text only goes live when you publish it.",
			Nodes:       childDraftNodes,
			Attributes:  []AttributeDef{{Key: "message", Label: "Message", Type: FieldText}},
			Edges: []Edge{
				{ID: "example-child-e0", Source: childTriggerID, Target: childCaptureID},
				{ID: "example-child-e1", Source: childCaptureID, Target: childInjectID},
			},
			BuiltIn:          true,
			PublishedVersion: 1,
			Versions: []WorkflowVersion{{
				Version:     1,
				Label:       "Example: Echo message (callable child)",
				Description: "v1 -- the published snapshot pinned by the parent example.",
				Nodes:       childV1Nodes,
				Attributes:  []AttributeDef{{Key: "message", Label: "Message", Type: FieldText}},
				Edges: []Edge{
					{ID: "example-child-e0", Source: childTriggerID, Target: childCaptureID},
					{ID: "example-child-e1", Source: childCaptureID, Target: childInjectID},
				},
			}},
		},
		{
			ID:          "example-parent-workflow",
			Label:       "Example: Parent → child call",
			Description: "Invokes the callable child with a typed input bound to its 'message' Attribute, PINNED to the child's v1 (ADR-0021) -- the child's newer draft says something different on purpose, and running this proves the pin holds. The child's result becomes this workflow's payload and is also stored into its 'childResult' Attribute (typed output).",
			Nodes:       parentNodes,
			Attributes:  []AttributeDef{{Key: "childResult", Label: "Child result", Type: FieldText}},
			Edges: []Edge{
				{ID: "example-parent-e0", Source: parentTriggerID, Target: parentChildID},
			},
			BuiltIn: true,
		},
		{
			ID:          "example-guarded-http-workflow",
			Label:       "Example: Approval-gated HTTP call",
			Description: "Calls the seeded no-auth httpbin.org integration -- an EXTERNAL-effect step, so running it parks awaiting your approval (docs/SPEC.md §8's fail-safe default: friction is the default, speed is the opt-in). Approve or deny it from this workflow's own Runs tab. To skip the ask for trusted steps, add an allow rule under Configure > Guardrails -- and dry-run the rule there before relying on it.",
			Nodes:       guardedNodes,
			Edges: []Edge{
				{ID: "example-guarded-e0", Source: guardedTriggerID, Target: guardedHTTPID},
			},
			BuiltIn: true,
		},
		{
			ID:          "example-review-workflow",
			Label:       "Example: Human review with input",
			Description: "Pauses in the Review queue (sidebar > Review) for a person: type a note there, approve, and the run resumes with your note as its data -- read into the payload and validated by a ruleset (\"note provided\" must pass). Deny to stop it instead. Human-in-the-loop and ruleset validation demonstrated end to end (docs/adr/0023).",
			Nodes:       reviewNodes,
			Attributes:  []AttributeDef{{Key: "note", Label: "Note", Type: FieldText}},
			Edges: []Edge{
				{ID: "example-review-e0", Source: reviewTriggerID, Target: reviewStepID},
				{ID: "example-review-e1", Source: reviewStepID, Target: reviewCaptureID},
				{ID: "example-review-e2", Source: reviewCaptureID, Target: reviewRulesetID},
			},
			BuiltIn: true,
		},
		{
			ID:          "example-disabled-schedule-workflow",
			Label:       "Example: Disabled schedule",
			Description: "An every-minute schedule that never fires -- it ships DISABLED (ADR-0021's inactive state), so its trigger doesn't even arm. Enable it (the workflow's own toggle) and watch it start appearing in Activity each minute; disable it again to pause production without deleting anything. Test runs work even while disabled.",
			Nodes:       disabledNodes,
			Edges: []Edge{
				{ID: "example-disabled-e0", Source: disabledTriggerID, Target: disabledInjectID},
			},
			BuiltIn:  true,
			Disabled: true,
		},
		{
			ID:          "example-branch-to-decision-workflow",
			Label:       "Example: Branch to a decision",
			Description: "Captures a typed 'amount' Attribute, branches on it (amount > 100), and ends at one of two Configure-authored Decisions -- Approve or Deny -- each a real TERMINAL outcome (docs/adr/0027), not just the end of the node chain. The branch's condition is a Branch node (renamed from routing-only \"Decision\" -- see Configure > Decisions for the terminal outcomes themselves); the captured amount flows typed into the reached Decision's own 'score' output via outputBindings, proving the outcome JSON carries real data, not a hardcoded literal.",
			Nodes:       branchNodes,
			Attributes:  []AttributeDef{{Key: "amount", Label: "Amount", Type: FieldNumber}},
			Edges: []Edge{
				{ID: "example-branch-e0", Source: branchTriggerID, Target: branchCaptureID},
				{ID: "example-branch-e1", Source: branchCaptureID, Target: branchRouteID},
				{ID: "example-branch-e2", Source: branchRouteID, SourceHandle: "amount > 100", Target: branchApproveID},
				{ID: "example-branch-e3", Source: branchRouteID, SourceHandle: otherwiseHandle, Target: branchDenyID},
			},
			BuiltIn: true,
		},
		{
			ID:          "example-decision-with-review-workflow",
			Label:       "Example: Decision with review",
			Description: "Runs straight into the seeded \"Manual review (example)\" Decision (docs/adr/0027) -- a manual-review-category terminal outcome parks the run in the Review queue (sidebar > Review) before it terminalizes, the exact same durable park human-review already uses. Approve there to reach the typed outcome; deny to fail the run closed.",
			Nodes:       decisionReviewNodes,
			Edges: []Edge{
				{ID: "example-decision-review-e0", Source: decisionReviewTriggerID, Target: decisionReviewOutcomeID},
			},
			BuiltIn: true,
		},
		{
			ID:          "example-mcp-echo-workflow",
			Label:       "Example: MCP echo call",
			Description: "Calls the seeded \"Example: Reference server (npx)\" MCP Server's echo tool (docs/SPEC.md §3.6) -- {\"message\":\"hello from mill\"} -> \"Echo: hello from mill\", the real round trip already verified live against the official MCP reference server. Needs Node/npx installed locally to actually run; the committed test suite proves this node's own logic without spawning it.",
			Nodes:       mcpNodes,
			Edges: []Edge{
				{ID: "example-mcp-e0", Source: mcpTriggerID, Target: mcpCallID},
			},
			BuiltIn: true,
		},
		{
			ID:          "example-codeexec-workflow",
			Label:       "Example: Run copied code",
			Description: "Runs a real local command (echo \"hello from mill\") inside the seeded \"Safe sandbox\" execution environment (Configure > Execution Environments), then writes the result to the clipboard -- docs/SPEC.md §2.1's core loop, minus the browser bridge (docs/adr/0026). code-execution is an EXTERNAL-effect step, so running it parks awaiting your approval, same as the guarded HTTP example. Ships manual-triggered so it's safe by default; swap the trigger for a hotkey (canvas Inspector) to get the real one-press capture-and-run loop.",
			Nodes:       codeExecNodes,
			Edges: []Edge{
				{ID: "example-codeexec-e0", Source: codeExecTriggerID, Target: codeExecStepID},
				{ID: "example-codeexec-e1", Source: codeExecStepID, Target: codeExecApplyID},
			},
			BuiltIn: true,
		},
		clipboardInspectorWorkflow(),
		savedPageToMarkdownWorkflow(),
		{
			ID:          "example-disabled-filesystem-watch-workflow",
			Label:       "Example: Disabled filesystem watch",
			Description: "Fires when a file under a watched path is added, changed, or deleted -- ships DISABLED with no path configured (ADR-0021's inactive state, same as \"Example: Disabled schedule\"), so it never watches anything on your machine as shipped. Point its trigger at a real directory (the canvas Inspector), publish, and enable it to see it fire in Activity.",
			Nodes:       fsNodes,
			Edges: []Edge{
				{ID: "example-fswatch-e0", Source: fsTriggerID, Target: fsInjectID},
			},
			BuiltIn:  true,
			Disabled: true,
		},
	}

	// List lookup + List search (docs/goals/0010 item 4, docs/goals/
	// 0011-lists-maturation.md item 4): split into their own file
	// (builtinworkflows_list.go) once this function crossed the
	// 500-line convention -- List was the newest, most self-contained
	// addition (neither seed's nodes are referenced anywhere else in
	// this file), the same "split along a real seam" discipline
	// composition.go's own earlier split already established
	// (.claude/rules/architecture.md).
	workflows = append(workflows, builtInListWorkflows()...)
	// docs/adr/0035: the forward-refactor proof, same split-file reasoning.
	return append(workflows, builtInSystemEventWorkflows()...)
}

// ExampleChildWorkflowID is exported so the parent seed above and any
// test/UI affordance can reference the child without a string literal
// that could drift.
const ExampleChildWorkflowID = "example-child-echo-workflow"
