package composition

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/decision"
	"github.com/alicoding/mill/internal/domain/execenv"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/domain/mcpserver"
)

// docs/goals/0010 items 7-9: the enforcement half. "Is everything
// proven?" must become a question CI answers, not one answered
// by clicking through the app. This file is a human-maintained
// registry, not a test-source parser -- deliberately: verifying the
// named test functions actually EXIST would mean parsing Go test
// source at test-run time, which the goal itself rejected as too
// fragile (a refactor renaming a test would silently desync the
// registry's own claim). What this test enforces instead is
// COMPLETENESS: every real seeded artifact has an entry (either named
// proof tests or an explicit ManualOnly reason), and no registry entry
// references an artifact that no longer exists (orphaned after a
// rename/removal). A new seed shipped without updating the matching
// registry below is a red build, with a message naming exactly what to
// add -- that's the actual anti-recurrence mechanism.

// seedProof documents where one seeded artifact's correctness is
// proven -- Tests names real, already-committed test functions
// (informational: see this file's own doc comment for why their
// existence isn't re-verified here); ManualOnly names a real reason
// automation can't cover it (never both, never neither).
type seedProof struct {
	Tests      []string
	ManualOnly string
}

func proven(tests ...string) seedProof   { return seedProof{Tests: tests} }
func manualOnly(reason string) seedProof { return seedProof{ManualOnly: reason} }

// workflowProofRegistry: every composition.BuiltInWorkflows() ID.
var workflowProofRegistry = map[string]seedProof{
	"load-sample-html-workflow": proven(
		"executionsvc.TestRunWorkflow_SummaryHasRealWorkflowLabelAndStepOutput",
		"executionsvc.TestRunWorkflow_SummaryHasNonZeroStartedAt",
		"executionsvc.TestRedriveRun_ReturnsNewRunWithSameStepOutput",
	),
	"clipboard-html-to-markdown-workflow": proven(
		"e2e: composition.spec.ts > Running the clipboard-to-markdown workflow produces a visible response, success or error",
	),
	ExampleChildWorkflowID: proven(
		"executionsvc.TestSeededParentChildExample_TypedInputAndOutput_RunsEndToEnd",
	),
	"example-parent-workflow": proven(
		"executionsvc.TestSeededParentChildExample_TypedInputAndOutput_RunsEndToEnd",
	),
	"example-guarded-http-workflow": proven(
		"executionsvc.TestSeededGuardedHTTPWorkflow_DenyFailsClosed_NoHTTPCall",
		"executionsvc.TestSeededGuardedHTTPWorkflow_ApproveFiresRealHTTPCall",
	),
	"example-review-workflow": proven(
		"executionsvc.TestSeededHumanReviewExample_TypedInputFlowsThrough",
	),
	"example-ai-summarize-workflow": proven(
		"executionsvc.TestSeededAISummarizeExample_RunsEndToEndAgainstFixtureEndpoint",
	),
	"example-ai-classify-branch-workflow": proven(
		"executionsvc.TestSeededAIClassifyBranchExample_UrgentRoutesToUrgentBranch",
		"executionsvc.TestSeededAIClassifyBranchExample_NormalRoutesToNormalBranch",
	),
	"example-disabled-schedule-workflow": proven(
		"executionsvc.TestSeededDisabledScheduleExample_TriggeredRunRejectedWhileDisabled",
		"executionsvc.TestSeededDisabledScheduleExample_TestRunWorks",
		"triggersvc.TestSeededDisabledScheduleExample_EnablingArmsTheSchedule",
	),
	"example-branch-to-decision-workflow": proven(
		"executionsvc.TestSeededBranchToDecisionExample_HighAmount_ApproveOutcome",
		"executionsvc.TestSeededBranchToDecisionExample_LowAmount_DenyOutcome",
		"executionsvc.TestBreakpoint_ParkEditResume_ChangesBranchTaken",
		"executionsvc.TestStepMode_ParksBeforeEveryNode_StepThenContinue",
		"mcpsvc.TestMCPDebugTools_SteppedSessionFullLoop",
		"e2e: breakpoints.spec.ts",
	),
	"example-decision-with-review-workflow": proven(
		"executionsvc.TestSeededDecisionWithReviewExample_Approve_Terminalizes",
		"executionsvc.TestSeededDecisionWithReviewExample_Deny_FailsClosed",
	),
	"example-list-lookup-workflow": proven(
		"executionsvc.TestSeededCountryLookupExample_Match_WritesCountryAttribute",
		"executionsvc.TestSeededCountryLookupExample_NoMatch_FailsClosed",
		"e2e: seed-completeness.spec.ts > Country code lookup",
	),
	"example-list-search-workflow": proven(
		"executionsvc.TestSeededListSearchExample_Match_WritesTypedResult",
		"executionsvc.TestSeededListSearchExample_NoMatch_WritesUnmatchedResult",
		"executionsvc.TestSeededListSearchExample_ExpiredRow_ExcludedByDefault",
		"e2e: seed-completeness.spec.ts > Example: Country lookup (search) runs a real exact match through list-search",
	),
	"example-mcp-echo-workflow": proven(
		"composition.TestSeededMCPExample_EchoToolCall_RunsEndToEnd",
		"e2e: seed-completeness.spec.ts > MCP echo call (presence/config only)",
	),
	"example-disabled-filesystem-watch-workflow": proven(
		"triggersvc.TestSeededDisabledFilesystemWatch_FiresRealWorkflowOnFileCreate",
		"e2e: seed-completeness.spec.ts > Disabled filesystem watch (presence only)",
	),
	"example-clipboard-inspector-workflow": proven(
		"composition.TestFormatClipboardInfo_BothFlavorsPresent",
		"composition.TestFormatClipboardInfo_HTMLAbsent",
		"composition.TestFormatClipboardInfo_NeitherFlavor",
		"composition.TestCaptureClipboardInfo_NodeExec_UsesTheInjectedSeam",
		"e2e: seed-completeness.spec.ts > Clipboard inspector (presence only)",
	),
	"example-saved-page-to-markdown-workflow": proven(
		"triggersvc.TestSeededSavedPageToMarkdown_FiresRealWorkflowAndExtractsMainContent",
		"e2e: seed-completeness.spec.ts > Saved page to Markdown (presence only)",
	),
	"example-scratch-capture-workflow": proven(
		"composition.TestApplyFileWrite_Append_CreatesFile",
		"composition.TestApplyFileWrite_Append_SecondEntryIsBlankLineSeparated",
		"composition.TestApplyFileWrite_Append_TimestampDatetime_PrependsStampLine",
		"composition.TestApplyFileWrite_CreateDirsTrue_CreatesNestedParents",
	),
	"example-codeexec-workflow": proven(
		"executionsvc.TestSeededCodeExecutionExample_Approve_RunsRealCommandAndWritesClipboard",
		"executionsvc.TestSeededCodeExecutionExample_Deny_NeverStartsTheProcess",
		"executionsvc.TestCancelRun_KillsARealRunningProcess",
		"e2e: codeexec.spec.ts > Run copied code (approve path)",
	),
	"example-forward-approvals-workflow": proven(
		"triggersvc.TestSeededForwardApprovalsExample_DecisionParked_PostsRealHTTPCall",
		"triggersvc.TestSystemEvent_LoopRule_SystemEventTriggeredRunEmitsNothing",
		"triggersvc.TestSystemEvent_RunCompleted_FiresForManualAndTriggeredRuns",
		"e2e: seed-completeness.spec.ts > Forward pending approvals (presence/trigger-label only)",
	),
	"example-run-receipt-workflow": proven(
		"composition.TestProcessRunReceipt_RendersEvidenceAsJSON",
		"executionsvc.TestSeededRunReceiptExample_RunsEndToEndAndValidatesAgainstSchema",
	),
	"example-step-failure-workflow": proven(
		"executionsvc.TestStepFailureBreakdown_CountsFailedStepsByNodeType",
		"e2e: activity.spec.ts > step failures show up in Activity's breakdown by step type",
	),
}

