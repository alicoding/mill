package secretvault

import (
	"errors"
	"sort"
	"time"

	"github.com/alicoding/mill/internal/domain/secret"
	"github.com/tobischo/gokeepasslib/v3"
	w "github.com/tobischo/gokeepasslib/v3/wrappers"
)

// recycleBinGroupName matches KeePassXC's own default Recycle Bin
// group name, so a vault opened there shows the identical bin --
// never a Mill-invented name.
const recycleBinGroupName = "Recycle Bin"

// recycleBinIconID is KeePassXC's own icon index for its Recycle Bin
// group (the trash-can glyph in its built-in icon set) -- cosmetic
// only, but what makes the group look native rather than a plain
// folder to a foreign KDBX client.
const recycleBinIconID = 43

// fieldOriginGroup is the CustomData key a trashed entry carries: the
// hex UUID of the group it was trashed FROM, RestoreEntry's own way
// back. Absent (an entry trashed before this field existed, or one a
// foreign KDBX client recycled) restores to root.
const fieldOriginGroup = "Mill-OriginGroup"

// ErrInTrash is returned by Get/History for an id currently in the
// Recycle Bin -- distinct from ErrNotFound (no such id has ever
// existed), so a caller can tell "gone" from "recoverable."
var ErrInTrash = errors.New("secretvault: entry is in Trash")

// findRecycleBinIndexLocked answers the Recycle Bin group's index in
// Root.Groups, or -1 when the vault has never trashed anything (no bin
// group exists yet). Never creates one -- a read path (ListTrash,
// RestoreEntry, DestroyEntry, SweepTrash) must not conjure a bin group
// that has nothing in it. Caller must hold v.mu.
func (v *fileVault) findRecycleBinIndexLocked() int {
	if v.db.Content.Meta.RecycleBinUUID.IsZero() {
		return -1
	}
	for i := range v.db.Content.Root.Groups {
		if v.db.Content.Root.Groups[i].UUID.Compare(v.db.Content.Meta.RecycleBinUUID) {
			return i
		}
	}
	return -1
}

// recycleBinGroupIndexLocked is findRecycleBinIndexLocked's
// create-on-demand counterpart -- the only path that ever mints a bin
// group (TrashEntry), stamping Meta.RecycleBinEnabled/RecycleBinUUID
// the same way a real KeePassXC-created bin would, so a foreign KDBX
// client reads back the identical group. Caller must hold v.mu.
func (v *fileVault) recycleBinGroupIndexLocked() int {
	if idx := v.findRecycleBinIndexLocked(); idx != -1 {
		return idx
	}
	bin := gokeepasslib.NewGroup()
	bin.Name = recycleBinGroupName
	bin.IconID = recycleBinIconID
	v.db.Content.Root.Groups = append(v.db.Content.Root.Groups, bin)
	v.db.Content.Meta.RecycleBinEnabled = w.NewBoolWrapper(true)
	v.db.Content.Meta.RecycleBinUUID = bin.UUID
	now := w.Now()
	v.db.Content.Meta.RecycleBinChanged = &now
	return len(v.db.Content.Root.Groups) - 1
}

// findEntryLocation searches every top-level group for id, returning
// which group holds it and its index within that group. Caller must
// hold v.mu.
func (v *fileVault) findEntryLocation(id string) (groupIdx, entryIdx int, err error) {
	uuid, err := decodeUUID(id)
	if err != nil {
		return -1, -1, err
	}
	for gi := range v.db.Content.Root.Groups {
		for ei := range v.db.Content.Root.Groups[gi].Entries {
			if v.db.Content.Root.Groups[gi].Entries[ei].UUID.Compare(uuid) {
				return gi, ei, nil
			}
		}
	}
	return -1, -1, ErrNotFound
}

