// Package bridgesvc is the Wails-bound owner of Mill's browser bridge:
// the loopback HTTP endpoint a paired browser extension holds one
// stream open against, the per-run result intake that stream's browser
// posts back to, and the built-in connection test.
//
// Every connection is browser-initiated. Mill never pushes to a browser
// it did not first receive a stream from, so the extension -- not Mill
// -- decides when the channel exists at all.
//
// .claude/rules/backend.md's service-owns-storage split: the wire
// vocabulary lives in internal/domain/browserbridge, the paired-browser
// credential lives in remoteauthsvc, and this package owns the
// lifecycle joining them.
package bridgesvc

import (
	"context"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/adapters/auditstore"
	"github.com/alicoding/mill/internal/domain/audit"
	"github.com/alicoding/mill/internal/domain/browserbridge"
	"github.com/alicoding/mill/internal/services/remoteauthsvc"
)

// AddrEnvVar is the deploy/env override for the bridge's bind address,
// the same MILL_* convention every other listener in Mill follows.
const AddrEnvVar = "MILL_BRIDGE_ADDR"

// AddrDefault is the built-in bind address: loopback only. The bridge
// carries a credential that can drive somebody's logged-in tabs, so it
// never binds wider without an explicit env decision.
const AddrDefault = "127.0.0.1:8092"

// ConnectWaitEnvVar overrides beginRun's own wait, in milliseconds --
// test-only (a real deploy always gets browserbridge.ConnectWaitSeconds).
// A Go test outside this package can't reach the unexported connectWait
// field newService constructs against, so this is that same shortcut
// through an env var, mirroring AddrEnvVar's own precedent.
const ConnectWaitEnvVar = "MILL_BRIDGE_CONNECT_WAIT_MS"

// readHeaderTimeout bounds the slow-headers window on a listener any
// other local process can reach (gosec G112).
const readHeaderTimeout = 5 * time.Second

// DefaultReplayTimeout is how long a run may stay in flight after a
// browser accepted it when the caller names no budget of its own. Long
// enough for a recorded flow with several page loads, short enough that
// a closed tab reports rather than hangs.
const DefaultReplayTimeout = 2 * time.Minute

// commandBuffer is how many commands may queue for one connected
// browser before Mill refuses rather than blocking a caller.
const commandBuffer = 8

// TokenAuthority is the paired-credential seam: the bridge mints and
// checks nothing itself, it asks remoteauthsvc, which owns every
// paired thing Mill knows about -- browser extensions and headless
// webhook tokens alike.
type TokenAuthority interface {
	PairBrowser(code, label, source, origin string) (remoteauthsvc.BrowserPairing, error)
	ValidateBrowserToken(token string) (remoteauthsvc.DeviceInfo, bool)
	ValidateWebhookToken(token string) (remoteauthsvc.DeviceInfo, bool)
	// RequestPairing and PairingStatus back the nearby discovery flow
	// (goal 0379): a popup-minted request, confirmed by a human
	// Accept/Deny in Mill, never a code typed out of band.
	RequestPairing(label, source, origin string) (remoteauthsvc.PairingRequestInfo, error)
	PairingStatus(requestID string) remoteauthsvc.PairingRequestStatus
	// RevokeDevice backs the self-revoke door (goal 0379 S2): a paired
	// browser presenting its own bearer token ends its own pairing
	// through the SAME door Settings' own revoke uses -- never a
	// second trust model.
	RevokeDevice(id string) error
	// BrowserOrigin and RecordBrowserOrigin back the WebSocket door's
	// own Origin binding (goal 0418): a paired credential accepts a
	// socket only from the Origin recorded on it, learned once for a
	// credential paired before this existed.
	BrowserOrigin(deviceID string) (string, bool)
	RecordBrowserOrigin(deviceID, origin string)
}

// client is one browser holding a stream open.
type client struct {
	seq      uint64
	deviceID string
	label    string
	commands chan browserbridge.Command
	cancel   context.CancelFunc
}

// run is one replay in flight: the per-step results as they arrive, and
// the channel the final result closes it through.
type run struct {
	steps []browserbridge.Result
	done  chan browserbridge.Result
}