// httpRequestProofRegistry: every httprequest.BuiltIn() ID.
var httpRequestProofRegistry = map[string]seedProof{
	httprequest.ExampleNoneID: proven(
		"configuresvc.TestBuiltIn_TypedExamples_DeclareRealFields",
		"configuresvc.TestSeededHTTPRequests_LiveEndpointsRespond (liveness, advisory)",
		"executionsvc.TestSeededGuardedHTTPWorkflow_ApproveFiresRealHTTPCall (via example-guarded-http-workflow)",
	),
	httprequest.ExampleAPIKeyID: proven(
		"configuresvc.TestSeededHTTPRequests_LiveEndpointsRespond (liveness, advisory)",
	),
	httprequest.ExampleBearerID: proven(
		"configuresvc.TestBuiltIn_TypedExamples_DeclareRealFields",
		"configuresvc.TestSeededHTTPRequests_LiveEndpointsRespond (liveness, advisory)",
	),
	httprequest.ExampleHMACID: proven(
		"configuresvc.TestSeededHTTPRequests_LiveEndpointsRespond (liveness, advisory)",
	),
	httprequest.ExampleOAuth1ID: proven(
		"configuresvc.TestConfigureService_FreshInstall_SeedsOAuth1DemoSecret",
		"configuresvc.TestSeededHTTPRequests_LiveEndpointsRespond (liveness, advisory)",
	),
	httprequest.ExampleOAuth2ID: proven(
		"configuresvc.TestConfigureService_FreshInstall_OAuth2Example_HasNoSecretSeeded",
	),
	httprequest.ExampleQueryParamID: proven(
		"configuresvc.TestSeededHTTPRequests_LiveEndpointsRespond (liveness, advisory)",
	),
}

