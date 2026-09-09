package atlassvc

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/services/seeding"
)

// PluginCanvasObjectExample is what the plugin surface exposes about
// one valid plugin's declared canvasObjects[].example (goal 0411,
// docs/goals/0411 Amendment) -- atlassvc's own reconcile below seeds
// Board gallery from this shape without importing pluginsvc itself;
// wiring.go is the one seam that knows both sides and adapts
// pluginsvc.CanvasObjectExampleClaim into this struct.
type PluginCanvasObjectExample struct {
	Kind     string
	Title    string
	Payload  map[string]string
	Revision int
	Fixtures []PluginCanvasObjectExampleFixture
}

// PluginCanvasObjectExampleFixture mirrors
// pluginsvc.CanvasObjectExampleFixture -- see that type's own comment
// for the field contract. Kind is always "note" today.
type PluginCanvasObjectExampleFixture struct {
	Kind       string
	Body       string
	PayloadKey string
}

// pluginExampleNoteID and pluginExampleObjectID are the deterministic
// ids a plugin example's own gallery golden and fixture note reconcile
// against -- stable across reconcile passes so a second pass never
// re-inserts a duplicate, distinct in shape from seeding.NewSlugID's
// randomized ids so neither can ever collide with user-created content.
func pluginExampleObjectID(kind string) string {
	return "atlas-object-example-plugin-" + kind
}

func pluginExampleNoteID(kind string, fixtureIndex int) string {
	return fmt.Sprintf("atlas-note-example-plugin-%s-%d", kind, fixtureIndex)
}

// ReconcilePluginCanvasObjectExamples seeds every declared plugin
// example into Board gallery (atlas.BoardGalleryCardID) -- called once
// after PluginService has scanned its manifests (wiring.go), the same
// "re-run reconcile once a dependency becomes available" shape
// SetCapturesDir already established (atlasservice_imagecapture.go),
// since plugin scanning happens after NewAtlasService's own
// construction-time reconcile. A fixture note is created first, by a
// stable id, ONLY if no note with that id exists yet and it was never
// tombstoned by a user delete -- Note carries no BuiltIn/Seed
// provenance by its own LOCKED design (atlasnote.go's header comment),
// so a fixture note is ordinary, freely editable/deletable user
// content from the moment it lands, never revision-upgraded in place
// the way the object golden below is. The object golden's Payload gets
// each fixture's created id injected at its own PayloadKey merged with
// the declared Payload -- the exact shape the live insert door
// (frontend's atlasThirdPartyPlacement.ts) produces, so gallery and
// insert share one payload shape, two callers.
//
//wails:ignore
func (a *AtlasService) ReconcilePluginCanvasObjectExamples(examples []PluginCanvasObjectExample) {
	if len(examples) == 0 {
		return
	}
	tombstones := seeding.LoadTombstones(a.store)
	now := time.Now()
	a.mu.Lock()
	changed := false
	for i, ex := range examples {
		changed = a.reconcilePluginExampleLocked(ex, i, tombstones, now) || changed
	}
	if changed {
		if err := a.persistLocked(); err != nil {
			slog.Error("failed to reconcile plugin canvas-object examples", "error", err)
		}
	}
	a.mu.Unlock()
}

// reconcilePluginExampleLocked reconciles one declared example: its
// fixture notes (insert-if-absent, never upgraded), then its own
// board-object golden (insert/upgrade/leave-alone/skip-tombstoned,
// the same algorithm reconcileObjectsLocked runs for built-ins).
// index positions this example's own gallery slot -- a stable, plugin-
// kind-keyed row below every built-in golden's own footprint (the
// lowest, table, ends at Y:1000+, boardobject_builtin.go's own
// comment). Caller must hold a.mu.
func (a *AtlasService) reconcilePluginExampleLocked(ex PluginCanvasObjectExample, index int, tombstones map[string]bool, now time.Time) bool {
	changed := false
	payload := copyPayload(ex.Payload)
	if payload == nil {
		payload = map[string]string{}
	}
	payload["title"] = ex.Title
	for i, fixture := range ex.Fixtures {
		noteID := pluginExampleNoteID(ex.Kind, i)
		changed = a.reconcilePluginExampleNoteLocked(noteID, fixture, tombstones, now) || changed
		payload[fixture.PayloadKey] = noteID
	}
	golden := atlas.BoardObject{
		ID: pluginExampleObjectID(ex.Kind), Kind: ex.Kind,
		Payload:   payload,
		Position:  atlas.Position{X: 80 + float64(index%3)*240, Y: 1400 + float64(index/3)*280},
		ParentID:  atlas.BoardGalleryCardID,
		CreatedAt: now, UpdatedAt: now,
		BuiltIn: true, Seed: seedorigin.Stamp(ex.Revision),
	}
	byID := make(map[string]int, len(a.objects))
	for i, o := range a.objects {
		byID[o.ID] = i
	}
	idx, present := byID[golden.ID]
	if !present {
		if tombstones[golden.ID] {
			return changed
		}
		a.objects = append(a.objects, golden)
		return true
	}
	existing := a.objects[idx]
	if !existing.DeletedAt.IsZero() {
		return changed
	}
	if existing.Seed.SeedRevision == 0 {
		existing.Seed = seedorigin.Origin{SeedRevision: golden.Seed.SeedRevision, Modified: true}
		a.objects[idx] = existing
		return true
	}
	if existing.Seed.Modified {
		return changed
	}
	if existing.Seed.SeedRevision < golden.Seed.SeedRevision {
		golden.CreatedAt, golden.UpdatedAt = existing.CreatedAt, now
		golden.Seed = seedorigin.Stamp(golden.Seed.SeedRevision)
		a.objects[idx] = golden
		return true
	}
	return changed
}

// reconcilePluginExampleNoteLocked inserts one fixture note by its
// stable id, ONLY when absent and never tombstoned -- see this file's
// own header comment for why a fixture note carries no upgrade path.
func (a *AtlasService) reconcilePluginExampleNoteLocked(noteID string, fixture PluginCanvasObjectExampleFixture, tombstones map[string]bool, now time.Time) bool {
	if tombstones[noteID] {
		return false
	}
	for _, n := range a.notes {
		if n.ID == noteID {
			return false
		}
	}
	a.notes = append(a.notes, atlas.Note{
		ID: noteID, Text: fixture.Body, ParentID: atlas.BoardGalleryCardID,
		CreatedAt: now, UpdatedAt: now,
	})
	return true
}