// BridgeService owns the listener, the connected-browser registry and
// the in-flight-run registry.
type BridgeService struct {
	auth   TokenAuthority
	logger *slog.Logger

	addr        string
	envOverride bool
	server      *http.Server

	// keepalive is how often an idle stream is pinged and its token
	// re-checked. A field rather than a constant read at the tick site
	// so a test can shorten it BEFORE the listener starts, without a
	// package-level variable two goroutines would then share.
	keepalive time.Duration

	// connectWait bounds how long beginRun waits for a browser to
	// (re)connect before failing -- same shorten-before-Start posture
	// as keepalive.
	connectWait time.Duration

	mu      sync.Mutex
	clients []*client
	runs    map[string]*run
	seq     uint64
	// arrived is closed and replaced (under mu) every time a client
	// connects -- a beginRun waiting for a browser selects on the
	// channel it read here, so closing it broadcasts to every waiter at
	// once without a goroutine leak once none are left waiting.
	arrived chan struct{}

	// The extension's own files, and where they are written for a
	// browser to load -- see bridgeservice_extension.go.
	extensionFiles fs.FS
	extensionDir   string

	// webhookSink dispatches a validated webhook post into the trigger
	// layer; its own mutex because SetWebhookEventSink runs at startup
	// while requests arrive concurrently. See bridgeservice_webhook.go.
	webhookMu   sync.Mutex
	webhookSink webhookEventSink

	// auditStore/auditLog are the shared audit trail's own connection
	// (goal 0351 S2) -- nil until OpenAudit runs, mirroring
	// secretsvc.SecretService's own auditStore field: a BridgeService
	// with no audit store opened (every test that doesn't call
	// OpenAudit) simply doesn't record, the same "audit is
	// observability, never a correctness gate" posture every other
	// producer's best-effort record call takes.
	auditStore *auditstore.Store
	auditLog   *slog.Logger
}

// ResolveAddr picks the effective bind address: the env override always
// wins, else the loopback default. envOverride reports which, so the
// Settings caption can say why the address is what it is.
func ResolveAddr(env string) (addr string, envOverride bool) {
	if env != "" {
		return env, true
	}
	return AddrDefault, false
}

// New constructs the service against the credential authority. The
// listener does not start here -- Start is a separate step so wiring
// can log a bind failure without failing construction.
func New(auth TokenAuthority, logger *slog.Logger) *BridgeService {
	if logger == nil {
		logger = slog.Default()
	}
	addr, envOverride := ResolveAddr(os.Getenv(AddrEnvVar))
	return &BridgeService{
		auth:        auth,
		logger:      logger,
		addr:        addr,
		envOverride: envOverride,
		keepalive:   browserbridge.KeepaliveSeconds * time.Second,
		connectWait: resolveConnectWait(os.Getenv(ConnectWaitEnvVar)),
		runs:        make(map[string]*run),
		arrived:     make(chan struct{}),
	}
}

// resolveConnectWait mirrors ResolveAddr's own env-override shape: the
// override wins when it parses as a positive number of milliseconds,
// else the production default.
func resolveConnectWait(envMS string) time.Duration {
	if ms, err := strconv.Atoi(envMS); err == nil && ms > 0 {
		return time.Duration(ms) * time.Millisecond
	}
	return browserbridge.ConnectWaitSeconds * time.Second
}

// Start binds the bridge listener in the background. A bind failure
// arrives on the returned channel rather than synchronously, since
// ListenAndServe fails after this call has already returned.
//
//wails:ignore
func (s *BridgeService) Start() <-chan error {
	handler := s.Handler()
	server := &http.Server{Addr: s.addr, Handler: handler, ReadHeaderTimeout: readHeaderTimeout}
	s.mu.Lock()
	s.server = server
	s.mu.Unlock()

	errCh := make(chan error, 1)
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()
	return errCh
}

// Stop shuts the listener down and drops every open stream.
//
//wails:ignore
func (s *BridgeService) Stop(ctx context.Context) error {
	s.mu.Lock()
	server := s.server
	clients := s.clients
	s.clients = nil
	s.mu.Unlock()
	for _, c := range clients {
		c.cancel()
	}
	if server == nil {
		return nil
	}
	return server.Shutdown(ctx)
}

// Status is the Browsers section's read model: where a browser should
// point, and whether one is listening right now.
type Status struct {
	Address     string `json:"address"`
	EnvOverride bool   `json:"envOverride"`
	Connected   bool   `json:"connected"`
	Browsers    int    `json:"browsers"`
}

// BridgeStatus reports the address to enter in the extension and how
// many browsers currently hold a stream open.
func (s *BridgeService) BridgeStatus() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Status{
		Address:     "http://" + s.addr,
		EnvOverride: s.envOverride,
		Connected:   len(s.clients) > 0,
		Browsers:    len(s.clients),
	}
}

// TestResult is what "Test the connection" reports back.
type TestResult struct {
	Steps      int   `json:"steps"`
	DurationMS int64 `json:"durationMs"`
}

