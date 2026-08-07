package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/adapters/clipboard"
	"github.com/alicoding/mill/internal/adapters/filewatch"
	"github.com/alicoding/mill/internal/adapters/hotkey"
	"github.com/alicoding/mill/internal/adapters/schedule"
	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/trigger"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// triggerHotkeyBindingsKey replaces the old, actionID-keyed
// hotkeyBindingsKey (see docs/SPEC.md §3.4's "HotkeyService is hardwired
// to runbook.Run" gap) -- one settings-store key, workflow-ID-keyed
// instead of action-ID-keyed, same one-atomic-JSON-blob shape.
const triggerHotkeyBindingsKey = "trigger-hotkey-bindings"

var modSymbol = map[string]string{
	"CMD": "⌘", "CTRL": "⌃", "SHIFT": "⇧", "OPTION": "⌥", "ALT": "⌥",
}

func formatBinding(mods []string, key string) string {
	var b strings.Builder
	for _, m := range mods {
		b.WriteString(modSymbol[strings.ToUpper(m)])
	}
	b.WriteString(strings.ToUpper(key))
	return b.String()
}

type persistedHotkey struct {
	Mods []string `json:"mods"`
	Key  string   `json:"key"`
}

// activeListener is a tagged union over the four live-listener kinds a
// registered trigger can hold -- exactly one field is non-nil per
// registry entry (trigger-manual holds none at all; it has no listener).
type activeListener struct {
	hotkey    *hotkey.Binding
	schedule  *schedule.Binding
	clipStop  func()
	fileWatch *filewatch.Binding
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
}

// TriggerService owns starting/stopping the live listener behind every
// workflow's Trigger node (docs/SPEC.md §3.4) -- the piece that didn't
// have a home before this: CompositionService stays persistence +
// validation with no runtime listener state (its own doc comment says
// so), and a live OS hotkey/cron/watcher registration doesn't belong
// bolted onto either that or a low-level adapter. Every fired listener
// calls CompositionService.RunWorkflow, unchanged.
//
// Hotkey exclusivity (SPEC.md §3.4, modeled on Raycast's own conflict
// UX) lives here too, via internal/domain/trigger.CheckConflict --
// AssignHotkey rejects a combo already claimed by a different workflow
// instead of silently letting two workflows share one.
type TriggerService struct {
	mu     sync.Mutex
	active map[string]*activeListener // workflowID -> live listener
	hkRaw  map[string]persistedHotkey // workflowID -> persisted (mods, key)
	comp   *CompositionService
	logger *slog.Logger
	store  settings.Store
}

func NewTriggerService(comp *CompositionService, logger *slog.Logger, store settings.Store) *TriggerService {
	s := &TriggerService{
		active: make(map[string]*activeListener),
		hkRaw:  make(map[string]persistedHotkey),
		comp:   comp,
		logger: logger,
		store:  store,
	}
	s.loadPersistedHotkeys()
	return s
}

func (s *TriggerService) loadPersistedHotkeys() {
	raw, ok := s.store.Get(triggerHotkeyBindingsKey).(string)
	if !ok || raw == "" {
		return
	}
	var persisted map[string]persistedHotkey
	if err := json.Unmarshal([]byte(raw), &persisted); err != nil {
		s.logger.Error("failed to unmarshal persisted trigger hotkey bindings", "error", err)
		return
	}
	s.hkRaw = persisted
}

