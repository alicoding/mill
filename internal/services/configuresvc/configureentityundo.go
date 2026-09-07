package configuresvc

import (
	"github.com/alicoding/mill/internal/services/entitystore"
	"github.com/alicoding/mill/internal/services/seeding"
)

// A Configure entity delete is a step on the app's ONE actor-scoped
// undo journal (ADR-0044), sitting in the same history as the board's
// and the List rows' own steps (configurelistundo.go holds those
// families), in the order the user made them. One entry family:
//
//   - configure-entity {kind, id, record} -- a whole entity deleted.
//     The record rides inside the restore closure entitystore's recover
//     path already builds for the delete, so undo puts back exactly
//     what was there, id intact, through that unrecorded core; redo
//     deletes again through the same removal the door ran (minus the
//     journal and the toast buffer).
//
// The restore half announces the change through the deleting door's
// own notifier: entitystore's restorer persists but never emits, and
// every open surface refreshes off the family's event, so an undo
// applied with nobody watching would otherwise leave a restored entity
// invisible until the next poll.

// registerEntityDelete gives one Configure delete both of its ways
// back: the toast buffer behind UndoDelete (a restart-forgetting,
// age-bounded affordance) and the journal's configure-entity entry
// popped by ⌘Z. The journal undo wraps the door's own restore closure
// with announce, since the closure itself never emits (see above).
// Nil-wired recorder (a test or headless build) leaves the buffer
// behavior exactly as before.
func (c *ConfigureService) registerEntityDelete(kind, id, label string, restore func() error, redelete func() error, announce func(id string)) {
	c.undo.remember(kind, id, restore)
	if c.recordUndo == nil {
		return
	}
	c.recordUndo("configure-entity", kind+"/"+id, label, "",
		func() error {
			if err := restore(); err != nil {
				return err
			}
			announce(id)
			return nil
		},
		redelete,
	)
}

// deleteEntity is the one entitystore-backed delete door body (goal
// 0352 part 2, ADR-0044's amendment): every Configure kind's DeleteXxx
// was the same precheck + tombstoned removal + journal registration +
// announce, copied eleven times. kind is BOTH the configure-entity
// journal family qualifier and the announce closure's entity family;
// getLabel extracts the record's own label for the journal entry.
// Removal and its built-in tombstone must succeed together
// (docs/goals/0025 item 2), so an untombstoned removal can never
// silently come back on the next restart's top-up seeding.
func deleteEntity[T any](c *ConfigureService, kind string, items *[]T, persist func() error, d entitystore.Descriptor[T], precheck func(id string) error, getLabel func(T) string, announce func(id string), id string) error {
	if precheck != nil {
		if err := precheck(id); err != nil {
			return err
		}
	}
	recordTombstone := func(id string) error { return seeding.RecordTombstone(c.store, id) }
	clearTombstone := func(id string) error { return seeding.ClearTombstone(c.store, id) }
	restore, removed, err := entitystore.DeleteRecoverable(&c.mu, items, persist, recordTombstone, clearTombstone, d, id)
	if err != nil {
		return err
	}
	c.registerEntityDelete(kind, id, getLabel(removed), restore,
		entityDeleteRedo(c, d, items, persist, precheck, announce, id), announce)
	announce(id)
	return nil
}

// entityDeleteRedo builds a configure-entity redo closure: re-run the
// same removal the door ran -- precheck, tombstone, persist -- minus
// the two undo registrations (the journal suppresses recordings made
// during replay; the buffer belongs to a fresh gesture, not a replay).
// announce is the door's own change notifier, so a redone delete
// reaches every surface the gesture's delete reached.
func entityDeleteRedo[T any](c *ConfigureService, d entitystore.Descriptor[T], items *[]T, persist func() error, precheck func(id string) error, announce func(id string), id string) func() error {
	return func() error {
		if precheck != nil {
			if err := precheck(id); err != nil {
				return err
			}
		}
		recordTombstone := func(id string) error { return seeding.RecordTombstone(c.store, id) }
		clearTombstone := func(id string) error { return seeding.ClearTombstone(c.store, id) }
		if _, _, err := entitystore.DeleteRecoverable(&c.mu, items, persist, recordTombstone, clearTombstone, d, id); err != nil {
			return err
		}
		announce(id)
		return nil
	}
}
