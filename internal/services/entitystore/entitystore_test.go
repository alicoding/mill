package entitystore

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/services/seeding"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// widget is a minimal stand-in entity for exercising the generic
// store in isolation -- the real entity kinds (execenv.ExecEnv,
// decision.Decision, ...) are proven by configuresvc's own,
// unmodified tests once wired to a Descriptor.
type widget struct {
	ID        string
	Label     string
	BuiltIn   bool
	Seed      seedorigin.Origin
	CreatedAt time.Time
	UpdatedAt time.Time
}

func upgradeWidget(existing, golden widget, now time.Time) widget {
	golden.CreatedAt = existing.CreatedAt
	golden.UpdatedAt = now
	golden.Seed = seedorigin.Stamp(golden.Seed.SeedRevision)
	return golden
}

func widgetDescriptor(builtIn func() []widget) Descriptor[widget] {
	return Descriptor[widget]{
		Label:     "widget",
		GetID:     func(w widget) string { return w.ID },
		IsBuiltIn: func(w widget) bool { return w.BuiltIn },
		GetSeed:   func(w widget) seedorigin.Origin { return w.Seed },
		SetSeed:   func(w widget, s seedorigin.Origin) widget { w.Seed = s; return w },
		StampNew: func(w widget, now time.Time) widget {
			w.CreatedAt, w.UpdatedAt = now, now
			return w
		},
		Upgrade: upgradeWidget,
		BuiltIn: builtIn,
	}
}

func TestReconcile_InsertsUntombstonedAbsentGolden(t *testing.T) {
	golden := widget{ID: "w1", Label: "v1", BuiltIn: true, Seed: seedorigin.Stamp(1)}
	items := []widget{}
	var mu sync.Mutex

	inserted, changed := Reconcile(&mu, &items, nil, widgetDescriptor(func() []widget { return []widget{golden} }))

	if !changed || len(inserted) != 1 || inserted[0].ID != "w1" {
		t.Fatalf("Reconcile() inserted=%v changed=%v, want one insert", inserted, changed)
	}
	if len(items) != 1 || items[0].CreatedAt.IsZero() {
		t.Fatalf("Reconcile() left items=%v, want the golden inserted with a stamped CreatedAt", items)
	}
}

func TestReconcile_SkipsTombstonedAbsentGolden(t *testing.T) {
	golden := widget{ID: "w1", BuiltIn: true, Seed: seedorigin.Stamp(1)}
	items := []widget{}
	var mu sync.Mutex

	_, changed := Reconcile(&mu, &items, map[string]bool{"w1": true}, widgetDescriptor(func() []widget { return []widget{golden} }))

	if changed || len(items) != 0 {
		t.Fatalf("Reconcile() over a tombstoned golden changed=%v items=%v, want no insert", changed, items)
	}
}

func TestReconcile_UpgradesUnmodifiedStaleExisting(t *testing.T) {
	existing := widget{ID: "w1", Label: "old", Seed: seedorigin.Stamp(1), CreatedAt: time.Unix(0, 0)}
	golden := widget{ID: "w1", Label: "new", Seed: seedorigin.Stamp(2)}
	items := []widget{existing}
	var mu sync.Mutex

	_, changed := Reconcile(&mu, &items, nil, widgetDescriptor(func() []widget { return []widget{golden} }))

	if !changed || items[0].Label != "new" || items[0].Seed.SeedRevision != 2 || !items[0].CreatedAt.Equal(existing.CreatedAt) {
		t.Fatalf("Reconcile() upgrade = %+v, want new content at rev 2 with CreatedAt preserved", items[0])
	}
}

func TestReconcile_LeavesModifiedExistingAlone(t *testing.T) {
	existing := widget{ID: "w1", Label: "user-edited", Seed: seedorigin.Origin{SeedRevision: 1, Modified: true}}
	golden := widget{ID: "w1", Label: "new", Seed: seedorigin.Stamp(2)}
	items := []widget{existing}
	var mu sync.Mutex

	_, changed := Reconcile(&mu, &items, nil, widgetDescriptor(func() []widget { return []widget{golden} }))

	if changed || items[0].Label != "user-edited" {
		t.Fatalf("Reconcile() over a Modified existing changed=%v item=%+v, want left alone", changed, items[0])
	}
}