// TrashEntry moves id from whichever group holds it into the Recycle
// Bin (created on first use). A no-op when id is already there --
// deleting an already-trashed row (a stale row menu, a double click)
// must not overwrite its own deleted-at time or mint a second
// fieldOriginGroup value.
func (v *fileVault) TrashEntry(id string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.db == nil {
		return ErrLocked
	}
	gi, ei, err := v.findEntryLocation(id)
	if err != nil {
		return err
	}
	binIdx := v.recycleBinGroupIndexLocked()
	if gi == binIdx {
		return nil
	}

	origin := v.db.Content.Root.Groups[gi]
	removed := origin.Entries[ei]
	trashed := removed
	setValue(&trashed, fieldOriginGroup, encodeUUID(origin.UUID), false)
	now := w.Now()
	trashed.Times.LocationChanged = &now

	v.db.Content.Root.Groups[gi].Entries = append(v.db.Content.Root.Groups[gi].Entries[:ei], v.db.Content.Root.Groups[gi].Entries[ei+1:]...)
	v.db.Content.Root.Groups[binIdx].Entries = append(v.db.Content.Root.Groups[binIdx].Entries, trashed)
	if err := v.persistLocked(); err != nil {
		v.db.Content.Root.Groups[binIdx].Entries = v.db.Content.Root.Groups[binIdx].Entries[:len(v.db.Content.Root.Groups[binIdx].Entries)-1]
		v.db.Content.Root.Groups[gi].Entries = insertEntryAt(v.db.Content.Root.Groups[gi].Entries, ei, removed)
		return err
	}
	return nil
}

// originGroupIndexLocked answers which group a trashed entry restores
// into: the group its own fieldOriginGroup CustomData names, or root
// (index 0) when absent or that group no longer exists. Caller must
// hold v.mu.
func (v *fileVault) originGroupIndexLocked(entry gokeepasslib.Entry) int {
	origin := entry.GetContent(fieldOriginGroup)
	if origin != "" {
		if uuid, err := decodeUUID(origin); err == nil {
			for i := range v.db.Content.Root.Groups {
				if v.db.Content.Root.Groups[i].UUID.Compare(uuid) {
					return i
				}
			}
		}
	}
	return 0
}

// RestoreEntry moves a trashed entry back to its origin group,
// dropping the fieldOriginGroup bookkeeping and re-stamping
// LocationChanged as the restore moment.
func (v *fileVault) RestoreEntry(id string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.db == nil {
		return ErrLocked
	}
	binIdx := v.findRecycleBinIndexLocked()
	if binIdx == -1 {
		return ErrNotFound
	}
	ei, err := findEntryIndex(v.db.Content.Root.Groups[binIdx].Entries, id)
	if err != nil {
		return err
	}
	removed := v.db.Content.Root.Groups[binIdx].Entries[ei]
	destIdx := v.originGroupIndexLocked(removed)
	restored := removed
	removeValue(&restored, fieldOriginGroup)
	now := w.Now()
	restored.Times.LocationChanged = &now

	v.db.Content.Root.Groups[binIdx].Entries = append(v.db.Content.Root.Groups[binIdx].Entries[:ei], v.db.Content.Root.Groups[binIdx].Entries[ei+1:]...)
	v.db.Content.Root.Groups[destIdx].Entries = append(v.db.Content.Root.Groups[destIdx].Entries, restored)
	if err := v.persistLocked(); err != nil {
		v.db.Content.Root.Groups[destIdx].Entries = v.db.Content.Root.Groups[destIdx].Entries[:len(v.db.Content.Root.Groups[destIdx].Entries)-1]
		v.db.Content.Root.Groups[binIdx].Entries = insertEntryAt(v.db.Content.Root.Groups[binIdx].Entries, ei, removed)
		return err
	}
	return nil
}

