// Package triggersvc is the Wails-facing layer over
// internal/domain/trigger: registering and running the live listeners
// (hotkey, schedule, clipboard/filesystem watch, system event) that
// start a workflow, plus their settings-store persistence. Domain
// validation stays in the domain package; this package owns the
// runtime registry of active OS-level listeners and the call into
// CompositionService/ExecutionService to actually run a workflow.
package triggersvc

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"

	"github.com/alicoding/mill/internal/adapters/filewatch"
	"github.com/alicoding/mill/internal/adapters/hotkey"
	"github.com/alicoding/mill/internal/adapters/schedule"
	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/trigger"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/executionsvc"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// HotkeyBindingsKey replaces the old, actionID-keyed
// hotkeyBindingsKey (see docs/SPEC.md §3.4's "HotkeyService is hardwired
// to runbook.Run" gap) -- one settings-store key, workflow-ID-keyed
// instead of action-ID-keyed, same one-atomic-JSON-blob shape.
const HotkeyBindingsKey = "trigger-hotkey-bindings"

var modSymbol = map[string]string{
	"CMD": "⌘", "CTRL": "⌃", "SHIFT": "⇧", "OPTION": "⌥", "ALT": "⌥",
}

func FormatBinding(mods []string, key string) string {
	var b strings.Builder
	for _, m := range mods {
		b.WriteString(modSymbol[strings.ToUpper(m)])
	}
	b.WriteString(strings.ToUpper(key))
	return b.String()
}

type PersistedHotkey struct {
	Mods []string `json:"mods"`
	Key  string   `json:"key"`
}

// activeListener is a tagged union over the live-listener kinds a
// registered trigger can hold -- exactly one field is non-nil per
// registry entry (trigger-manual/trigger-callable hold none at all; they
// have no listener).
type activeListener struct {
	hotkey    *hotkey.Binding
	schedule  *schedule.Binding
	clipStop  func()
	fileWatch *filewatch.Binding
	// sysEventStop unregisters a trigger-system-event listener from
	// TriggerService's own sysEvents map (triggersystemevent.go) -- unlike
	// the other three, there's no external OS resource to release, only
	// this in-process registry entry to remove.
	sysEventStop func()
}

func (l *activeListener) stop() {
	if l == nil {
		return
	}
	if l.hotkey != nil {
		_ = l.hotkey.Unbind()
	}
	if l.schedule != nil {
		l.schedule.Remove()
	}
	if l.clipStop != nil {
		l.clipStop()
	}
	if l.fileWatch != nil {
		_ = l.fileWatch.Close()
	}
	if l.sysEventStop != nil {
		l.sysEventStop()
	}
}

// TriggerService owns starting/stopping the live listener behind every
// workflow's Trigger node (docs/SPEC.md §3.4) -- the piece that didn't
// have a home before this: CompositionService stays persistence +
// validation with no runtime listener state (its own doc comment says
// so), and a live OS hotkey/cron/watcher registration doesn't belong
// bolted onto either that or a low-level adapter. Every fired listener
// calls ExecutionService.RunWorkflow (docs/adr/0008) tagged
// RunKindTriggered -- the same single execution path every other Run
// entrypoint in the app uses now, so a headless fire gets the same
// checkpointing/Runs-page visibility a manual click does.
//
// Hotkey exclusivity (SPEC.md §3.4, modeled on Raycast's own conflict
// UX) lives here too, via internal/domain/trigger.CheckConflict --
// AssignHotkey rejects a combo already claimed by a different workflow
// instead of silently letting two workflows share one.
type TriggerService struct {
	mu       sync.Mutex
	active   map[string]*activeListener // workflowID -> live listener
	hkRaw    map[string]PersistedHotkey // workflowID -> persisted (mods, key)
	comp     *compositionsvc.CompositionService
	exec     *executionsvc.ExecutionService // see SetExecutionService
	logger   *slog.Logger
	store    settings.Store
	reserved func() (mods []string, key string, ok bool) // see SetReservedCombo
	// sysEvents indexes every armed trigger-system-event listener by
	// event kind (docs/adr/0035) -- populated/depopulated by Sync via
	// each entry's start/stop, mutated only while s.mu is held (see
	// triggersystemevent.go). Keyed by SystemEventKind's string value
	// (executionsvc.SystemEventKind) rather than that type itself, to
	// keep this file from needing to import executionsvc just for a map
	// key type.
	sysEvents map[string][]systemEventBinding
}

// SetExecutionService wires the durable-execution runtime a headless fire
// runs through (docs/adr/0008) -- a late-bound setter, not a constructor
// parameter, because ExecutionService's own constructor depends on
// CompositionService (which TriggerService already needs at construction
// time for Sync's workflow lookups), so ExecutionService is necessarily
// built after TriggerService in main.go; same shape as SetReservedCombo.
//
//wails:ignore
func (s *TriggerService) SetExecutionService(e *executionsvc.ExecutionService) {
	s.exec = e
}