// decisionProofRegistry: every decision.BuiltIn() ID.
var decisionProofRegistry = map[string]seedProof{
	decision.ExampleApproveID: proven(
		"executionsvc.TestSeededBranchToDecisionExample_HighAmount_ApproveOutcome",
		"executionsvc.TestSeededBranchToDecisionExample_PinnedApproveArm_ResolvesFrozenV1AfterLiveEdit",
		"executionsvc.TestSeededBranchToDecisionExample_RunStamp_PinnedVsLive",
	),
	decision.ExampleDenyID: proven(
		"executionsvc.TestSeededBranchToDecisionExample_LowAmount_DenyOutcome",
	),
	decision.ExampleManualReviewID: proven(
		"executionsvc.TestSeededDecisionWithReviewExample_Approve_Terminalizes",
		"executionsvc.TestSeededDecisionWithReviewExample_Deny_FailsClosed",
	),
}

// listProofRegistry: every list.BuiltIn() ID.
var listProofRegistry = map[string]seedProof{
	list.ExampleCountryCodesID: proven(
		"executionsvc.TestSeededCountryLookupExample_Match_WritesCountryAttribute",
		"executionsvc.TestSeededCountryLookupExample_NoMatch_FailsClosed",
		"configuresvc.TestConfigureService_FreshInstall_SeedsBuiltInLists",
	),
}

// mcpServerProofRegistry: every mcpserver.BuiltIn() ID.
var mcpServerProofRegistry = map[string]seedProof{
	mcpserver.ExampleReferenceServerID: proven(
		"composition.TestSeededMCPExample_EchoToolCall_RunsEndToEnd",
		"configuresvc.TestConfigureService_FreshInstall_SeedsBuiltInMCPServers",
	),
}

// execEnvProofRegistry: every execenv.BuiltIn() ID.
var execEnvProofRegistry = map[string]seedProof{
	execenv.ExampleSafeSandboxID: proven(
		"executionsvc.TestSeededCodeExecutionExample_Approve_RunsRealCommandAndWritesClipboard",
		"composition.TestCodeExecution_TempDirSentinel_ResolvesToARealExistingDir",
	),
}

// nodeTypeProofRegistry: every registered NodeType NOT used by any node
// in composition.BuiltInWorkflows() -- the layered-coverage refinement
// (goal 0010 item 9, .claude/rules/testing.md):
// don't force a contrived seed onto a NodeType a different layer
// already proves better. Each entry names its real proof layer/test
// (unit/integration/interaction-e2e) or a ManualOnly reason.
var nodeTypeProofRegistry = map[string]seedProof{
	"trigger-hotkey": manualOnly(
		"OS-level global hotkey delivery needs a live macOS Cocoa run loop -- headless/server-mode CI has none (docs/SPEC.md §1.3: \"HotkeyService cannot be exercised by headless/server-mode CI\"). Persistence/conflict-rejection ARE unit-tested (triggersvc.TestAssignHotkey_RejectsConflict et al.) but the actual hotkey delivery itself stays a documented manual desktop-mode check (.claude/skills/run-mill).",
	),
	"trigger-clipboard-watch": manualOnly(
		"Needs a real macOS pasteboard session -- docs/SPEC.md §1.3: the real clipboard round-trip test is \"skipped specifically in CI, not just on non-macOS -- GitHub's macos-latest runners are headless, no GUI/pasteboard session for osascript either.\" The polling/no-op-on-empty-config mechanism is otherwise identical to trigger-filesystem-watch's already-proven shape.",
	),
	// docs/goals/0031-ai-node-family.md: deliberately unseeded (only
	// ai-completion and ai-classify get a seeded workflow, per the
	// goal's own scope) -- proven at the unit layer instead
	// (.claude/rules/testing.md's "never force the seed pattern onto
	// everything"), covering schema-building, typed-Attribute writing,
	// and the zero-value-on-missing-field fallback.
	"process-ai-extract-structured": proven(
		"composition.TestAIExtractStructuredExec_WritesTypedAttributes",
		"composition.TestAIExtractStructuredExec_MissingFieldGetsZeroValue",
		"composition.TestBuildExtractSchema_EveryFieldRequiredWithMappedType",
	),
}