// TestConnection replays the built-in flow against the page Mill serves
// itself, proving navigation, selector resolution and a wait all reach
// the browser and come back. A failure arrives as its own sentence, not
// as a silent false.
func (s *BridgeService) TestConnection() (TestResult, error) {
	pageURL := "http://" + s.addr + TestPagePath
	outcome, err := s.Replay(context.Background(), browserbridge.TestFlow(pageURL), ReplayOptions{})
	if err != nil {
		return TestResult{}, err
	}
	return TestResult{Steps: outcome.Steps, DurationMS: outcome.DurationMS}, nil
}

// StepOutcome is one step of a finished replay, as the browser
// reported it. Index is the step's own 0-based position in the flow,
// carried explicitly because results arrive on their own POSTs and a
// skipped or failed run leaves gaps.
type StepOutcome struct {
	Index     int    `json:"index"`
	Status    string `json:"status"`
	Error     string `json:"error,omitempty"`
	Extracted string `json:"extracted,omitempty"`
}

// Outcome is a finished replay: how many steps ran, how long it took,
// every step the browser reported, and anything the run collected on
// the way.
type Outcome struct {
	Steps      int                      `json:"steps"`
	DurationMS int64                    `json:"durationMs"`
	Results    []StepOutcome            `json:"results,omitempty"`
	Extracted  []string                 `json:"extracted,omitempty"`
	Downloads  []browserbridge.Download `json:"downloads,omitempty"`
}

// ReplayOptions are the per-run choices a caller may vary. The zero
// value is the connection test's own: the flow's first navigate picks
// the tab, and the run gets DefaultReplayTimeout.
type ReplayOptions struct {
	// Target narrows where the flow runs; nil lets the flow decide.
	Target *browserbridge.Target
	// Timeout bounds the WHOLE run, not one step. Zero means
	// DefaultReplayTimeout.
	Timeout time.Duration
}

// Replay sends flow to the most recently connected browser and blocks
// until that browser closes the run. With nothing connected yet it
// waits up to connectWait for one to (re)connect -- the extension's own
// alarm/popup wakes an idle worker within one cycle -- before failing
// with the same named error a caller can act on.
//
// A failed run still carries its step results: the outcome is returned
// ALONGSIDE the error, so a caller can show which step stopped the run
// instead of only that one did.
//
//wails:ignore
func (s *BridgeService) Replay(ctx context.Context, flow browserbridge.UserFlow, opts ReplayOptions) (Outcome, error) {
	if err := flow.Validate(); err != nil {
		return Outcome{}, fmt.Errorf("bridgesvc: %w", err)
	}

	id, r, c, waitedMS, err := s.beginRun(ctx)
	if err != nil {
		s.recordCommand(ctx, "replay", audit.Target{Kind: "bridge-run"}, "", "rejected", "", 0, "", waitAttrs(waitedMS)...)
		return Outcome{}, err
	}
	defer s.endRun(id)
	runTarget := audit.Target{Kind: "bridge-run", ID: id}
	actorSource := "browser:" + c.deviceID

	command := browserbridge.Command{ID: id, Kind: browserbridge.KindReplay, Flow: &flow, Target: opts.Target}
	select {
	case c.commands <- command:
	default:
		s.recordCommand(ctx, "replay", runTarget, actorSource, "rejected", "", 0, "", waitAttrs(waitedMS)...)
		return Outcome{}, browserbridge.ErrNoBrowser()
	}
	s.logger.Info("browser bridge: replay started", "run", id, "browser", c.deviceID, "steps", len(flow.Steps))

	budget := opts.Timeout
	if budget <= 0 {
		budget = DefaultReplayTimeout
	}
	timer := time.NewTimer(budget)
	defer timer.Stop()

	started := time.Now()
	select {
	case final := <-r.done:
		outcome := s.collect(id, started)
		if final.Status != browserbridge.StatusDone {
			s.logger.Info("browser bridge: replay failed", "run", id, "browser", c.deviceID, "error", final.Error)
			s.recordCommand(ctx, "replay", runTarget, actorSource, "error", "replay-failed", 0, final.Error, waitAttrs(waitedMS)...)
			return outcome, browserbridge.ErrReplayFailed(final.Error)
		}
		s.logger.Info("browser bridge: replay finished", "run", id, "browser", c.deviceID, "steps", outcome.Steps, "ms", outcome.DurationMS)
		s.recordCommand(ctx, "replay", runTarget, actorSource, "accepted", "", 0, "", waitAttrs(waitedMS)...)
		return outcome, nil
	case <-timer.C:
		s.logger.Info("browser bridge: replay timed out", "run", id, "browser", c.deviceID, "seconds", int(budget.Seconds()))
		s.recordCommand(ctx, "replay", runTarget, actorSource, "error", "timeout", 0, "", waitAttrs(waitedMS)...)
		return s.collect(id, started), browserbridge.ErrReplayTimedOutAfter(budget)
	case <-ctx.Done():
		// A cancelled run (the workflow run was stopped) is not a
		// browser fault, and reads as the timeout it effectively is
		// rather than as a pairing problem.
		s.logger.Info("browser bridge: replay cancelled", "run", id, "browser", c.deviceID)
		s.recordCommand(ctx, "replay", runTarget, actorSource, "error", "cancelled", 0, "", waitAttrs(waitedMS)...)
		return s.collect(id, started), browserbridge.ErrReplayTimedOut()
	}
}

