package guardrailsvc

// The read/query half of the durable pending-action store
// (guardrailservice_pendingstore.go): the courtesy-window waiter, every
// read-only surface, and the one-shot legacy-key migration -- split out
// once the store file approached the 500-line convention (CLAUDE.md/
// §1.3), the same "split along a real seam" discipline
// millmcpservice_approval_query.go already established for the
// mechanism this replaces.

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"time"

	"github.com/alicoding/mill/internal/adapters/settings"
)

// AwaitDecision blocks until id's pending record is resolved (Resolve/
// Withdraw) or timeout elapses -- decided=false on timeout means the
// record is STILL PARKED (durable, pollable later via Get/Poll), never
// removed by this call. Used cross-package (mcpsvc's own courtesy
// window); RequestGuardedAction uses decisionChan directly instead (a
// single flat select alongside its own ctx-cancel path, no bridging
// goroutine). Uses defaultGuardedActionRetention for its own internal
// Get once woken -- a decision that just fired is always well inside
// any real retention window, so this never actually filters anything
// out; retention only matters for a LATER poll, which goes through the
// caller's own Get/Poll call with its own stated window.
func (s *PendingActionStore) AwaitDecision(id string, timeout time.Duration) (GuardedActionRecord, bool) {
	s.mu.Lock()
	rec, ok := s.records[id]
	s.mu.Unlock()
	if !ok {
		return GuardedActionRecord{}, false
	}
	select {
	case <-rec.decision:
		return s.Get(id, defaultGuardedActionRetention)
	case <-time.After(timeout):
		return GuardedActionRecord{}, false
	}
}

// Get returns id's current snapshot (pending or resolved), sweeping
// lazily first with the caller's own stated retention window.
func (s *PendingActionStore) Get(id string, retention time.Duration) (GuardedActionRecord, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweepLocked(time.Now(), retention)
	rec, ok := s.records[id]
	if !ok {
		return GuardedActionRecord{}, false
	}
	return snapshotGuardedAction(rec), true
}

// Poll returns id's current snapshot and bumps LastPolledAt -- a status
// read IS the requester's own heartbeat (docs/goals/0026 item 3,
// generalized), so every real poll updates and persists it. The second
// return is every record the sweep just expired, for the caller to
// report onward, same as Pending/Resolved.
func (s *PendingActionStore) Poll(id string, retention time.Duration) (rec GuardedActionRecord, ok bool, expired []GuardedActionRecord) {
	s.mu.Lock()
	expired = s.sweepLocked(time.Now(), retention)
	target, found := s.records[id]
	if !found {
		s.mu.Unlock()
		return GuardedActionRecord{}, false, expired
	}
	now := time.Now()
	target.LastPolledAt = &now
	if err := s.persistLocked(); err != nil {
		slog.Error("failed to persist guarded-action poll timestamp", "error", err)
	}
	out := snapshotGuardedAction(target)
	s.mu.Unlock()
	return out, true, expired
}

// Pending lists every currently-pending record whose Kind matches
// (kind=="" matches every kind), oldest first, sweeping lazily first
// with the caller's own stated retention window. The second return is
// every record the sweep just expired, for the caller to report onward.
func (s *PendingActionStore) Pending(kind string, retention time.Duration) (records []GuardedActionRecord, expired []GuardedActionRecord) {
	s.mu.Lock()
	expired = s.sweepLocked(time.Now(), retention)
	for _, rec := range s.records {
		if rec.Status == GuardedActionPending && (kind == "" || rec.Kind == kind) {
			records = append(records, snapshotGuardedAction(rec))
		}
	}
	s.mu.Unlock()
	sort.Slice(records, func(i, j int) bool { return records[i].CreatedAt.Before(records[j].CreatedAt) })
	return records, expired
}

