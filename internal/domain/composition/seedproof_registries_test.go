package composition

import (
	"github.com/alicoding/mill/internal/domain/decision"
	"github.com/alicoding/mill/internal/domain/execenv"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/domain/mcpserver"
)

// The non-workflow seed-proof registries, split from seedproof_test.go
// (the 500-line cap): every domain's BuiltIn() seed list plus the
// node-type layered-coverage registry. seedProof, proven/manualOnly and
// the checkRegistry gate they feed all live in seedproof_test.go.

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
	httprequest.ExampleEnvironmentID: proven(
		"composition.TestInterpolate_SubstitutesWhitespaceToleratesAndEscapes",
		"configuresvc.TestEnvironmentVarGap_SeededRequestResolvesOnlyInSandbox",
		"executionsvc.TestSeededGuardedHTTPWorkflow_ApproveFiresRealHTTPCall (via example-guarded-http-workflow)",
		"e2e: configure-environments.spec.ts",
	),
	httprequest.ExampleQueryParamID: proven(
		"configuresvc.TestSeededHTTPRequests_LiveEndpointsRespond (liveness, advisory)",
	),
	httprequest.ExampleConfluencePageReadID: proven(
		"seed: validates + resolves end-to-end; live PAT run is goal 0111's owner acceptance step",
	),
	httprequest.ExampleJiraSearchID: proven(
		"seed: validates + resolves end-to-end; live PAT run is goal 0111's owner acceptance step",
	),
	httprequest.ExampleTrackedItemsID: proven(
		"composition.TestExecuteOperation_SharesAuthAndURLJoinWithIntegrationHTTP",
		"composition.TestExecuteOperation_PathParamAndBody",
		"pluginsvc.TestPerformGuardedActionForPlugin_Allow_PerformsAndAudits (the same two operations this seed declares)",
		"e2e: runtime-plugin-live-view.spec.ts (against a local stub server, never a real vendor)",
	),
	httprequest.ExampleSourceSecretID: proven(
		"secretsvc.TestResolveSecretValue_UnresolvedVsUnreadableVsResolved",
		"configuresvc.TestRequestSecretUnresolved_NamesTheGoneKeyOnlyWhenTheSourceStillExists",
		"e2e: secret-references.spec.ts",
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
	list.ExampleBrunoResultsID: proven(
		"composition.TestSeededBrunoRun_MapsTheReportOntoTheSeededList",
	),
	list.ExampleJiraIssuesID: proven(
		"composition.TestSeededJiraIssuesSync_MapsTheSearchResultOntoTheSeededList",
		"configuresvc.TestSyncListRows_UpsertsByKeyAndExpiresTheMissing",
	),
	list.ExampleTaskTrackerID: proven(
		"executionsvc.TestGuardrail_ApplyListRowParks_ApproveWritesRow",
		"executionsvc.TestSeededTaskTrackerExample_PinnedSearch_ResolvesFrozenV1AfterLiveWrite",
		"configuresvc.TestApplyListRow_CreatesThenUpdatesByKeyColumn",
	),
	list.ExampleUnusedListID: proven(
		"configuresvc.TestListUsageSummary_ReportsCountsPerList",
		"e2e: configure-lists-usage.spec.ts",
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
	execenv.ExampleSecretGuardID: proven(
		"guardrailsvc.TestSeededSecretGuardWorkflow_ParksWithSecretsRuleLabel",
	),
}

// nodeTypeProofRegistry: every registered NodeType NOT used by any node
// in composition.BuiltInWorkflows() -- the layered-coverage refinement
// (goal 0010 item 9, .claude/rules/testing.md):
// don't force a contrived seed onto a NodeType a different layer
// already proves better. Each entry names its real proof layer/test
// (unit/integration/interaction-e2e) or a ManualOnly reason.
var nodeTypeProofRegistry = map[string]seedProof{
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
