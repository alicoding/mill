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
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"

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

// readHeaderTimeout bounds the slow-headers window on a listener any
// other local process can reach (gosec G112).
const readHeaderTimeout = 5 * time.Second

// replayTimeout is how long a run may stay in flight after a browser
// accepted it. Long enough for a recorded flow with several page loads,
// short enough that a closed tab reports rather than hangs.
const replayTimeout = 2 * time.Minute

// commandBuffer is how many commands may queue for one connected
// browser before Mill refuses rather than blocking a caller.
const commandBuffer = 8

// TokenAuthority is the paired-browser credential seam: the bridge
// mints and checks nothing itself, it asks remoteauthsvc, which owns
// every paired thing Mill knows about.
type TokenAuthority interface {
	PairBrowser(code, label, source string) (remoteauthsvc.BrowserPairing, error)
	ValidateBrowserToken(token string) (remoteauthsvc.DeviceInfo, bool)
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

	mu      sync.Mutex
	clients []*client
	runs    map[string]*run
	seq     uint64
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
		runs:        make(map[string]*run),
	}
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
	outcome, err := s.Replay(browserbridge.TestFlow(pageURL), nil)
	if err != nil {
		return TestResult{}, err
	}
	return TestResult{Steps: outcome.Steps, DurationMS: outcome.DurationMS}, nil
}

// Outcome is a finished replay: how many steps ran, how long it took,
// and anything the run collected on the way.
type Outcome struct {
	Steps      int                      `json:"steps"`
	DurationMS int64                    `json:"durationMs"`
	Extracted  []string                 `json:"extracted,omitempty"`
	Downloads  []browserbridge.Download `json:"downloads,omitempty"`
}

// Replay sends flow to the most recently connected browser and blocks
// until that browser closes the run. With nothing connected it fails
// immediately rather than waiting out a timeout that would tell the
// reader nothing.
//
//wails:ignore
func (s *BridgeService) Replay(flow browserbridge.UserFlow, target *browserbridge.Target) (Outcome, error) {
	if err := flow.Validate(); err != nil {
		return Outcome{}, fmt.Errorf("bridgesvc: %w", err)
	}

	id, r, c, err := s.beginRun()
	if err != nil {
		return Outcome{}, err
	}
	defer s.endRun(id)

	command := browserbridge.Command{ID: id, Kind: browserbridge.KindReplay, Flow: &flow, Target: target}
	select {
	case c.commands <- command:
	default:
		return Outcome{}, browserbridge.ErrNoBrowser()
	}
	s.logger.Info("browser bridge: replay started", "run", id, "browser", c.deviceID, "steps", len(flow.Steps))

	started := time.Now()
	select {
	case final := <-r.done:
		outcome := s.collect(id, started)
		if final.Status != browserbridge.StatusDone {
			s.logger.Info("browser bridge: replay failed", "run", id, "browser", c.deviceID, "error", final.Error)
			return Outcome{}, browserbridge.ErrReplayFailed(final.Error)
		}
		s.logger.Info("browser bridge: replay finished", "run", id, "browser", c.deviceID, "steps", outcome.Steps, "ms", outcome.DurationMS)
		return outcome, nil
	case <-time.After(replayTimeout):
		s.logger.Info("browser bridge: replay timed out", "run", id, "browser", c.deviceID)
		return Outcome{}, browserbridge.ErrReplayTimedOut()
	}
}

// beginRun registers a run against the newest connected browser.
func (s *BridgeService) beginRun() (string, *run, *client, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.clients) == 0 {
		return "", nil, nil, browserbridge.ErrNoBrowser()
	}
	// The newest stream wins when more than one browser is paired and
	// connected: the one the user just opened is the one they are
	// looking at.
	c := s.clients[len(s.clients)-1]
	s.seq++
	id := fmt.Sprintf("run-%d-%d", time.Now().UnixNano(), s.seq)
	r := &run{done: make(chan browserbridge.Result, 1)}
	s.runs[id] = r
	return id, r, c, nil
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
		if step.Extracted != "" {
			out.Extracted = append(out.Extracted, step.Extracted)
		}
		if step.Download != nil {
			out.Downloads = append(out.Downloads, *step.Download)
		}
	}
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

// marshalCommand is the one place an envelope becomes stream bytes, so
// the wire shape has a single author.
func marshalCommand(c browserbridge.Command) ([]byte, error) {
	return json.Marshal(c)
}
