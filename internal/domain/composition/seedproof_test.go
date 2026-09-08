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
	"clipboard-history-workflow": proven(
		"triggersvc.TestSeededClipboardHistory_TriggeredRunStoresRedactedEntry",
		"triggersvc.TestShouldCaptureClipboardChange_SkipsSelfEcho",
		"triggersvc.TestShouldCaptureClipboardChange_SkipsConcealedContent",
		"triggersvc.TestShouldCaptureClipboardChange_FailSafeOnConcealedCheckError",
		"e2e: clipboard-history.spec.ts",
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
		"e2e: seed-completeness.spec.ts > Search client countries runs a real exact match through list-search",
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
	CodingLoopWorkflowID: proven(
		"composition.TestParseShellCommandBlock",
		"composition.TestProcessShellCommandExec_MultiStepPayload_RunsEachStepAndJoinsOutput",
		"executionsvc.TestSeededCodingLoopExample_Approve_RunsMultiStepCommandAndWritesClipboard",
		"e2e: coding-loop.spec.ts > capture, confirm, run, and copy back the result",
	),
	"update-available-notify-workflow": proven(
		"triggersvc.TestSeededUpdateNotifyExample_UpdateAvailable_RunsToCompletion",
		"manual-only remainder: the real OS banner (apply-notify's signed-bundle class, testing.md)",
	),
	"webhook-notify-workflow": proven(
		"triggersvc.TestSeededWebhookNotifyExample_WebhookPost_NotifiesFromPostedFields",
		"triggersvc.TestSeededWebhookNotifyExample_PostWithoutFields_UsesFallbacks",
		"triggersvc.TestWebhookDispatch_SourceMatching",
		"manual-only remainder: the real OS banner and a paired phone's notification (OS-bound, manual-checks registry)",
	),
	"webhook-respond-workflow": proven(
		"triggersvc.TestWebhookDispatch_RespondingWorkflow_DeliversReply",
		"triggersvc.TestWebhookDispatch_FirstWinsAcrossListeners",
		"triggersvc.TestWebhookDispatch_TerminalWithoutReply_PromptFallback",
		"triggersvc.TestWebhookDispatch_ParkedRun_KeepsWaitingUntilBudget",
		"triggersvc.TestWebhookDispatch_ClientDisconnect_RunsContinue",
		"triggersvc.TestWebhookDispatch_SecondRespondInSameRun_IgnoredWithNote",
		"triggersvc.TestExecRespondWebhook_NoResponder_RecordsNoCallerNote",
		"bridgesvc.TestWebhook_RespondingRun_WritesStatusBodyContentType",
		"bridgesvc.TestWebhook_BudgetElapsed_StandardBodyWithHeader",
		"bridgesvc.TestWebhook_PromptNoReply_StandardBodyNoHeaderNoWait",
	),
	"example-tidy-unused-lists-workflow": proven(
		"triggersvc.TestSeededTidyUnusedListsExample_EntityDereferenced_RunsToCompletion",
		"triggersvc.TestSeededTidyUnusedListsExample_StillReferenced_SkipsNotify",
		"manual-only remainder: the real OS banner (apply-notify's signed-bundle class, testing.md)",
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
	"example-card-intake-workflow": proven(
		"triggersvc.TestSeededCardIntakeExample_TriggerUpdatesOwnCardAndDoesNotLoop",
		"triggersvc.TestSeededCardIntakeKindID_MatchesAtlasSeed",
		"executionsvc.TestGuardrail_AtlasCardCreateParks_ApproveCreatesCard",
		"e2e: seed-completeness.spec.ts > Client request intake workflow is present with the real trigger-atlas-card + Atlas: update card nodes on canvas",
		"e2e: entity-ref-picker.spec.ts > Selecting the Atlas: update card node offers a live Kind picker and the Kind-driven field editor",
	),
	"example-card-create-link-workflow": proven(
		"executionsvc.TestSeededCardCreateLinkExample_CreatesFindsAndLinksCards",
		"e2e: seed-completeness.spec.ts > Log a client request and its decision runs end to end through the real live app",
	),
	"clipbridge-reply-cards-workflow": proven(
		"executionsvc.TestSeededClipbridgeCardsRoute_CreatesAcceptedCards",
		"executionsvc.TestClipbridgePreviewToRouteLoop (the preview-to-route loop over the same seed)",
	),
	"clipbridge-reply-note-workflow": proven(
		"executionsvc.TestSeededClipbridgeNoteRoute_LandsInScratchpad",
	),
	"example-docssync-workflow": proven(
		"executionsvc.TestSeededDocsSyncExample_MirrorsFolderIdempotently",
	),
	"example-ledgersync-workflow": proven(
		"executionsvc.TestSeededLedgerSyncExample_MirrorsFolderIdempotently",
		"executionsvc.TestLedgerSync_ReconcilePreservesOwnerFields",
	),
	"example-list-write-workflow": proven(
		"executionsvc.TestGuardrail_ApplyListRowParks_ApproveWritesRow",
		"executionsvc.TestSeededTaskTrackerExample_PinnedSearch_ResolvesFrozenV1AfterLiveWrite (via the write-path half of the same test)",
	),
	"example-list-pinned-workflow": proven(
		"executionsvc.TestSeededTaskTrackerExample_PinnedSearch_ResolvesFrozenV1AfterLiveWrite",
	),
	"example-filemove-workflow": proven(
		"composition.TestExpandPathTemplate_Filename",
		"composition.TestApplyFileMove_HappyPath_MovesFile",
		"composition.TestApplyFileMove_OnConflictSuffix_CollidesTwice_UsesThirdCandidate",
		"triggersvc.TestSeededFileMoveExample_MovesRealFileIntoTemplatedDestination",
		"triggersvc.TestFileWatchCycleGuard_MoveIntoOwnWatchedFolder_DoesNotReFire",
		"triggersvc.TestFileWatchCycleGuard_DifferentWorkflowWatchingSameFolder_StillFires",
	),
	"backup-mill-data-workflow": proven(
		"composition.TestApplyBackupSnapshot_CallsRegisteredRunnerWithDefaultKeepN",
		"composition.TestApplyBackupSnapshot_CustomKeepNIsPassedThrough",
		"backupsvc.TestBackupService_SnapshotSafeWhileASeededWorkflowRunConcurrentlyExecutes",
		"e2e: settings.spec.ts > Back up now takes a snapshot and updates the last-backup time",
	),
	"example-confluence-to-markdown-workflow": proven(
		"seed: validates + resolves end-to-end; live PAT run is goal 0111's owner acceptance step",
	),
	"example-jira-search-workflow": proven(
		"seed: validates + resolves end-to-end; live PAT run is goal 0111's owner acceptance step",
	),
	"example-jira-issues-sync-workflow": proven(
		"composition.TestSeededJiraIssuesSync_MapsTheSearchResultOntoTheSeededList",
		"configuresvc.TestSyncListRows_UpsertsByKeyAndExpiresTheMissing",
	),
	ExampleSecretGuardWorkflowID: proven(
		"guardrailsvc.TestSeededSecretGuardWorkflow_ParksWithSecretsRuleLabel",
	),
	ExampleBrowserReplayWorkflowID: proven(
		"composition.TestExecBrowserReplay_OverlaysParametersAndExtractsByStep",
		"executionsvc.TestSeededBrowserReplay_RunsTheRecordingAndExtractsTheEcho",
		"e2e: browser-replay.spec.ts",
	),
	ExampleScheduledSecretReadWorkflowID: proven(
		"executionsvc.TestSeededScheduledSecretRead_WaitsForVaultThenCompletes",
	),
	ExampleBrunoRunWorkflowID: proven(
		"composition.TestSeededBrunoRun_MapsTheReportOntoTheSeededList",
		"e2e: bruno-run.spec.ts",
	),
	ExampleSha256ClipboardWorkflowID: proven(
		"composition.TestTransformText_KnownVectors",
		"composition.TestExecuteWorkflow_TransformText_HashesPayloadAndRecordsTheOperation",
		"composition.TestSeededSha256Clipboard_HashesTheClipboardTextEndToEnd",
	),
	"example-todo-scan-workflow": proven(
		"todoscan.TestScan_HitsAcrossTwoFiles",
		"todoscan.TestScan_WholeWordMatchingSkipsTODOS",
		"todoscan.TestScan_SkipsDotDirsAndKnownSkipList",
		"todoscan.TestScan_SkipsBinaryFiles",
		"todoscan.TestScan_MaxFilesStopsTheWalk",
		"composition.TestExecProcessTodoScan_ProducesCSVAndAttributes",
		"composition.TestExecProcessTodoScan_PathResolvesAttrBinding",
		"composition.TestTodoScanNode_ResolvesThroughExecuteWorkflow",
		"e2e: todo-scan.spec.ts",
	),
	"example-run-in-captured-folder-workflow": proven(
		"composition.TestResolveWorkingDirectory_Template_ExpandsAgainstAttributes",
		"composition.TestSeededRunInCapturedFolder_UsesTheFolderAttributeAsCwd",
		"executionsvc.TestGuardrail_ShellStepWorkingDirectory_PreviewedInPendingPayload",
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
