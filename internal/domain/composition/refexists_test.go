package composition

import "testing"

// RefExists is the yes/no wrapper docs/goals/0039's dangling-reference
// preview needs around the same lookup seams execution already uses
// (lookupHTTPRequestFn et al.) -- these tests wire/unwire those package
// vars directly, the same seam-testing pattern mcpcall_seed_test.go and
// listlookup_test.go already establish (SetXLookup is a bare package
// var with no test-only reset hook, so every test restores it itself).

func TestRefExists_EmptyID_AlwaysTrue(t *testing.T) {
	for _, kind := range []string{"request", "list", "mcpserver", "decision", "execenv", "workflow", "bogus-kind"} {
		if !RefExists(kind, "") {
			t.Errorf("RefExists(%q, \"\") = false, want true (an empty value is 'not configured', not dangling)", kind)
		}
	}
}

func TestRefExists_Request(t *testing.T) {
	prev := lookupHTTPRequestFn
	t.Cleanup(func() { lookupHTTPRequestFn = prev })

	lookupHTTPRequestFn = func(id string) (ResolvedHTTPRequest, error) {
		if id == "known" {
			return ResolvedHTTPRequest{}, nil
		}
		return ResolvedHTTPRequest{}, errNotFoundStub
	}
	if !RefExists("request", "known") {
		t.Error("RefExists(request, known) = false, want true")
	}
	if RefExists("request", "unknown") {
		t.Error("RefExists(request, unknown) = true, want false")
	}
}

func TestRefExists_List(t *testing.T) {
	prev := lookupListFn
	t.Cleanup(func() { lookupListFn = prev })

	lookupListFn = func(id string) (ResolvedList, error) {
		if id == "known" {
			return ResolvedList{}, nil
		}
		return ResolvedList{}, errNotFoundStub
	}
	if !RefExists("list", "known") {
		t.Error("RefExists(list, known) = false, want true")
	}
	if RefExists("list", "unknown") {
		t.Error("RefExists(list, unknown) = true, want false")
	}
}

func TestRefExists_MCPServer(t *testing.T) {
	prev := lookupMCPServerFn
	t.Cleanup(func() { lookupMCPServerFn = prev })

	lookupMCPServerFn = func(id string) (ResolvedMCPServer, error) {
		if id == "known" {
			return ResolvedMCPServer{}, nil
		}
		return ResolvedMCPServer{}, errNotFoundStub
	}
	if !RefExists("mcpserver", "known") {
		t.Error("RefExists(mcpserver, known) = false, want true")
	}
	if RefExists("mcpserver", "unknown") {
		t.Error("RefExists(mcpserver, unknown) = true, want false")
	}
}

func TestRefExists_Decision(t *testing.T) {
	prev := lookupDecisionFn
	t.Cleanup(func() { lookupDecisionFn = prev })

	lookupDecisionFn = func(id string, _ int) (ResolvedDecision, error) {
		if id == "known" {
			return ResolvedDecision{}, nil
		}
		return ResolvedDecision{}, errNotFoundStub
	}
	if !RefExists("decision", "known") {
		t.Error("RefExists(decision, known) = false, want true")
	}
	if RefExists("decision", "unknown") {
		t.Error("RefExists(decision, unknown) = true, want false")
	}
}

func TestRefExists_ExecEnv(t *testing.T) {
	prev := lookupExecEnvFn
	t.Cleanup(func() { lookupExecEnvFn = prev })

	lookupExecEnvFn = func(id string) (ResolvedExecEnv, error) {
		if id == "known" {
			return ResolvedExecEnv{}, nil
		}
		return ResolvedExecEnv{}, errNotFoundStub
	}
	if !RefExists("execenv", "known") {
		t.Error("RefExists(execenv, known) = false, want true")
	}
	if RefExists("execenv", "unknown") {
		t.Error("RefExists(execenv, unknown) = true, want false")
	}
}

// "workflow"/"workflow-scope" (and any future/unrecognized RefKind) are
// deliberately unflagged by RefExists itself -- see its own doc
// comment for why (compositionsvc owns the workflow list, not this
// package).
func TestRefExists_WorkflowAndUnknownKinds_AlwaysTrue(t *testing.T) {
	for _, kind := range []string{"workflow", "workflow-scope", "some-future-kind"} {
		if !RefExists(kind, "anything") {
			t.Errorf("RefExists(%q, \"anything\") = false, want true (not this package's job to check)", kind)
		}
	}
}

type notFoundError struct{}

func (notFoundError) Error() string { return "not found" }

var errNotFoundStub error = notFoundError{}
