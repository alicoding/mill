package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// mcpCaller is the seam checks.go's registry depends on instead of the
// concrete *mcpClient -- lets checks_test.go exercise every check's
// assertion logic against a scripted fake, with no real HTTP server or
// desktop app involved.
type mcpCaller interface {
	call(tool string, args map[string]any) (string, error)
	callJSON(tool string, args map[string]any, out any) error
}

// mcpClient is a minimal JSON-RPC 2.0 client for the Wails MCP bridge
// (-tags mcp, WAILS_MCP_HOST/WAILS_MCP_PORT -- see
// .claude/skills/run-mill/SKILL.md's spike notes and
// github.com/wailsapp/wails/v3/pkg/application/mcp_protocol_enabled.go).
// The server is stateless (its own DELETE handler is a no-op), so a
// bare "tools/call" works with no prior "initialize" handshake -- this
// client only ever sends that one method.
type mcpClient struct {
	endpoint string
	http     *http.Client
	nextID   int
}

func newMCPClient(host string, port int) *mcpClient {
	return &mcpClient{
		endpoint: fmt.Sprintf("http://%s:%d/mcp", host, port),
		http:     &http.Client{Timeout: 30 * time.Second},
	}
}

type jsonrpcRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      int    `json:"id"`
	Method  string `json:"method"`
	Params  any    `json:"params"`
}

type jsonrpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type jsonrpcResponse struct {
	Result *toolCallResult `json:"result"`
	Error  *jsonrpcError   `json:"error"`
}

type toolCallResult struct {
	Content []struct {
		Text string `json:"text"`
	} `json:"content"`
	IsError bool `json:"isError"`
}

// bridgeGapError marks a JSON-RPC "unknown tool" response specifically --
// the caller must treat this as a hard stop (the bridge API itself
// can't do the check), never retry or substitute a different tool.
type bridgeGapError struct {
	tool    string
	message string
}

func (e *bridgeGapError) Error() string {
	return fmt.Sprintf("bridge does not support tool %q: %s", e.tool, e.message)
}

// call invokes one MCP tool and returns its result content as raw text
// (JSON-encoded for non-string return values, per the server's own
// mcpToolResult -- see the reference above). A tool that ran but
// reported isError:true surfaces as a plain error carrying its
// message; an unknown-tool JSON-RPC error surfaces as *bridgeGapError.
func (c *mcpClient) call(tool string, args map[string]any) (string, error) {
	c.nextID++
	req := jsonrpcRequest{
		JSONRPC: "2.0",
		ID:      c.nextID,
		Method:  "tools/call",
		Params:  map[string]any{"name": tool, "arguments": args},
	}
	body, err := json.Marshal(req)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}
	httpReq, err := http.NewRequestWithContext(context.Background(), http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("post %s: %w", c.endpoint, err)
	}
	defer func() { _ = resp.Body.Close() }()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}
	var rpc jsonrpcResponse
	if err := json.Unmarshal(respBody, &rpc); err != nil {
		return "", fmt.Errorf("decode response %q: %w", string(respBody), err)
	}
	if rpc.Error != nil {
		if rpc.Error.Code == -32602 && len(rpc.Error.Message) >= 12 && rpc.Error.Message[:12] == "unknown tool" {
			return "", &bridgeGapError{tool: tool, message: rpc.Error.Message}
		}
		return "", fmt.Errorf("tool %s: rpc error %d: %s", tool, rpc.Error.Code, rpc.Error.Message)
	}
	if rpc.Result == nil || len(rpc.Result.Content) == 0 {
		return "", fmt.Errorf("tool %s: empty result", tool)
	}
	text := rpc.Result.Content[0].Text
	if rpc.Result.IsError {
		return "", fmt.Errorf("tool %s reported an error: %s", tool, text)
	}
	return text, nil
}

// callJSON is call() plus unmarshaling the returned text into out --
// the common case for every check below, which all want a structured
// value back rather than raw text.
func (c *mcpClient) callJSON(tool string, args map[string]any, out any) error {
	text, err := c.call(tool, args)
	if err != nil {
		return err
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal([]byte(text), out); err != nil {
		return fmt.Errorf("tool %s: decode result %q: %w", tool, text, err)
	}
	return nil
}