func NewTriggerService(comp *compositionsvc.CompositionService, logger *slog.Logger, store settings.Store) *TriggerService {
	s := &TriggerService{
		active:    make(map[string]*activeListener),
		hkRaw:     make(map[string]PersistedHotkey),
		comp:      comp,
		logger:    logger,
		store:     store,
		sysEvents: make(map[string][]systemEventBinding),
	}
	s.loadPersistedHotkeys()
	return s
}

func (s *TriggerService) loadPersistedHotkeys() {
	raw, ok := s.store.Get(HotkeyBindingsKey).(string)
	if !ok || raw == "" {
		return
	}
	var persisted map[string]PersistedHotkey
	if err := json.Unmarshal([]byte(raw), &persisted); err != nil {
		s.logger.Error("failed to unmarshal persisted trigger hotkey bindings", "error", err)
		return
	}
	s.hkRaw = persisted
}

func (s *TriggerService) persistHotkeys() {
	s.mu.Lock()
	raw := make(map[string]PersistedHotkey, len(s.hkRaw))
	for k, v := range s.hkRaw {
		raw[k] = v
	}
	s.mu.Unlock()

	data, err := json.Marshal(raw)
	if err != nil {
		s.logger.Error("failed to marshal trigger hotkey bindings for persistence", "error", err)
		return
	}
	if err := s.store.Set(HotkeyBindingsKey, string(data)); err != nil {
		s.logger.Error("failed to persist trigger hotkey bindings", "error", err)
	}
}

// Sync reconciles every live listener against the current workflow set.
// Rebuilds from scratch on every call rather than diffing against the
// previous state -- simpler to reason about, and cheap: Sync only runs
// after a workflow Create/Update/Delete or once at app startup, never on
// a hot path, and Mill has a handful of workflows, not thousands.
//
// wails:ignore -- Go-internal reconciliation only, called from
// CompositionService and from ApplicationStarted; not something the
// frontend has any legitimate reason to trigger directly.
//
//wails:ignore
func (s *TriggerService) Sync(workflows []composition.Workflow) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for id, l := range s.active {
		l.stop()
		delete(s.active, id)
	}

	for _, wf := range workflows {
		// ADR-0021: a disabled or never-published workflow's triggers
		// don't even arm -- going live is the explicit act (Publish),
		// and disabling pauses production while a test run stays
		// allowed. The published SNAPSHOT is what a fire executes
		// (ExecutionService's own resolution); the trigger config used
		// to arm the listener also comes from the published snapshot,
		// not the draft head, so editing a schedule in the draft never
		// silently rewires a live listener before Publish.
		if wf.Disabled || wf.PublishedVersion == 0 {
			continue
		}
		published, ok := composition.VersionByNumber(wf, wf.PublishedVersion)
		if !ok {
			continue
		}
		armed := wf
		armed.Nodes, armed.Edges = published.Nodes, published.Edges
		nodeTypeID, config, ok := trigger.ExtractTrigger(armed)
		if !ok {
			continue
		}
		listener, err := s.start(wf.ID, nodeTypeID, config)
		if err != nil {
			s.logger.Error("trigger registration failed", "workflow", wf.ID, "type", nodeTypeID, "error", err)
			continue
		}
		if listener != nil {
			s.active[wf.ID] = listener
		}
	}
}

// fire runs workflowID and reports the outcome. binding is a human-
// readable description of what triggered it (a hotkey's label, e.g.
// "⌘⇧M"; empty for schedule/clipboard-watch/filesystem-watch triggers,
// which have no single-glyph label the way a keyboard combo does).
// payload seeds the run's starting ExecContext.Payload (docs/SPEC.md
// §3.4's Trigger row: "a trigger's output IS the workflow's input") --
// only trigger-filesystem-watch has real event data to offer today (its
// changed file path); every other trigger type passes "".
func (s *TriggerService) fire(workflowID, binding, payload string) {
	// nil values: a headless trigger fire has no user-supplied Attribute
	// input to offer -- it runs with the workflow's own declared
	// defaults, same as before docs/adr/0008's test-input form existed.
	summary, err := s.exec.RunWorkflowWithPayload(workflowID, executionsvc.RunKindTriggered, nil, payload)
	if err != nil {
		// A call-level failure (unknown workflow, run couldn't start) --
		// distinct from a failed *run*, handled below via summary.Error.
		s.logger.Error("triggered workflow failed", "workflow", workflowID, "error", err)
		emitHotkeyActivity(workflowID, binding, false, err.Error(), "")
		return
	}
	if summary.Error != "" {
		s.logger.Error("triggered workflow failed", "workflow", workflowID, "error", summary.Error)
		emitHotkeyActivity(workflowID, binding, false, summary.Error, "")
		return
	}
	s.logger.Info("triggered workflow completed", "workflow", workflowID, "output_bytes", len(summary.Output))
	emitHotkeyActivity(workflowID, binding, true, fmt.Sprintf("completed (%d bytes)", len(summary.Output)), summary.Output)
}

