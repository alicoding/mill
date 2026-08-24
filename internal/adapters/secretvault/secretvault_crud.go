package secretvault

import (
	"encoding/hex"
	"fmt"
	"sort"
	"strings"

	"github.com/alicoding/mill/internal/domain/secret"
	"github.com/tobischo/gokeepasslib/v3"
	w "github.com/tobischo/gokeepasslib/v3/wrappers"
)

// Standard KeePass field names (matching every real KDBX file
// KeePass/KeePassXC itself writes) -- using these exact keys, rather
// than Mill-invented ones, is what makes "open this vault in KeePassXC"
// actually work: a foreign implementation reads Title/UserName/Password/
// URL/Notes by these names.
const (
	fieldTitle    = "Title"
	fieldUsername = "UserName"
	fieldPassword = "Password"
	fieldURL      = "URL"
	fieldNotes    = "Notes"
	fieldTags     = "Tags" // Mill's own convenience field, stored as a plain (non-protected) value; Entry.Tags (the KDBX 4.1 attribute) is left unused so this vault stays readable by KDBX 4.0 tooling too.
)

func (v *fileVault) List() ([]secret.Summary, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.db == nil {
		return nil, ErrLocked
	}
	entries := v.db.Content.Root.Groups[0].Entries
	out := make([]secret.Summary, 0, len(entries))
	for _, e := range entries {
		out = append(out, entryToDomain(e).ToSummary())
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Title) < strings.ToLower(out[j].Title) })
	return out, nil
}

func (v *fileVault) Get(id string) (secret.Entry, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.db == nil {
		return secret.Entry{}, ErrLocked
	}
	idx, err := findEntryIndex(v.db.Content.Root.Groups[0].Entries, id)
	if err != nil {
		return secret.Entry{}, err
	}
	return entryToDomain(v.db.Content.Root.Groups[0].Entries[idx]), nil
}

// History returns id's past versions, most-recently-superseded first.
// gokeepasslib stores them oldest-appended-first in Histories[0].Entries
// (the single-<History>-container shape real KeePass/KeePassXC files
// use); this reverses that for display.
func (v *fileVault) History(id string) ([]secret.Entry, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.db == nil {
		return nil, ErrLocked
	}
	idx, err := findEntryIndex(v.db.Content.Root.Groups[0].Entries, id)
	if err != nil {
		return nil, err
	}
	entry := v.db.Content.Root.Groups[0].Entries[idx]
	if len(entry.Histories) == 0 {
		return nil, nil
	}
	past := entry.Histories[0].Entries
	out := make([]secret.Entry, len(past))
	for i, e := range past {
		out[len(past)-1-i] = entryToDomain(e)
	}
	return out, nil
}

func (v *fileVault) Upsert(e secret.Entry) (secret.Entry, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.db == nil {
		return secret.Entry{}, ErrLocked
	}
	group := &v.db.Content.Root.Groups[0]

	if e.ID == "" {
		entry := gokeepasslib.NewEntry()
		applyValues(&entry, e)
		group.Entries = append(group.Entries, entry)
		if err := v.persistLocked(); err != nil {
			group.Entries = group.Entries[:len(group.Entries)-1]
			return secret.Entry{}, err
		}
		return entryToDomain(entry), nil
	}

	idx, err := findEntryIndex(group.Entries, e.ID)
	if err != nil {
		return secret.Entry{}, err
	}
	previous := group.Entries[idx]
	snapshot := previous.Clone()
	snapshot.UUID = previous.UUID // Clone() mints a fresh UUID; history snapshots must keep the parent's, or a decoder can no longer associate them.
	snapshot.Histories = nil      // a history snapshot never carries its own nested history.

	updated := previous
	if len(updated.Histories) == 0 {
		updated.Histories = []gokeepasslib.History{{}}
	} else {
		updated.Histories = append([]gokeepasslib.History{}, updated.Histories...)
		updated.Histories[0].Entries = append([]gokeepasslib.Entry{}, updated.Histories[0].Entries...)
	}
	updated.Histories[0].Entries = append(updated.Histories[0].Entries, snapshot)
	applyValues(&updated, e)
	now := w.Now()
	updated.Times.LastModificationTime = &now

	group.Entries[idx] = updated
	if err := v.persistLocked(); err != nil {
		group.Entries[idx] = previous
		return secret.Entry{}, err
	}
	return entryToDomain(updated), nil
}

func (v *fileVault) Delete(id string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.db == nil {
		return ErrLocked
	}
	group := &v.db.Content.Root.Groups[0]
	idx, err := findEntryIndex(group.Entries, id)
	if err != nil {
		return err
	}
	removed := group.Entries[idx]
	group.Entries = append(group.Entries[:idx], group.Entries[idx+1:]...)
	if err := v.persistLocked(); err != nil {
		group.Entries = insertEntryAt(group.Entries, idx, removed)
		return err
	}
	return nil
}

func insertEntryAt(entries []gokeepasslib.Entry, idx int, e gokeepasslib.Entry) []gokeepasslib.Entry {
	entries = append(entries, gokeepasslib.Entry{})
	copy(entries[idx+1:], entries[idx:])
	entries[idx] = e
	return entries
}

func findEntryIndex(entries []gokeepasslib.Entry, id string) (int, error) {
	uuid, err := decodeUUID(id)
	if err != nil {
		return -1, err
	}
	for i := range entries {
		if entries[i].UUID.Compare(uuid) {
			return i, nil
		}
	}
	return -1, ErrNotFound
}

func decodeUUID(id string) (gokeepasslib.UUID, error) {
	raw, err := hex.DecodeString(id)
	if err != nil || len(raw) != 16 {
		return gokeepasslib.UUID{}, fmt.Errorf("%w: invalid entry id %q", ErrNotFound, id)
	}
	var uuid gokeepasslib.UUID
	copy(uuid[:], raw)
	return uuid, nil
}

func encodeUUID(uuid gokeepasslib.UUID) string {
	return hex.EncodeToString(uuid[:])
}

func applyValues(entry *gokeepasslib.Entry, e secret.Entry) {
	setValue(entry, fieldTitle, e.Title, false)
	setValue(entry, fieldUsername, e.Username, false)
	setValue(entry, fieldPassword, e.Password, true)
	setValue(entry, fieldURL, e.URL, false)
	setValue(entry, fieldNotes, e.Notes, false)
	setValue(entry, fieldTags, e.Tags, false)
}

func setValue(entry *gokeepasslib.Entry, key, content string, protected bool) {
	if idx := entry.GetIndex(key); idx != -1 {
		entry.Values[idx].Value.Content = content
		entry.Values[idx].Value.Protected = w.NewBoolWrapper(protected)
		return
	}
	entry.Values = append(entry.Values, gokeepasslib.ValueData{
		Key:   key,
		Value: gokeepasslib.V{Content: content, Protected: w.NewBoolWrapper(protected)},
	})
}

func entryToDomain(e gokeepasslib.Entry) secret.Entry {
	out := secret.Entry{
		ID:       encodeUUID(e.UUID),
		Title:    e.GetContent(fieldTitle),
		Username: e.GetContent(fieldUsername),
		Password: e.GetContent(fieldPassword),
		URL:      e.GetContent(fieldURL),
		Notes:    e.GetContent(fieldNotes),
		Tags:     e.GetContent(fieldTags),
	}
	if e.Times.CreationTime != nil {
		out.CreatedAt = e.Times.CreationTime.Time
	}
	if e.Times.LastModificationTime != nil {
		out.UpdatedAt = e.Times.LastModificationTime.Time
	}
	return out
}
