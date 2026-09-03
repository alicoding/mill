package atlassvc

import (
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// SetBoardObjectKind re-types an object in place -- same id, payload,
// position, size, and parent -- so the board's "paste as … instead"
// offer (ADR-0051 slice 2) can hand a just-pasted link from one
// claiming plugin's kind to another's without a delete-and-recreate
// (which would cost the user two undo steps and the object its id).
// Both kinds share the url-source payload contract (url + title), which
// is what makes the payload carry over verbatim; the call itself does
// not police that -- the frontend only ever offers kinds that were
// claimants for the same paste. Undoable as one step.
//
//nolint:dupl // same lock/mutate/persist/emit/recordScalar shape as SetBoardObjectPosition -- see its own dupl note
func (a *AtlasService) SetBoardObjectKind(id, kind string) (atlas.BoardObject, error) {
	if kind == "" {
		return atlas.BoardObject{}, fmt.Errorf("a board object kind is required")
	}
	a.mu.Lock()
	idx := a.findObjectLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.BoardObject{}, fmt.Errorf("no board object with id %q", id)
	}
	previous := a.objects[idx]
	o := previous
	o.Kind = kind
	o.UpdatedAt = time.Now()
	a.objects[idx] = o
	perr := a.persistLocked()
	if perr != nil {
		a.objects[idx] = previous
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.BoardObject{}, fmt.Errorf("save board object kind: %w", perr)
	}
	dataevent.Emit("atlas", o.ID)
	recordScalar(a, actorUI, "object", id, o.Kind,
		func(a *AtlasService, k string) error {
			a.mu.Lock()
			if i := a.findObjectLocked(id); i != -1 {
				restored := a.objects[i]
				restored.Kind = k
				restored.UpdatedAt = time.Now()
				a.objects[i] = restored
				if err := a.persistLocked(); err != nil {
					a.mu.Unlock()
					return err
				}
				a.mu.Unlock()
				dataevent.Emit("atlas", id)
				return nil
			}
			a.mu.Unlock()
			return fmt.Errorf("no board object with id %q", id)
		},
		previous.Kind, o.Kind,
	)
	return o, nil
}
