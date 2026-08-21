package mcpsvc

import (
	"encoding/json"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Regression (goal 0130 dogfood finding b): atlas_propose_kind_write's
// own description points pollers at atlas_get_write_status, so an
// approved kind write's payload (kindId) must survive that typed poll
// -- it used to unmarshal cardId only and silently drop the kind
// result.
func TestAtlasMCP_KindWrite_StatusPollCarriesKindID(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18103")
	h.enableWrites(t)

	done := make(chan struct {
		res *mcp.CallToolResult
		err error
	}, 1)
	go func() {
		res, err := h.session.CallTool(h.ctx, &mcp.CallToolParams{
			Name:      "atlas_propose_kind_write",
			Arguments: map[string]any{"label": "MCP status kind"},
		})
		done <- struct {
			res *mcp.CallToolResult
			err error
		}{res, err}
	}()

	pending := h.awaitPending(t)
	if err := h.svc.ResolveMCPWrite(pending.ID, true); err != nil {
		t.Fatalf("ResolveMCPWrite(approve): %v", err)
	}
	out := <-done
	if out.err != nil || out.res.IsError {
		t.Fatalf("approved atlas_propose_kind_write failed: err=%v res=%+v", out.err, out.res)
	}
	createdKindID := h.kindIDByLabel(t, "MCP status kind")

	statusText := h.call(t, "atlas_get_write_status", map[string]any{"id": pending.ID})
	var status atlasWriteStatusResult
	if err := json.Unmarshal([]byte(statusText), &status); err != nil {
		t.Fatalf("atlas_get_write_status result is not the typed JSON: %v", err)
	}
	if status.Status != string(MCPWriteStatusApproved) || status.KindID != createdKindID {
		t.Errorf("atlas_get_write_status = %+v, want approved with kindId %q", status, createdKindID)
	}
}
