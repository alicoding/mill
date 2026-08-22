// Package notificationsvc owns the notification spine's durable
// storage and the single Publish entry point (docs/goals/0171-
// notification-spine.md): persist first, then fan out to whichever
// registered Channel wants this event. Persistence rides
// internal/services/entitystore (goal 0165's shared Descriptor
// machinery, the same one every Configure entity kind already uses) --
// this package adds no new storage mechanism. Channel implementations
// live wherever they already own the mechanics they wrap
// (settingssvc's desktop banner/dock bounce/browser-tab gate) and are
// registered here via RegisterChannel at wiring time, never imported
// directly -- keeps this package free of OS/adapter dependencies.
package notificationsvc

import (
	"fmt"
	"log/slog"
	"slices"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/domain/notification"
	"github.com/alicoding/mill/internal/services/entitystore"
	"github.com/google/uuid"
)

// notificationRecordsKey persists every Record as one JSON blob -- the
// same one-atomic-blob-per-key shape every other settings.Store
// consumer in this repo uses (millmcpservice_approval.go's
// mcpPendingWritesKey, configuresvc's per-entity keys).
const notificationRecordsKey = "notification-records"

// recordDescriptor is entitystore.Descriptor's minimal populated shape
// for Record: only Label/GetID are set because Insert/Update/Persist
// (the functions this package actually calls) only read those two
// fields -- the seed/tombstone/reconcile fields (IsBuiltIn, GetSeed,
// SetSeed, StampNew, Upgrade, BuiltIn) stay at their zero value on
// purpose. Notifications are not seeded golden artifacts, so that half
// of entitystore's Descriptor genuinely does not apply here; wiring it
// up with placeholder implementations would be shape-fitting for its
// own sake, not real reuse.
var recordDescriptor = entitystore.Descriptor[notification.Record]{
	Label: "notification",
	GetID: func(r notification.Record) string { return r.ID },
}

// NotificationService is the Wails-bound owner of the notification
// spine: the persisted Record slice and the registered Channel list
// Publish fans out to.
type NotificationService struct {
	mu       sync.Mutex
	store    settings.Store
	records  []notification.Record
	channels []notification.Channel
}

// New constructs a NotificationService and loads any previously
// persisted records -- callers register channels afterward via
// RegisterChannel (main.go's wiring step, once the services those
// channels wrap also exist).
func New(store settings.Store) *NotificationService {
	s := &NotificationService{store: store}
	entitystore.Load(&s.mu, &s.records, store, notificationRecordsKey)
	return s
}

// RegisterChannel adds ch to the fan-out list Publish consults --
// panics on a duplicate Name, same fail-fast-at-startup semantics
// composition.RegisterNodeType already uses for its own registry
// (registry.go): a naming collision between two channels is a wiring
// bug, worth crashing on immediately rather than silently shadowing
// one of them. Wiring-time only (main.go, via wiring.WireNotificationChannels);
// never a frontend RPC (its own interface-typed parameter isn't
// JSON-serializable in a way the generated bindings could call anyway).
//
//wails:ignore
func (s *NotificationService) RegisterChannel(ch notification.Channel) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, existing := range s.channels {
		if existing.Name() == ch.Name() {
			panic("notificationsvc: channel " + ch.Name() + " registered twice")
		}
	}
	s.channels = append(s.channels, ch)
}

// PublishResult is Publish's return shape: the durable Record (created
// fresh, or the existing one a repeat DedupeKey resolved to) plus which
// channel names newly delivered on THIS call specifically -- distinct
// from Record.DeliveredChannels' cumulative history, since a caller
// (e.g. the browser-tab channel's own frontend half) needs to know
// whether ITS delivery just happened, not the record's full history.
type PublishResult struct {
	Record    notification.Record `json:"record"`
	Delivered []string            `json:"delivered"`
}

// persist snapshots s.records to the settings store -- entitystore.
// Persist's own body, exposed as a method since every mutator below
// needs it as a persist func value.
func (s *NotificationService) persist() error {
	return entitystore.Persist(&s.mu, &s.records, s.store, notificationRecordsKey, recordDescriptor)
}

// findByDedupeKeyLocked returns a copy of the record matching
// dedupeKey, if any -- caller must hold s.mu.
func (s *NotificationService) findByDedupeKeyLocked(dedupeKey string) (notification.Record, bool) {
	for _, r := range s.records {
		if r.DedupeKey == dedupeKey {
			return r, true
		}
	}
	return notification.Record{}, false
}