func (s *TriggerService) persistHotkeys() {
	s.mu.Lock()
	raw := make(map[string]persistedHotkey, len(s.hkRaw))
	for k, v := range s.hkRaw {
		raw[k] = v
	}
	s.mu.Unlock()

	data, err := json.Marshal(raw)
	if err != nil {
		s.logger.Error("failed to marshal trigger hotkey bindings for persistence", "error", err)
		return
	}
	if err := s.store.Set(triggerHotkeyBindingsKey, string(data)); err != nil {
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
		nodeTypeID, config, ok := trigger.ExtractTrigger(wf)
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
func (s *TriggerService) fire(workflowID, binding string) {
	result, err := s.comp.RunWorkflow(workflowID)
	if err != nil {
		s.logger.Error("triggered workflow failed", "workflow", workflowID, "error", err)
		emitHotkeyActivity(workflowID, binding, false, err.Error(), "")
		return
	}
	s.logger.Info("triggered workflow completed", "workflow", workflowID, "output_bytes", len(result))
	emitHotkeyActivity(workflowID, binding, true, fmt.Sprintf("completed (%d bytes)", len(result)), result)
}

// start registers the one live listener nodeTypeID needs, if any --
// trigger-manual needs none (it only ever fires via an explicit Run/Test
// click, never headlessly). Caller (Sync) holds s.mu already.
func (s *TriggerService) start(workflowID, nodeTypeID string, config map[string]string) (*activeListener, error) {
	switch nodeTypeID {
	case "trigger-manual":
		return nil, nil

	case "trigger-hotkey":
		hk, ok := s.hkRaw[workflowID]
		if !ok {
			return nil, nil // no combo assigned yet
		}
		label := formatBinding(hk.Mods, hk.Key)
		b, err := hotkey.Bind(hk.Mods, hk.Key)
		if err != nil {
			return nil, err
		}
		go func(id string) {
			for range b.Keydown() {
				s.fire(id, label)
			}
		}(workflowID)
		return &activeListener{hotkey: b}, nil

	case "trigger-schedule":
		cronExpr := config["cron"]
		if cronExpr == "" {
			return nil, nil
		}
		b, err := schedule.Add(cronExpr, func() { s.fire(workflowID, "") })
		if err != nil {
			return nil, err
		}
		return &activeListener{schedule: b}, nil

	case "trigger-clipboard-watch":
		stop := clipboard.WatchChanges(2*time.Second, func() { s.fire(workflowID, "") })
		return &activeListener{clipStop: stop}, nil

	case "trigger-filesystem-watch":
		path := config["path"]
		if path == "" {
			return nil, nil
		}
		b, err := filewatch.Watch(path, func() { s.fire(workflowID, "") })
		if err != nil {
			return nil, err
		}
		return &activeListener{fileWatch: b}, nil

	default:
		return nil, fmt.Errorf("unknown trigger node type: %s", nodeTypeID)
	}
}

// AssignHotkey binds workflowID to (mods, key). Rejects the assignment
// if a different workflow already holds that exact combo (SPEC.md
// §3.4's exclusivity rule) instead of silently letting both fire on the
// same keypress -- the frontend surfaces the conflict and the owning
// workflow's name, offering "pick another" (the common path) or
// explicitly unassigning the other workflow first to steal it, matching
// Raycast's own real conflict UX.
func (s *TriggerService) AssignHotkey(workflowID string, mods []string, key string) (string, error) {
	if len(mods) == 0 {
		return "", fmt.Errorf("at least one modifier (cmd/ctrl/shift/option) is required")
	}

	s.mu.Lock()
	existing := make([]trigger.HotkeyBinding, 0, len(s.hkRaw))
	for id, hk := range s.hkRaw {
		existing = append(existing, trigger.HotkeyBinding{WorkflowID: id, Mods: hk.Mods, Key: hk.Key})
	}
	s.mu.Unlock()

	if conflictID, found := trigger.CheckConflict(existing, mods, key, workflowID); found {
		label := conflictID
		if wf, ok := s.findWorkflow(conflictID); ok {
			label = wf.Label
		}
		return "", fmt.Errorf("this combo is already bound to %q -- pick another, or unassign it there first", label)
	}

	// Validate the combo actually registers (permission granted, not
	// already claimed by another app) before persisting it. Only a
	// probe: Sync below does the real, tracked registration, so this is
	// unbound again immediately.
	probe, err := hotkey.Bind(mods, key)
	if err != nil {
		if errors.Is(err, hotkey.ErrRegisterFailed) {
			return "", fmt.Errorf("this Mac hasn't granted Mill Accessibility permission yet (System Settings → Privacy & Security → Accessibility), or the combo is already taken by another app: %w", err)
		}
		return "", err
	}
	_ = probe.Unbind()

	s.mu.Lock()
	s.hkRaw[workflowID] = persistedHotkey{Mods: mods, Key: key}
	s.mu.Unlock()
	s.persistHotkeys()
	s.logger.Info("trigger hotkey assigned", "workflow", workflowID, "binding", formatBinding(mods, key))

	s.Sync(s.comp.Workflows())

	return formatBinding(mods, key), nil
}

// UnassignHotkey removes workflowID's hotkey binding, if it has one.
func (s *TriggerService) UnassignHotkey(workflowID string) {
	s.mu.Lock()
	_, existed := s.hkRaw[workflowID]
	delete(s.hkRaw, workflowID)
	s.mu.Unlock()

	if !existed {
		return
	}
	s.persistHotkeys()
	s.logger.Info("trigger hotkey unassigned", "workflow", workflowID)
	s.Sync(s.comp.Workflows())
}

// ListHotkeys returns every workflow ID with an assigned hotkey, mapped
// to its human-readable binding label (e.g. "⌘⇧M").
func (s *TriggerService) ListHotkeys() map[string]string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[string]string, len(s.hkRaw))
	for id, hk := range s.hkRaw {
		out[id] = formatBinding(hk.Mods, hk.Key)
	}
	return out
}

func (s *TriggerService) findWorkflow(id string) (composition.Workflow, bool) {
	for _, wf := range s.comp.Workflows() {
		if wf.ID == id {
			return wf, true
		}
	}
	return composition.Workflow{}, false
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
	application.Get().Event.Emit("hotkey-activity", HotkeyActivity{
		WorkflowID: workflowID,
		Binding:    binding,
		Success:    success,
		Detail:     detail,
		Result:     result,
	})
}