func TestReconcile_MigrationStampsPreGoal0037Entry(t *testing.T) {
	existing := widget{ID: "w1", Label: "predates seed tracking"} // Seed is zero-value
	golden := widget{ID: "w1", Label: "new", Seed: seedorigin.Stamp(3)}
	items := []widget{existing}
	var mu sync.Mutex

	_, changed := Reconcile(&mu, &items, nil, widgetDescriptor(func() []widget { return []widget{golden} }))

	if !changed || items[0].Label != "predates seed tracking" || !items[0].Seed.Modified || items[0].Seed.SeedRevision != 3 {
		t.Fatalf("Reconcile() migration-stamp = %+v, want content untouched, Modified true, revision 3", items[0])
	}
}

func TestInsert_RollsBackOnPersistFailure(t *testing.T) {
	items := []widget{}
	var mu sync.Mutex
	d := widgetDescriptor(nil)
	wantErr := errors.New("disk full")

	err := Insert(&mu, &items, func() error { return wantErr }, d, widget{ID: "w1"})

	if err == nil || len(items) != 0 {
		t.Fatalf("Insert() err=%v items=%v, want a wrapped error and no phantom entry", err, items)
	}
}

func TestUpdate_AtomicMutateAndRollback(t *testing.T) {
	items := []widget{{ID: "w1", Label: "old"}}
	var mu sync.Mutex
	d := widgetDescriptor(nil)

	updated, err := Update(&mu, &items, func() error { return nil }, d, "w1", func(existing widget) (widget, error) {
		existing.Label = "new"
		return existing, nil
	})
	if err != nil || updated.Label != "new" || items[0].Label != "new" {
		t.Fatalf("Update() = %+v, err=%v, want the mutated value applied", updated, err)
	}

	// A mutate error must leave the stored value untouched.
	_, err = Update(&mu, &items, func() error { return nil }, d, "w1", func(existing widget) (widget, error) {
		return widget{}, errors.New("validation failed")
	})
	if err == nil || items[0].Label != "new" {
		t.Fatalf("Update() mutate-error left items=%v, want the prior value untouched", items)
	}

	// A persist failure must restore the previous value.
	_, err = Update(&mu, &items, func() error { return errors.New("disk full") }, d, "w1", func(existing widget) (widget, error) {
		existing.Label = "should not stick"
		return existing, nil
	})
	if err == nil || items[0].Label != "new" {
		t.Fatalf("Update() persist-failure left items=%v, want reverted to the pre-update value", items)
	}
}

func TestDeleteWithTombstone_TombstonesBuiltInOnly(t *testing.T) {
	var mu sync.Mutex
	d := widgetDescriptor(nil)
	var tombstoned []string

	items := []widget{{ID: "w1", BuiltIn: true}, {ID: "w2", BuiltIn: false}}
	record := func(id string) error { tombstoned = append(tombstoned, id); return nil }

	if err := DeleteWithTombstone(&mu, &items, func() error { return nil }, record, d, "w1"); err != nil {
		t.Fatalf("DeleteWithTombstone(builtin) error = %v", err)
	}
	if len(tombstoned) != 1 || tombstoned[0] != "w1" {
		t.Fatalf("DeleteWithTombstone(builtin) tombstoned = %v, want [w1]", tombstoned)
	}

	if err := DeleteWithTombstone(&mu, &items, func() error { return nil }, record, d, "w2"); err != nil {
		t.Fatalf("DeleteWithTombstone(non-builtin) error = %v", err)
	}
	if len(tombstoned) != 1 {
		t.Fatalf("DeleteWithTombstone(non-builtin) tombstoned = %v, want no additional tombstone", tombstoned)
	}
}

func TestDeleteWithTombstone_ReinsertsOnPersistFailure(t *testing.T) {
	var mu sync.Mutex
	d := widgetDescriptor(nil)
	items := []widget{{ID: "w1"}, {ID: "w2"}}

	err := DeleteWithTombstone(&mu, &items, func() error { return errors.New("disk full") }, func(string) error { return nil }, d, "w1")

	if err == nil {
		t.Fatal("DeleteWithTombstone() persist failure returned nil error")
	}
	if len(items) != 2 || items[0].ID != "w1" {
		t.Fatalf("DeleteWithTombstone() items=%v after persist failure, want w1 reinserted at its original index", items)
	}
}

func TestResetToSeed_ReplacesContentAndClearsModified(t *testing.T) {
	var mu sync.Mutex
	golden := widget{ID: "w1", Label: "golden", Seed: seedorigin.Stamp(2)}
	d := widgetDescriptor(func() []widget { return []widget{golden} })
	items := []widget{{ID: "w1", Label: "user-edited", Seed: seedorigin.Origin{SeedRevision: 1, Modified: true}}}

	updated, err := ResetToSeed(&mu, &items, func() error { return nil }, d, "w1")

	if err != nil || updated.Label != "golden" || updated.Seed.Modified || updated.Seed.SeedRevision != 2 {
		t.Fatalf("ResetToSeed() = %+v, err=%v, want golden content at rev 2 with Modified cleared", updated, err)
	}
}

