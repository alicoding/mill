package mcpsvc

// docs/goals/0026 item 1: cancel_write is the missing fourth verb
// (park/poll/resolve/WITHDRAW) -- the requesting client withdraws its
// OWN still-pending write, ungated, a DISTINCT outcome from denied. In
// its own file (not millmcpservice_approval_test.go, which is already
// at the 500-line convention) but reusing that file's
// mcpApprovalHarness/awaitPending helpers verbatim -- same package,
// same shared setup every park-and-poll test needs.

import (
	"encoding/json"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Proven end to end via a real MCP client, the same shape
// TestMCPWriteTools_PerWriteApproval already uses: park an import,
// cancel it via cancel_write, confirm the original call errors out
// (never gets the write it asked for), nothing was written,
// check_write_status reports "cancelled" (not "denied"), the pending
// queue (the same data ReviewView/MCPWriteApprovals/the sidebar badge
// all read) drops to zero, and a second cancel of the same id errors
// (at-most-once).
func TestMCPWriteTools_CancelWrite_WithdrawsOwnPendingWrite(t *testing.T) {
	h := newMCPApprovalHarness(t, "127.0.0.1:18095", "Cancel write test workflow")

	done := h.callImport(t)
	pending := h.awaitPending(t)

	cancelRes, err := h.session.CallTool(h.ctx, &mcp.CallToolParams{Name: "cancel_write", Arguments: map[string]any{"id": pending.ID}})
	if err != nil || cancelRes.IsError {
		t.Fatalf("cancel_write: err=%v res=%+v", err, cancelRes)
	}

	// The original import call must resolve as an error result (it
	// never gets the write it asked for), not hang or silently succeed.
	out := <-done
	if out.err != nil {
		t.Fatalf("CallTool transport error: %v", out.err)
	}
	if !out.res.IsError {
		t.Fatal("a cancelled import must return an error result to the original caller")
	}
	if len(h.comp.Workflows()) != h.before {
		t.Fatal("a cancelled write must write nothing")
	}

	statusRes, err := h.session.CallTool(h.ctx, &mcp.CallToolParams{Name: "check_write_status", Arguments: map[string]any{"id": pending.ID}})
	if err != nil || statusRes.IsError {
		t.Fatalf("check_write_status: err=%v res=%+v", err, statusRes)
	}
	var status checkWriteStatusResult
	if err := json.Unmarshal([]byte(statusRes.Content[0].(*mcp.TextContent).Text), &status); err != nil {
		t.Fatalf("check_write_status result is not the typed JSON: %v", err)
	}
	if status.Status != string(MCPWriteStatusCancelled) {
		t.Fatalf("status = %+v, want cancelled (distinct from denied)", status)
	}

	if got := h.svc.PendingMCPWrites(); len(got) != 0 {
		t.Fatalf("PendingMCPWrites after cancel = %+v, want empty (the same data Review/the sidebar badge read)", got)
	}

	// At-most-once: cancelling an already-resolved write a second time
	// must error, not silently no-op or re-signal anything.
	secondCancel, err := h.session.CallTool(h.ctx, &mcp.CallToolParams{Name: "cancel_write", Arguments: map[string]any{"id": pending.ID}})
	if err != nil {
		t.Fatalf("second cancel_write transport error: %v", err)
	}
	if !secondCancel.IsError {
		t.Fatal("cancelling an already-resolved write a second time must error")
	}
}

// Cancelling something that was never pending in the first place (a
// bogus/expired id) errors cleanly rather than panicking or
// succeeding -- the "no such write" branch CancelMCPWrite shares with
// ResolveMCPWrite.
func TestMCPWriteTools_CancelWrite_UnknownID_Errors(t *testing.T) {
	h := newMCPApprovalHarness(t, "127.0.0.1:18096", "Cancel write unknown-id workflow")

	res, err := h.session.CallTool(h.ctx, &mcp.CallToolParams{Name: "cancel_write", Arguments: map[string]any{"id": "does-not-exist"}})
	if err != nil {
		t.Fatalf("cancel_write transport error: %v", err)
	}
	if !res.IsError {
		t.Fatal("cancel_write on an unknown id must return an error result")
	}
}
