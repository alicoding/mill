package mcpauditsvc

import (
	"context"
	"encoding/json"
	"time"

	"github.com/alicoding/mill/internal/adapters/mcpaudit"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// ServerMiddleware returns the mcp.Middleware wired via
// AddReceivingMiddleware on Mill's own MCP server (mcpserving) --
// records EVERY method an external client (or Mill's own agent loop,
// connecting to this same server as just another client, no special
// path) calls, direction=server. This is also where a gated write
// tool's park-and-poll outcome (docs/adr/0032) gets its interim
// OutcomeParked row -- ResolveParkedWrite mutates it later, once the
// human (or the 24h sweep) actually decides.
//
//wails:ignore
func (s *MCPAuditService) ServerMiddleware() mcp.Middleware {
	return func(next mcp.MethodHandler) mcp.MethodHandler {
		return func(ctx context.Context, method string, req mcp.Request) (mcp.Result, error) {
			if mcpaudit.SkipMethod(method) {
				return next(ctx, method, req)
			}

			start := time.Now()
			result, err := next(ctx, method, req)

			rec := buildServerRecord(method, req, result, err, time.Since(start))
			if _, insErr := s.store.Insert(ctx, rec); insErr != nil {
				s.log.Error("mcp audit: record server call", "error", insErr, "method", method)
			}
			return result, err
		}
	}
}

// buildServerRecord assembles one server-received call's audit row --
// split from ServerMiddleware's own closure purely to keep cognitive
// complexity under the repo's gate (each helper below stays a single,
// small conditional).
func buildServerRecord(method string, req mcp.Request, result mcp.Result, err error, duration time.Duration) mcpaudit.Record {
	rec := mcpaudit.Record{Direction: mcpaudit.DirectionServer, MethodName: method, DurationMS: duration.Milliseconds()}
	fillServerSession(&rec, req)
	fillServerToolCallParams(&rec, method, req)
	deriveServerOutcome(&rec, result, err)
	return rec
}

// fillServerSession sets SessionID/CallerIdentity from the connecting
// client's own initialize handshake (ClientInfo.Name/Version) -- the
// "server side: initialize's client name/version" half of the design
// contract's CallerIdentity spec.
func fillServerSession(rec *mcpaudit.Record, req mcp.Request) {
	sess, ok := req.GetSession().(*mcp.ServerSession)
	if !ok {
		return
	}
	rec.SessionID = sess.ID()
	if ip := sess.InitializeParams(); ip != nil && ip.ClientInfo != nil {
		rec.CallerIdentity = ip.ClientInfo.Name + "/" + ip.ClientInfo.Version
	}
}

// fillServerToolCallParams sets ToolName/ArgBytes for a tools/call
// method -- every other method leaves both at their zero value.
func fillServerToolCallParams(rec *mcpaudit.Record, method string, req mcp.Request) {
	if method != "tools/call" {
		return
	}
	if p, ok := req.GetParams().(*mcp.CallToolParamsRaw); ok {
		rec.ToolName = p.Name
		rec.ArgBytes = int64(len(p.Arguments))
	}
}

// deriveServerOutcome fills rec.Outcome (+ ErrorText/ParkedWriteID)
// from one server-received tools/call's own result/err -- the three
// cases a park-and-poll write's SYNCHRONOUS round trip can produce
// (docs/adr/0032 §1): denied/cancelled within the courtesy window
// (err, matching gateWrite's own canonical denial text), still-parked
// past the window (a successful result whose text matches
// mcpaudit.ParkedPendingText), or an ordinary result. Any non-tools/call
// method, or a tool call that never went through gateWrite at all,
// falls through to plain success/error.
func deriveServerOutcome(rec *mcpaudit.Record, result mcp.Result, err error) {
	if err != nil {
		rec.ErrorText = err.Error()
		if err.Error() == mcpaudit.DeniedInWindowText {
			rec.Outcome = mcpaudit.OutcomeDenied
		} else {
			rec.Outcome = mcpaudit.OutcomeError
		}
		return
	}
	ctr, ok := result.(*mcp.CallToolResult)
	if !ok {
		rec.Outcome = mcpaudit.OutcomeSuccess
		return
	}
	text := mcpaudit.ContentText(ctr.Content)
	if writeID, parked := mcpaudit.ParseParkedWriteID(text); parked {
		rec.Outcome = mcpaudit.OutcomeParked
		rec.ParkedWriteID = writeID
		return
	}
	if ctr.IsError {
		rec.Outcome = mcpaudit.OutcomeError
		rec.ErrorText = text
		return
	}
	rec.Outcome = mcpaudit.OutcomeSuccess
}

// ClientMiddleware returns the mcp.Middleware wired via
// AddSendingMiddleware on every *mcp.Client mcpclient.NewClient builds
// -- BOTH the stdio connector's own tool calls (mcp-tool-call node,
// Configure's "list tools" preview) AND, since mcpsvc.ConnectInMemoryClient
// is built through that same NewClient choke point, the agent loop's
// in-memory session. direction=client; CallerIdentity comes from ctx
// (mcpaudit.WithCallerIdentity), never from Session, since the same
// *mcp.Client's Implementation name doesn't vary per call the way the
// owning workflow step (or agent-loop session) does.
//
//wails:ignore
func (s *MCPAuditService) ClientMiddleware() mcp.Middleware {
	return func(next mcp.MethodHandler) mcp.MethodHandler {
		return func(ctx context.Context, method string, req mcp.Request) (mcp.Result, error) {
			if mcpaudit.SkipMethod(method) {
				return next(ctx, method, req)
			}

			start := time.Now()
			result, err := next(ctx, method, req)

			rec := buildClientRecord(ctx, method, req, result, err, time.Since(start))
			if _, insErr := s.store.Insert(ctx, rec); insErr != nil {
				s.log.Error("mcp audit: record client call", "error", insErr, "method", method)
			}
			return result, err
		}
	}
}

// buildClientRecord assembles one client-sent call's audit row -- same
// complexity-budget split as buildServerRecord above.
func buildClientRecord(ctx context.Context, method string, req mcp.Request, result mcp.Result, err error, duration time.Duration) mcpaudit.Record {
	rec := mcpaudit.Record{
		Direction: mcpaudit.DirectionClient, MethodName: method, DurationMS: duration.Milliseconds(),
		CallerIdentity: mcpaudit.CallerIdentityFromContext(ctx),
	}
	if sess := req.GetSession(); sess != nil {
		rec.SessionID = sess.ID()
	}
	fillClientToolCallParams(&rec, method, req)
	deriveClientOutcome(&rec, result, err)
	return rec
}

// fillClientToolCallParams sets ToolName/ArgBytes for a tools/call
// method -- the SENDING side sees the real *mcp.CallToolParams (typed
// Arguments), unlike the receiving side's *mcp.CallToolParamsRaw, so
// ArgBytes is measured via a JSON marshal rather than a raw length.
func fillClientToolCallParams(rec *mcpaudit.Record, method string, req mcp.Request) {
	if method != "tools/call" {
		return
	}
	p, ok := req.GetParams().(*mcp.CallToolParams)
	if !ok {
		return
	}
	rec.ToolName = p.Name
	if b, mErr := json.Marshal(p.Arguments); mErr == nil {
		rec.ArgBytes = int64(len(b))
	}
}

// deriveClientOutcome fills rec.Outcome/ErrorText for a client-sent
// call -- never attempts parked-write detection (see the package doc
// comment's own reasoning: park-and-poll is structurally only ever
// Mill's OWN server-side behavior, never a third-party server's).
func deriveClientOutcome(rec *mcpaudit.Record, result mcp.Result, err error) {
	if err != nil {
		rec.Outcome, rec.ErrorText = mcpaudit.OutcomeError, err.Error()
		return
	}
	if ctr, ok := result.(*mcp.CallToolResult); ok && ctr.IsError {
		rec.Outcome, rec.ErrorText = mcpaudit.OutcomeError, mcpaudit.ContentText(ctr.Content)
		return
	}
	rec.Outcome = mcpaudit.OutcomeSuccess
}

// ResolveParkedWrite mutates a parked write's audit row once it
// resolves -- wired into mcpsvc via a late-bound setter (the same
// injected-seam shape as SetAtlasService/SetExecutionService elsewhere
// in main.go) so mcpsvc never imports this package directly. Best-
// effort: an error here is logged, never returned/propagated, since the
// real resolution (ResolveMCPWrite/CancelMCPWrite's own side effect)
// has already happened by the time this runs -- audit observability
// must never be able to fail Mill's own governance action.
//
//wails:ignore
func (s *MCPAuditService) ResolveParkedWrite(writeID string, outcome mcpaudit.Outcome, errText string) {
	if err := s.store.UpdateOutcome(writeID, outcome, errText); err != nil {
		s.log.Error("mcp audit: resolve parked write", "error", err, "writeID", writeID)
	}
}