// Resolved lists every already-resolved record still within the
// retention window, Kind-filtered like Pending, newest-resolved first.
func (s *PendingActionStore) Resolved(kind string, retention time.Duration) (records []GuardedActionRecord, expired []GuardedActionRecord) {
	s.mu.Lock()
	expired = s.sweepLocked(time.Now(), retention)
	for _, rec := range s.records {
		if rec.Status == GuardedActionPending || rec.ResolvedAt == nil {
			continue
		}
		if kind == "" || rec.Kind == kind {
			records = append(records, snapshotGuardedAction(rec))
		}
	}
	s.mu.Unlock()
	sort.Slice(records, func(i, j int) bool { return records[i].ResolvedAt.After(*records[j].ResolvedAt) })
	return records, expired
}

// Backdate is an e2e-only test knob mirroring mcpsvc's own (retired)
// DebugBackdatePendingWrite -- shifts a pending record's CreatedAt back
// so age-tiered UI can be exercised without sleeping real hours.
func (s *PendingActionStore) Backdate(id string, ageMinutes int) error {
	s.mu.Lock()
	rec, ok := s.records[id]
	if !ok {
		s.mu.Unlock()
		return fmt.Errorf("no guarded action with id %s", id)
	}
	if rec.Status != GuardedActionPending {
		s.mu.Unlock()
		return fmt.Errorf("guarded action %s is not pending", id)
	}
	rec.CreatedAt = time.Now().Add(-time.Duration(ageMinutes) * time.Minute)
	err := s.persistLocked()
	s.mu.Unlock()
	return err
}

// LegacyGuardedAction is the generic shape MergeLegacyPendingActions
// imports records from -- a caller owning an old, pre-migration key
// (mcpsvc's retired mcpPendingWritesKey/MCPWriteRecord) converts its
// own legacy JSON into this shape and hands it here, so this package
// never has to know the legacy shape it came from.
type LegacyGuardedAction struct {
	ID           string
	Kind         string
	Description  string
	Source       string
	CreatedAt    time.Time
	Status       GuardedActionStatus
	Payload      []byte
	ResultText   string
	Error        string
	ResolvedAt   *time.Time
	LastPolledAt *time.Time
}

// MergeLegacyPendingActions is a one-shot upgrade path (docs/adr/0047
// §5.4's follow-up): reads store's CURRENT guardedPendingActionsKey
// blob directly (bypassing any live PendingActionStore instance -- this
// must run before ANY PendingActionStore is constructed against store,
// so nothing has already loaded a stale pre-migration view into
// memory), merges legacy in by ID (never overwriting an existing new-
// format record with the same ID), and persists the merged result.
// Callers own clearing their own old key afterward once this returns
// successfully (mcpsvc's MigrateLegacyPendingWrites does exactly that)
// -- this function only ever touches the NEW key.
func MergeLegacyPendingActions(store settings.Store, legacy map[string]LegacyGuardedAction) error {
	if len(legacy) == 0 {
		return nil
	}
	current := map[string]*GuardedActionRecord{}
	if raw, ok := store.Get(guardedPendingActionsKey).(string); ok && raw != "" {
		if err := json.Unmarshal([]byte(raw), &current); err != nil {
			return fmt.Errorf("merge legacy pending actions: decode current: %w", err)
		}
	}
	for id, l := range legacy {
		if _, exists := current[id]; exists {
			continue
		}
		current[id] = &GuardedActionRecord{
			ID: l.ID, Kind: l.Kind, Description: l.Description, Source: l.Source,
			CreatedAt: l.CreatedAt, Status: l.Status, Payload: l.Payload,
			ResultText: l.ResultText, Error: l.Error, ResolvedAt: l.ResolvedAt, LastPolledAt: l.LastPolledAt,
		}
	}
	data, err := json.Marshal(current)
	if err != nil {
		return fmt.Errorf("merge legacy pending actions: encode: %w", err)
	}
	if err := store.Set(guardedPendingActionsKey, string(data)); err != nil {
		return fmt.Errorf("merge legacy pending actions: persist: %w", err)
	}
	return nil
}