// checkRegistry is the shared completeness check both halves of this
// file use: every real seed ID must have a non-empty registry entry;
// every registry entry must reference a real, currently-existing seed
// ID (an orphan means the seed was renamed/removed and the registry
// wasn't updated to match).
func checkRegistry(t *testing.T, kind string, realIDs []string, registry map[string]seedProof) {
	t.Helper()
	realSet := make(map[string]bool, len(realIDs))
	for _, id := range realIDs {
		realSet[id] = true
		p, ok := registry[id]
		if !ok {
			t.Errorf("%s %q has no seedProof registry entry -- add one to seedproof_test.go naming its proof tests (proven(...)) or a ManualOnly reason", kind, id)
			continue
		}
		if len(p.Tests) == 0 && p.ManualOnly == "" {
			t.Errorf("%s %q has an EMPTY seedProof entry -- name at least one proof test or a ManualOnly reason", kind, id)
		}
	}
	for id := range registry {
		if !realSet[id] {
			t.Errorf("seedProof registry has an entry for %q, but no such %s currently exists -- remove the stale entry (or the artifact was renamed and the registry key needs updating)", id, kind)
		}
	}
}

func TestSeedProofRegistry_EveryWorkflowProvenOrExempt(t *testing.T) {
	workflows := BuiltInWorkflows()
	ids := make([]string, 0, len(workflows))
	for _, wf := range workflows {
		ids = append(ids, wf.ID)
	}
	checkRegistry(t, "seeded workflow", ids, workflowProofRegistry)
}

func TestSeedProofRegistry_EveryHTTPRequestProvenOrExempt(t *testing.T) {
	requests := httprequest.BuiltIn()
	ids := make([]string, 0, len(requests))
	for _, r := range requests {
		ids = append(ids, r.ID)
	}
	checkRegistry(t, "seeded HTTPRequest", ids, httpRequestProofRegistry)
}

func TestSeedProofRegistry_EveryDecisionProvenOrExempt(t *testing.T) {
	decisions := decision.BuiltIn()
	ids := make([]string, 0, len(decisions))
	for _, d := range decisions {
		ids = append(ids, d.ID)
	}
	checkRegistry(t, "seeded Decision", ids, decisionProofRegistry)
}

func TestSeedProofRegistry_EveryListProvenOrExempt(t *testing.T) {
	lists := list.BuiltIn()
	ids := make([]string, 0, len(lists))
	for _, l := range lists {
		ids = append(ids, l.ID)
	}
	checkRegistry(t, "seeded List", ids, listProofRegistry)
}

func TestSeedProofRegistry_EveryMCPServerProvenOrExempt(t *testing.T) {
	servers := mcpserver.BuiltIn()
	ids := make([]string, 0, len(servers))
	for _, s := range servers {
		ids = append(ids, s.ID)
	}
	checkRegistry(t, "seeded MCP Server", ids, mcpServerProofRegistry)
}

func TestSeedProofRegistry_EveryExecEnvProvenOrExempt(t *testing.T) {
	execEnvs := execenv.BuiltIn()
	ids := make([]string, 0, len(execEnvs))
	for _, e := range execEnvs {
		ids = append(ids, e.ID)
	}
	checkRegistry(t, "seeded ExecEnv", ids, execEnvProofRegistry)
}

// TestNodeTypeProof_EveryNodeTypeProvenOrExempt is item 9's own
// refinement: a NodeType is proven either by appearing in a real
// seeded workflow (the preferred layer, when a runnable example is
// natural) OR by a nodeTypeProofRegistry entry naming a different
// layer/reason. A NodeType that's BOTH seeded AND still carries a
// registry entry is flagged too -- the exemption should be removed
// once a seed exists, not left as dead documentation.
func TestNodeTypeProof_EveryNodeTypeProvenOrExempt(t *testing.T) {
	usedInSeed := map[string]bool{}
	for _, wf := range BuiltInWorkflows() {
		for _, n := range wf.Nodes {
			usedInSeed[n.NodeTypeID] = true
		}
	}

	known := map[string]bool{}
	for _, nt := range NodeTypes() {
		known[nt.ID] = true
		if usedInSeed[nt.ID] {
			continue
		}
		p, ok := nodeTypeProofRegistry[nt.ID]
		if !ok {
			t.Errorf("node type %q is not used by any seeded workflow and has no nodeTypeProofRegistry entry -- add one naming its proof layer (unit/integration/interaction-e2e test) or a ManualOnly reason", nt.ID)
			continue
		}
		if len(p.Tests) == 0 && p.ManualOnly == "" {
			t.Errorf("node type %q has an EMPTY nodeTypeProofRegistry entry -- name at least one proof test or a ManualOnly reason", nt.ID)
		}
	}

	for id := range nodeTypeProofRegistry {
		if !known[id] {
			t.Errorf("nodeTypeProofRegistry entry %q does not match any registered NodeType -- remove it (the type was renamed or removed)", id)
			continue
		}
		if usedInSeed[id] {
			t.Errorf("nodeTypeProofRegistry entry %q is now used by a seeded workflow -- remove the exemption, seeds are the preferred proof layer once one exists", id)
		}
	}
}