func TestResetToSeed_UnknownIDErrors(t *testing.T) {
	var mu sync.Mutex
	items := []widget{}
	d := widgetDescriptor(func() []widget { return nil })

	if _, err := ResetToSeed(&mu, &items, func() error { return nil }, d, "missing"); err == nil {
		t.Fatal("ResetToSeed(missing) returned nil error, want a not-a-built-in error")
	}
}

func TestRestorable_OnlyTombstonedAndAbsent(t *testing.T) {
	var mu sync.Mutex
	golden1 := widget{ID: "w1"}
	golden2 := widget{ID: "w2"}
	d := widgetDescriptor(func() []widget { return []widget{golden1, golden2} })
	items := []widget{{ID: "w2"}} // w2 already present

	out := Restorable(&mu, &items, map[string]bool{"w1": true, "w2": true}, d)

	if len(out) != 1 || out[0].ID != "w1" {
		t.Fatalf("Restorable() = %v, want only w1 (tombstoned and absent)", out)
	}
}

func TestRestore_ClearsTombstoneAndReseeds(t *testing.T) {
	var mu sync.Mutex
	golden := widget{ID: "w1", Label: "golden"}
	d := widgetDescriptor(func() []widget { return []widget{golden} })
	items := []widget{}
	store := servicetest.NewFakeStore()
	if err := seeding.RecordTombstone(store, "w1"); err != nil {
		t.Fatalf("RecordTombstone() error = %v", err)
	}

	restored, err := Restore(&mu, &items, func() error { return nil }, store, d, "w1")

	if err != nil || restored.Label != "golden" || len(items) != 1 {
		t.Fatalf("Restore() = %+v, err=%v, items=%v", restored, err, items)
	}
	tombstones := seeding.LoadTombstones(store)
	if tombstones["w1"] {
		t.Fatal("Restore() left the tombstone set, want it cleared")
	}
}

func TestRestore_RefusesAlreadyPresent(t *testing.T) {
	var mu sync.Mutex
	golden := widget{ID: "w1"}
	d := widgetDescriptor(func() []widget { return []widget{golden} })
	items := []widget{{ID: "w1"}}
	store := servicetest.NewFakeStore()

	if _, err := Restore(&mu, &items, func() error { return nil }, store, d, "w1"); err == nil {
		t.Fatal("Restore() over an already-present entity returned nil error")
	}
}

func TestPersistAndLoad_RoundTrip(t *testing.T) {
	var mu sync.Mutex
	store := servicetest.NewFakeStore()
	d := widgetDescriptor(nil)
	items := []widget{{ID: "w1", Label: "a"}, {ID: "w2", Label: "b"}}

	if err := Persist(&mu, &items, store, "widgets-key", d); err != nil {
		t.Fatalf("Persist() error = %v", err)
	}

	var loaded []widget
	Load(&mu, &loaded, store, "widgets-key")
	if len(loaded) != 2 || loaded[0].ID != "w1" || loaded[1].Label != "b" {
		t.Fatalf("Load() = %v, want the persisted snapshot round-tripped", loaded)
	}
}

func TestLoad_LeavesItemsUntouchedWhenKeyAbsent(t *testing.T) {
	var mu sync.Mutex
	store := servicetest.NewFakeStore()
	items := []widget{{ID: "keep-me"}}

	Load(&mu, &items, store, "never-set")

	if len(items) != 1 || items[0].ID != "keep-me" {
		t.Fatalf("Load() over an absent key mutated items to %v, want untouched", items)
	}
}

func TestDispatchImport_RoutesByIDPresence(t *testing.T) {
	exists := func(id string) bool { return id == "present" }
	update := func() (string, error) { return "updated", nil }
	createWithID := func() (string, error) { return "created-with-id", nil }
	create := func() (string, error) { return "created", nil }

	if got, _ := DispatchImport(exists, "present", update, createWithID, create); got != "updated" {
		t.Errorf("DispatchImport(present id) = %q, want update()", got)
	}
	if got, _ := DispatchImport(exists, "absent", update, createWithID, create); got != "created-with-id" {
		t.Errorf("DispatchImport(absent id) = %q, want createWithID()", got)
	}
	if got, _ := DispatchImport(exists, "", update, createWithID, create); got != "created" {
		t.Errorf("DispatchImport(no id) = %q, want create()", got)
	}
}
