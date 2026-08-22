package mcpaudit

import "strings"

// SkipMethod reports whether method is transport/session bookkeeping
// (the initialize handshake, SEP-2575 capability discovery, keep-alive
// pings) rather than a real, client-observable call -- these fire on
// EVERY connection open (the agent loop opens a fresh in-memory session
// per goal, mcpclient.CallTool opens a fresh stdio session per call)
// and would otherwise flood the audit trail's 10k-row retention window
// with handshake noise nobody asked to observe. Every notification
// (fire-and-forget, no result) is skipped too, same check the SDK's own
// sending-method-handler uses to decide whether a call expects a reply.
func SkipMethod(method string) bool {
	if strings.HasPrefix(method, "notifications/") {
		return true
	}
	switch method {
	case "initialize", "server/discover", "ping":
		return true
	}
	return false
}