// DestroyEntry permanently removes a trashed entry. ErrNotFound for an
// id not currently in the bin -- Delete is the door for a still-live
// entry's own permanent removal.
func (v *fileVault) DestroyEntry(id string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.db == nil {
		return ErrLocked
	}
	binIdx := v.findRecycleBinIndexLocked()
	if binIdx == -1 {
		return ErrNotFound
	}
	ei, err := findEntryIndex(v.db.Content.Root.Groups[binIdx].Entries, id)
	if err != nil {
		return err
	}
	removed := v.db.Content.Root.Groups[binIdx].Entries[ei]
	v.db.Content.Root.Groups[binIdx].Entries = append(v.db.Content.Root.Groups[binIdx].Entries[:ei], v.db.Content.Root.Groups[binIdx].Entries[ei+1:]...)
	if err := v.persistLocked(); err != nil {
		v.db.Content.Root.Groups[binIdx].Entries = insertEntryAt(v.db.Content.Root.Groups[binIdx].Entries, ei, removed)
		return err
	}
	return nil
}

// ListTrash returns every Recycle Bin entry, most recently trashed
// first. nil (never an error) when the vault has never trashed
// anything -- there being no bin group yet is the ordinary empty
// state, not a fault.
func (v *fileVault) ListTrash() ([]secret.TrashSummary, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.db == nil {
		return nil, ErrLocked
	}
	binIdx := v.findRecycleBinIndexLocked()
	if binIdx == -1 {
		return nil, nil
	}
	entries := v.db.Content.Root.Groups[binIdx].Entries
	out := make([]secret.TrashSummary, 0, len(entries))
	for _, e := range entries {
		out = append(out, trashSummaryOf(e))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].DeletedAt.After(out[j].DeletedAt) })
	return out, nil
}

// SweepTrash permanently removes every bin entry deleted-at before
// now.Add(-retention), returning what it destroyed. A sweep that finds
// nothing to destroy never persists -- the common case (most ticks)
// costs nothing but a comparison.
func (v *fileVault) SweepTrash(now time.Time, retention time.Duration) ([]secret.TrashSummary, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.db == nil {
		return nil, ErrLocked
	}
	binIdx := v.findRecycleBinIndexLocked()
	if binIdx == -1 {
		return nil, nil
	}
	cutoff := now.Add(-retention)
	entries := v.db.Content.Root.Groups[binIdx].Entries
	keep := make([]gokeepasslib.Entry, 0, len(entries))
	var destroyed []secret.TrashSummary
	for _, e := range entries {
		if deletedAt(e).Before(cutoff) {
			destroyed = append(destroyed, trashSummaryOf(e))
			continue
		}
		keep = append(keep, e)
	}
	if len(destroyed) == 0 {
		return nil, nil
	}
	previous := v.db.Content.Root.Groups[binIdx].Entries
	v.db.Content.Root.Groups[binIdx].Entries = keep
	if err := v.persistLocked(); err != nil {
		v.db.Content.Root.Groups[binIdx].Entries = previous
		return nil, err
	}
	return destroyed, nil
}

// deletedAt is an entry's own deleted-at time: LocationChanged (what
// TrashEntry always stamps), falling back to CreationTime for an entry
// a foreign KDBX client recycled with no LocationChanged at all --
// never a zero time, which would make such an entry sweep instantly.
func deletedAt(e gokeepasslib.Entry) time.Time {
	if e.Times.LocationChanged != nil {
		return e.Times.LocationChanged.Time
	}
	if e.Times.CreationTime != nil {
		return e.Times.CreationTime.Time
	}
	return time.Time{}
}

func trashSummaryOf(e gokeepasslib.Entry) secret.TrashSummary {
	return secret.TrashSummary{
		ID:        encodeUUID(e.UUID),
		Title:     e.GetContent(fieldTitle),
		Kind:      secret.NormalizeKind(e.GetContent(fieldKind)),
		DeletedAt: deletedAt(e),
	}
}

// removeValue drops key from entry's own stored values entirely --
// setValue's own inverse, used by RestoreEntry to drop
// fieldOriginGroup once an entry leaves the bin.
func removeValue(entry *gokeepasslib.Entry, key string) {
	idx := entry.GetIndex(key)
	if idx == -1 {
		return
	}
	entry.Values = append(entry.Values[:idx], entry.Values[idx+1:]...)
}
