package mcpaudit

import "github.com/modelcontextprotocol/go-sdk/mcp"

// ContentText concatenates every TextContent block in content, no
// separator -- CallTool results are conventionally one such block, but
// this stays defensive against more than one. Mirrors (and, in
// agentloopsvc's case, replaces) agentloopsvc's own former resultText;
// deliberately NOT used by mcpclient's own contentText, which
// newline-joins as part of CallTool's established external contract
// ("every text content part... newline-joined") -- a different,
// deliberate join style this package must not silently change.
func ContentText(content []mcp.Content) string {
	var out string
	for _, c := range content {
		if tc, ok := c.(*mcp.TextContent); ok {
			out += tc.Text
		}
	}
	return out
}