// waitAttrs is recordCommand's own extra tail: a run that waited on the
// browser's own reconnect gets an audit attribute naming how long, and
// a run that found one already connected gets none -- never a zero
// entry cluttering every ordinary run.
func waitAttrs(waitedMS int64) []string {
	if waitedMS <= 0 {
		return nil
	}
	return []string{"waited_for_browser_ms", strconv.FormatInt(waitedMS, 10)}
}

// beginRun registers a run against the newest connected browser. With
// nothing connected yet, it waits up to connectWait for addClient's own
// broadcast, the run's own context, or the timeout -- whichever comes
// first -- before giving up. waitedMS reports how long it actually
// waited, 0 when a browser was already there.
func (s *BridgeService) beginRun(ctx context.Context) (id string, r *run, c *client, waitedMS int64, err error) {
	s.mu.Lock()
	if len(s.clients) == 0 {
		arrived := s.arrived
		s.mu.Unlock()

		started := time.Now()
		timer := time.NewTimer(s.connectWait)
		defer timer.Stop()
		select {
		case <-arrived:
			waitedMS = time.Since(started).Milliseconds()
		case <-ctx.Done():
			return "", nil, nil, time.Since(started).Milliseconds(), browserbridge.ErrNoBrowser()
		case <-timer.C:
			return "", nil, nil, time.Since(started).Milliseconds(), browserbridge.ErrNoBrowser()
		}
		s.mu.Lock()
	}
	defer s.mu.Unlock()
	if len(s.clients) == 0 {
		// The browser that triggered the broadcast above disconnected
		// again before this goroutine could relock -- rare enough (a
		// flap inside one wakeup) that failing immediately rather than
		// waiting a second time is the honest answer to give.
		return "", nil, nil, waitedMS, browserbridge.ErrNoBrowser()
	}
	// The newest stream wins when more than one browser is paired and
	// connected: the one the user just opened is the one they are
	// looking at.
	c = s.clients[len(s.clients)-1]
	s.seq++
	id = fmt.Sprintf("run-%d-%d", time.Now().UnixNano(), s.seq)
	r = &run{done: make(chan browserbridge.Result, 1)}
	s.runs[id] = r
	return id, r, c, waitedMS, nil
}

func (s *BridgeService) endRun(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.runs, id)
}

// collect turns a finished run's step results into the Outcome the
// caller sees. Held without mu by Replay; takes it here.
func (s *BridgeService) collect(id string, started time.Time) Outcome {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := Outcome{DurationMS: time.Since(started).Milliseconds()}
	r, ok := s.runs[id]
	if !ok {
		return out
	}
	for _, step := range r.steps {
		if step.Status == browserbridge.StatusOK {
			out.Steps++
		}
		index := -1
		if step.StepIndex != nil {
			index = *step.StepIndex
		}
		out.Results = append(out.Results, StepOutcome{
			Index: index, Status: step.Status, Error: step.Error, Extracted: step.Extracted,
		})
		if step.Extracted != "" {
			out.Extracted = append(out.Extracted, step.Extracted)
		}
		if step.Download != nil {
			out.Downloads = append(out.Downloads, *step.Download)
		}
	}
	sort.SliceStable(out.Results, func(i, j int) bool { return out.Results[i].Index < out.Results[j].Index })
	return out
}

// recordResult files one POST from a browser against its run. An
// unknown id is ignored rather than answered with an error: a browser
// reporting on a run Mill already timed out is not a client fault.
func (s *BridgeService) recordResult(result browserbridge.Result) {
	s.mu.Lock()
	r, ok := s.runs[result.ID]
	if ok && !result.Final() {
		r.steps = append(r.steps, result)
	}
	s.mu.Unlock()
	if !ok || !result.Final() {
		return
	}
	select {
	case r.done <- result:
	default:
	}
}