// start registers the one live listener nodeTypeID needs, if any --
// trigger-manual needs none (it only ever fires via an explicit Run/Test
// click, never headlessly). Caller (Sync) holds s.mu already. The real
// per-type logic lives in each trigger type's own file (triggermanual.go,
// triggerhotkey.go, ...), registered into triggerRegistry from its own
// init() (docs/adr/0006-extension-point-registration.md) -- this is a
// lookup, not a switch, so a new trigger type never means editing this
// function.
func (s *TriggerService) start(workflowID, nodeTypeID string, config map[string]string) (*activeListener, error) {
	starter, ok := triggerRegistry[nodeTypeID]
	if !ok {
		return nil, fmt.Errorf("unknown trigger node type: %s", nodeTypeID)
	}
	return starter(s, workflowID, config)
}

// ArmedWorkflows returns the workflow IDs that currently have a live
// trigger listener registered -- reads s.active directly (the exact map
// Sync populates/depopulates on every Create/Update/Delete/Publish/
// Disable, and at startup) rather than recomputing Sync's own gate
// (!Disabled && PublishedVersion > 0) a second time here or in the
// frontend, so this can never drift from what's actually listening.
// docs/goals/0006-trigger-aware-workflows-list.md's tri-state armed
// label needs exactly this: armed / configured-but-not-live /
// unconfigured, where "armed" has to be the real thing, not a guess at
// it. A workflow absent from the result isn't necessarily unconfigured
// -- besides Disabled/never-published, a schedule with an empty cron or
// a filesystem-watch with an empty path also never starts a listener
// (see triggerschedule.go/triggerfilesystemwatch.go's own nil, nil
// returns) -- "configured" is a separate, frontend-derived judgment
// about the node's own Config fields. trigger-manual/trigger-callable
// never appear here at all: neither type ever registers a listener
// (SPEC.md §3.4), by design, not an omission.
func (s *TriggerService) ArmedWorkflows() map[string]bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[string]bool, len(s.active))
	for id := range s.active {
		out[id] = true
	}
	return out
}

// FindWorkflow returns the workflow with id from the current set, if
// any -- exported for settingssvc's conflict-error labeling only,
// never a frontend RPC.
//
//wails:ignore
func (s *TriggerService) FindWorkflow(id string) (composition.Workflow, bool) {
	for _, wf := range s.comp.Workflows() {
		if wf.ID == id {
			return wf, true
		}
	}
	return composition.Workflow{}, false
}

// HotkeyActivity is emitted once a triggered workflow resolves (success
// or failure) -- not just hotkey fires despite the name (kept for the
// event's own wire compatibility; renaming the event string itself would
// be a cosmetic-only churn no caller needs). The Go-side slog lines
// above log the same information for terminal/`task dev` visibility;
// this event is the in-app equivalent, so a headless trigger's outcome
// is visible without a terminal -- added after a real hotkey worked
// correctly (fired, ran, wrote to the clipboard) but looked from the UI
// like nothing happened, because nothing in the UI ever said otherwise.
// Lives with TriggerService (its emitter); main.go imports it for
// application.RegisterEvent.
type HotkeyActivity struct {
	WorkflowID string `json:"workflowID"`
	Binding    string `json:"binding"`
	Success    bool   `json:"success"`
	Detail     string `json:"detail"`
	// Result is the actual output copied to the clipboard, so the UI can
	// show what a trigger fire actually produced, not just its byte count.
	// Empty on failure -- there's nothing successful to show.
	Result string `json:"result"`
}

// emitHotkeyActivity pushes a HotkeyActivity event to the frontend so a
// triggered workflow's outcome is visible in the app itself, not just in
// the slog lines above. application.Get() is safe to call here: this
// only ever runs from TriggerService's own goroutines (Keydown loops,
// schedule/watch callbacks), which can't fire before application.New has
// run and registered the global app instance. binding is empty for every
// trigger type except hotkey, which has no single-glyph label -- same
// "no successful output to show" reasoning the zero-value Result on
// failure already relies on.
func emitHotkeyActivity(workflowID, binding string, success bool, detail, result string) {
	// application.Get() is nil in a headless Go test process (no real
	// Wails app was ever application.New()'d) -- a real triggered fire
	// only happens inside the running app in production, but
	// docs/goals/0010's own filesystem-watch seed test now drives a
	// real TriggerService.fire() from a bare unit test to prove the
	// real seed's graph actually executes, which reaches this line for
	// the first time outside a live app. Guard rather than crash; there
	// is nothing to emit an event to when no window/app exists anyway.
	app := application.Get()
	if app == nil {
		return
	}
	app.Event.Emit("hotkey-activity", HotkeyActivity{
		WorkflowID: workflowID,
		Binding:    binding,
		Success:    success,
		Detail:     detail,
		Result:     result,
	})
}