// Publish is the notification spine's one entry point (docs/goals/0171
// item 2): PERSISTS FIRST, then fans out. A repeat call for a
// DedupeKey that already has a Record does not create a second one --
// it resolves to the existing Record and re-attempts only the channels
// that haven't delivered it yet, which is what makes Publish safe to
// call from more than one producer for the same logical event (a
// backend origination point and a frontend caller both naming the same
// DedupeKey) without double-delivering through either channel.
//
// The existence check and the insert-if-absent below are one hand-
// written critical section rather than a call to entitystore.Insert:
// Insert acquires its own lock internally, so calling it while already
// holding s.mu (needed to make "check, then insert" atomic) would
// deadlock on Go's non-reentrant sync.Mutex. This is the one place
// entitystore's generic shape does not fit -- Insert is an
// unconditional-append primitive, and Publish needs insert-if-absent.
// entitystore.Persist/Update/Load are still used for everything else
// below.
func (s *NotificationService) Publish(evt notification.Event) (PublishResult, error) {
	if evt.Type == "" || evt.DedupeKey == "" {
		return PublishResult{}, fmt.Errorf("publish notification: type and dedupeKey are required")
	}

	s.mu.Lock()
	rec, existed := s.findByDedupeKeyLocked(evt.DedupeKey)
	if !existed {
		rec = notification.Record{
			ID: uuid.NewString(), Type: evt.Type, Title: evt.Title, Body: evt.Body,
			DedupeKey: evt.DedupeKey, SourceRef: evt.SourceRef, CreatedAt: time.Now(),
		}
		s.records = append(s.records, rec)
	}
	s.mu.Unlock()

	if !existed {
		if err := s.persist(); err != nil {
			s.mu.Lock()
			s.records = removeByID(s.records, rec.ID)
			s.mu.Unlock()
			return PublishResult{}, fmt.Errorf("publish notification: %w", err)
		}
	}

	s.mu.Lock()
	channels := slices.Clone(s.channels)
	alreadyDelivered := slices.Clone(rec.DeliveredChannels)
	s.mu.Unlock()

	var justDelivered []string
	for _, ch := range channels {
		if slices.Contains(alreadyDelivered, ch.Name()) {
			continue
		}
		if !ch.ShouldDeliver(evt) {
			continue
		}
		if err := ch.Deliver(evt, rec); err != nil {
			slog.Warn("notification channel delivery failed", "channel", ch.Name(), "id", rec.ID, "error", err)
			continue
		}
		chName := ch.Name()
		updated, err := entitystore.Update(&s.mu, &s.records, s.persist, recordDescriptor, rec.ID, func(existing notification.Record) (notification.Record, error) {
			existing.DeliveredChannels = append(existing.DeliveredChannels, chName)
			return existing, nil
		})
		if err != nil {
			slog.Warn("persist notification delivery", "channel", chName, "id", rec.ID, "error", err)
			continue
		}
		rec = updated
		justDelivered = append(justDelivered, chName)
	}
	return PublishResult{Record: rec, Delivered: justDelivered}, nil
}

// removeByID drops the entry with id, if any -- Publish's own
// insert-then-persist-failure rollback (docs/goals/0025 item 2's
// memory-vs-store rule: a persist failure must not leave a phantom
// in-memory record a restart would silently drop).
func removeByID(records []notification.Record, id string) []notification.Record {
	for i, r := range records {
		if r.ID == id {
			return append(records[:i], records[i+1:]...)
		}
	}
	return records
}

// ListNotifications returns every persisted Record, newest first --
// the read side of the silent-loss fix (docs/goals/0171): an event
// published with no window/tab open is still here once one opens.
func (s *NotificationService) ListNotifications() []notification.Record {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]notification.Record, len(s.records))
	copy(out, s.records)
	slices.Reverse(out)
	return out
}

// MarkRead stamps id's ReadAt to now, a no-op if it's already set --
// idempotent so a duplicate click/retry never overwrites an earlier
// real read time with a later one.
func (s *NotificationService) MarkRead(id string) error {
	now := time.Now()
	_, err := entitystore.Update(&s.mu, &s.records, s.persist, recordDescriptor, id, func(existing notification.Record) (notification.Record, error) {
		if existing.ReadAt == nil {
			existing.ReadAt = &now
		}
		return existing, nil
	})
	return err
}
