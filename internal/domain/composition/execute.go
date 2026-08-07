package composition

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/alicoding/mill/internal/adapters/clipboard"
	"github.com/alicoding/mill/internal/adapters/httpconnector"
	"github.com/alicoding/mill/internal/adapters/markdown"
	"github.com/alicoding/mill/internal/adapters/mcpclient"
)

// Package-level function vars, not direct calls -- same testability
// pattern as internal/domain/runbook.
var (
	readClipboardHTML  = clipboard.ReadHTML
	writeClipboardHTML = clipboard.WriteHTML
	writeClipboardText = clipboard.WriteText
	htmlToMarkdown     = markdown.ToMarkdown
)

// nodeExec threads ExecContext from node to node -- Payload is the
// single-string artifact every Capture/Process/Apply node has always
// read/written (unchanged in shape here, just wrapped); Attributes is
// the new structured bag Decision rules evaluate against (see
// ExecContext's own doc comment for why it's a separate field, not a
// Payload restructuring).
var nodeExec = map[string]func(node Node, ctx ExecContext) (ExecContext, error){
	"capture-clipboard-html": func(_ Node, ctx ExecContext) (ExecContext, error) {
		html, err := readClipboardHTML()
		if err != nil {
			return ctx, err
		}
		ctx.Payload = html
		return ctx, nil
	},
	"process-html-to-markdown": func(_ Node, ctx ExecContext) (ExecContext, error) {
		md, err := htmlToMarkdown(ctx.Payload)
		if err != nil {
			return ctx, err
		}
		ctx.Payload = md
		return ctx, nil
	},
	"apply-clipboard-write-text": func(_ Node, ctx ExecContext) (ExecContext, error) {
		if err := writeClipboardText(ctx.Payload); err != nil {
			return ctx, err
		}
		return ctx, nil
	},
	"apply-clipboard-write-html": func(node Node, ctx ExecContext) (ExecContext, error) {
		html := node.Config["html"]
		if err := writeClipboardHTML(html); err != nil {
			return ctx, err
		}
		ctx.Payload = html
		return ctx, nil
	},
	"integration-http": func(node Node, ctx ExecContext) (ExecContext, error) {
		rc, err := lookupConnectorFn(node.Config["connectorId"])
		if err != nil {
			return ctx, fmt.Errorf("integration-http: %w", err)
		}

		headers := make(map[string]string, len(rc.Headers)+1)
		for k, v := range rc.Headers {
			headers[k] = v
		}
		if k, v := authHeader(rc); k != "" {
			headers[k] = v
		}

		resp, err := httpconnector.Execute(httpconnector.Request{
			Method:  node.Config["method"],
			URL:     strings.TrimRight(rc.BaseURL, "/") + node.Config["path"],
			Headers: headers,
			Body:    node.Config["bodyTemplate"],
		})
		if err != nil {
			return ctx, fmt.Errorf("integration-http: %w", err)
		}
		ctx.Payload = resp.Body
		return ctx, nil
	},
	"list-lookup": func(node Node, ctx ExecContext) (ExecContext, error) {
		rl, err := lookupListFn(node.Config["listId"])
		if err != nil {
			return ctx, fmt.Errorf("list-lookup: %w", err)
		}

		inputVal := fmt.Sprintf("%v", ctx.Attributes[node.Config["inputKey"]])
		matched, ok := rl.Entries[inputVal]
		if !ok {
			return ctx, fmt.Errorf("list-lookup: no entry for %q", inputVal)
		}
		ctx.Attributes[node.Config["outputKey"]] = matched
		return ctx, nil
	},
	"mcp-tool-call": func(node Node, ctx ExecContext) (ExecContext, error) {
		rs, err := lookupMCPServerFn(node.Config["mcpServerId"])
		if err != nil {
			return ctx, fmt.Errorf("mcp-tool-call: %w", err)
		}

		var arguments map[string]any
		if raw := node.Config["argumentsJSON"]; raw != "" {
			if err := json.Unmarshal([]byte(raw), &arguments); err != nil {
				return ctx, fmt.Errorf("mcp-tool-call: invalid argumentsJSON: %w", err)
			}
		}

		result, err := mcpclient.CallTool(rs.Command, rs.Args, node.Config["toolName"], arguments)
		if err != nil {
			return ctx, fmt.Errorf("mcp-tool-call: %w", err)
		}
		ctx.Payload = result
		return ctx, nil
	},
}

// ExecuteWorkflow runs a fully-resolved node graph, following Decision
// nodes' conditional edges (walk/nextNode) instead of a flat ordered
// list. Errors here are plain/technical, not hand-tuned soft-failure
// copy (e.g. "no HTML found on the clipboard" with a nil error) -- a
// deliberate prototype simplification carried over from before Runbook's
// retirement, not yet revisited.
//
// attrs seeds ctx.Attributes via attributesEnv's zero-valued defaults --
// the same interim behavior ValidateGraph's own save-time type-checking
// already relies on. There is no manual-test-run UI yet to supply real
// values (SPEC.md §3.5's Attributes CRUD, still future work), so every
// Decision edge referencing a declared Attribute evaluates against its
// type's zero value until one exists; a workflow with no Attributes
// (both built-ins today) behaves exactly as before this parameter
// existed.
func ExecuteWorkflow(nodes []Node, edges []Edge, attrs []AttributeDef) (string, error) {
	if len(nodes) == 0 {
		return "", fmt.Errorf("a workflow needs at least one node")
	}

	byID, outgoingEdges, hasIncoming, err := buildGraph(nodes, edges)
	if err != nil {
		return "", err
	}
	root, err := findRoot(nodes, hasIncoming)
	if err != nil {
		return "", err
	}

	ctx := ExecContext{Attributes: attributesEnv(attrs)}
	visited := make(map[string]bool, len(nodes))
	current := root
	for {
		if visited[current] {
			return "", fmt.Errorf("workflow graph contains a cycle")
		}
		visited[current] = true

		node := byID[current]
		// Trigger and Decision nodes carry no payload transformation --
		// Trigger marks the entry point, Decision is a pure routing
		// point whose only job is picking the next edge (nextNode,
		// below); nodeExec has no entries for either by design (see
		// NodeTypes' Trigger and decision-route comments).
		if node.Kind != KindTrigger && node.Kind != KindDecision {
			exec, ok := nodeExec[node.NodeTypeID]
			if !ok {
				return "", fmt.Errorf("unknown node type: %s", node.NodeTypeID)
			}
			ctx, err = exec(node, ctx)
			if err != nil {
				return "", fmt.Errorf("node %s: %w", node.NodeTypeID, err)
			}
		}

		next, err := nextNode(node, outgoingEdges[node.ID], ctx)
		if err != nil {
			return "", err
		}
		if next == "" {
			break
		}
		current = next
	}

	return ctx.Payload, nil
}
