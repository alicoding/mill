package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// fakeMCPServer answers tools/call the same way Wails3's own MCP bridge
// does (mcpToolResult/mcpToolError, mcp_protocol_enabled.go) -- pure
// protocol-shape testing, no real desktop app needed.
func fakeMCPServer(t *testing.T, respond func(name string, args map[string]any) jsonrpcResponse) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Params struct {
				Name      string         `json:"name"`
				Arguments map[string]any `json:"arguments"`
			} `json:"params"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		resp := respond(req.Params.Name, req.Params.Arguments)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
}

func newTestClient(t *testing.T, srv *httptest.Server) *mcpClient {
	t.Helper()
	c := newMCPClient("127.0.0.1", 0)
	c.endpoint = srv.URL
	return c
}

func TestCall_SuccessResult_ReturnsContentText(t *testing.T) {
	srv := fakeMCPServer(t, func(name string, args map[string]any) jsonrpcResponse {
		return jsonrpcResponse{Result: &toolCallResult{
			Content: []struct {
				Text string `json:"text"`
			}{{Text: `{"ok":true}`}},
		}}
	})
	defer srv.Close()

	text, err := newTestClient(t, srv).call("app_info", map[string]any{})
	if err != nil {
		t.Fatalf("call: %v", err)
	}
	if text != `{"ok":true}` {
		t.Fatalf("got %q", text)
	}
}

func TestCall_IsErrorResult_ReturnsPlainError(t *testing.T) {
	srv := fakeMCPServer(t, func(name string, args map[string]any) jsonrpcResponse {
		return jsonrpcResponse{Result: &toolCallResult{
			IsError: true,
			Content: []struct {
				Text string `json:"text"`
			}{{Text: "element not found"}},
		}}
	})
	defer srv.Close()

	_, err := newTestClient(t, srv).call("js_eval", map[string]any{})
	if err == nil {
		t.Fatal("expected an error, got nil")
	}
}

func TestCall_UnknownTool_ReturnsBridgeGapError(t *testing.T) {
	srv := fakeMCPServer(t, func(name string, args map[string]any) jsonrpcResponse {
		return jsonrpcResponse{Error: &jsonrpcError{Code: -32602, Message: "unknown tool: not_a_real_tool"}}
	})
	defer srv.Close()

	_, err := newTestClient(t, srv).call("not_a_real_tool", map[string]any{})
	var gap *bridgeGapError
	if !asBridgeGapError(err, &gap) {
		t.Fatalf("expected a *bridgeGapError, got %T: %v", err, err)
	}
	if gap.tool != "not_a_real_tool" {
		t.Fatalf("got tool %q", gap.tool)
	}
}

func TestCall_OtherRPCError_ReturnsPlainError(t *testing.T) {
	srv := fakeMCPServer(t, func(name string, args map[string]any) jsonrpcResponse {
		return jsonrpcResponse{Error: &jsonrpcError{Code: -32603, Message: "internal error"}}
	})
	defer srv.Close()

	_, err := newTestClient(t, srv).call("app_info", map[string]any{})
	var gap *bridgeGapError
	if asBridgeGapError(err, &gap) {
		t.Fatal("a generic internal error must not be misclassified as a bridge gap")
	}
	if err == nil {
		t.Fatal("expected an error")
	}
}

func TestCallJSON_DecodesResultIntoOut(t *testing.T) {
	srv := fakeMCPServer(t, func(name string, args map[string]any) jsonrpcResponse {
		return jsonrpcResponse{Result: &toolCallResult{
			Content: []struct {
				Text string `json:"text"`
			}{{Text: `{"os":"darwin"}`}},
		}}
	})
	defer srv.Close()

	var out struct {
		OS string `json:"os"`
	}
	if err := newTestClient(t, srv).callJSON("app_info", map[string]any{}, &out); err != nil {
		t.Fatalf("callJSON: %v", err)
	}
	if out.OS != "darwin" {
		t.Fatalf("got %q", out.OS)
	}
}
