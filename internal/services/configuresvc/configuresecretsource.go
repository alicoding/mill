package configuresvc

import (
	"time"

	"github.com/alicoding/mill/internal/domain/secretsource"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/entitystore"
	"github.com/alicoding/mill/internal/services/seeding"
)

// Secret sources (ADR-0050): the Configure entity naming a store Mill
// reads secrets through. Same recipe as every other entity here
// (execution environments are the nearest twin).

const secretSourcesKey = "configure-secretsources"

var secretSourceDescriptor = entitystore.Descriptor[secretsource.Source]{
	Label:     "secret source",
	GetID:     func(s secretsource.Source) string { return s.ID },
	IsBuiltIn: func(s secretsource.Source) bool { return s.BuiltIn },
	GetSeed:   func(s secretsource.Source) seedorigin.Origin { return s.Seed },
	SetSeed:   func(s secretsource.Source, o seedorigin.Origin) secretsource.Source { s.Seed = o; return s },
	StampNew: func(s secretsource.Source, now time.Time) secretsource.Source {
		s.CreatedAt, s.UpdatedAt = now, now
		return s
	},
	Upgrade: func(existing, golden secretsource.Source, now time.Time) secretsource.Source {
		golden.CreatedAt = existing.CreatedAt
		golden.UpdatedAt = now
		return golden
	},
	BuiltIn: secretsource.BuiltIn,
}

func (c *ConfigureService) SecretSources() []secretsource.Source {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]secretsource.Source, len(c.secretSources))
	copy(out, c.secretSources)
	return out
}

func (c *ConfigureService) CreateSecretSource(label string, kind secretsource.Kind, path string) (secretsource.Source, error) {
	now := time.Now()
	s := secretsource.Source{ID: seeding.NewSlugID(label, "secretsource"), Label: label, Kind: kind, Path: path, CreatedAt: now, UpdatedAt: now}
	if err := secretsource.Validate(s); err != nil {
		return secretsource.Source{}, err
	}
	if err := entitystore.Insert(&c.mu, &c.secretSources, c.persistSecretSources, secretSourceDescriptor, s); err != nil {
		return secretsource.Source{}, err
	}
	dataevent.Emit("secretsource", s.ID)
	return s, nil
}

func (c *ConfigureService) UpdateSecretSource(id, label string, kind secretsource.Kind, path string) (secretsource.Source, error) {
	s := secretsource.Source{ID: id, Label: label, Kind: kind, Path: path}
	if err := secretsource.Validate(s); err != nil {
		return secretsource.Source{}, err
	}
	updated, err := entitystore.Update(&c.mu, &c.secretSources, c.persistSecretSources, secretSourceDescriptor, id, func(existing secretsource.Source) (secretsource.Source, error) {
		s.BuiltIn = existing.BuiltIn
		s.CreatedAt = existing.CreatedAt
		s.UpdatedAt = time.Now()
		s.Seed = existing.Seed.Touch()
		return s, nil
	})
	if err != nil {
		return secretsource.Source{}, err
	}
	dataevent.Emit("secretsource", updated.ID)
	return updated, nil
}

func (c *ConfigureService) DeleteSecretSource(id string) error {
	recordTombstone := func(id string) error { return seeding.RecordTombstone(c.store, id) }
	clearTombstone := func(id string) error { return seeding.ClearTombstone(c.store, id) }
	restore, err := entitystore.DeleteRecoverable(&c.mu, &c.secretSources, c.persistSecretSources, recordTombstone, clearTombstone, secretSourceDescriptor, id)
	if err != nil {
		return err
	}
	c.undo.remember("secretsource", id, restore)
	dataevent.Emit("secretsource", id)
	return nil
}

func (c *ConfigureService) persistSecretSources() error {
	return entitystore.Persist(&c.mu, &c.secretSources, c.store, secretSourcesKey, secretSourceDescriptor)
}

func (c *ConfigureService) restoreSecretSources() {
	entitystore.Load(&c.mu, &c.secretSources, c.store, secretSourcesKey)
}
