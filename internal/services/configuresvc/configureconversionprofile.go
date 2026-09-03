package configuresvc

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/conversionprofile"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/entitystore"
	"github.com/alicoding/mill/internal/services/seeding"
)

// Conversion profiles (goal 0305 slice 6): the Configure entity naming
// which source-specific rule sets an HTML-to-Markdown conversion
// applies. Same recipe as every other entity here (secret sources are
// the nearest twin); three seeded examples.

const conversionProfilesKey = "configure-conversionprofiles"

var conversionProfileDescriptor = entitystore.Descriptor[conversionprofile.Profile]{
	Label:     "conversion profile",
	GetID:     func(p conversionprofile.Profile) string { return p.ID },
	IsBuiltIn: func(p conversionprofile.Profile) bool { return p.BuiltIn },
	GetSeed:   func(p conversionprofile.Profile) seedorigin.Origin { return p.Seed },
	SetSeed:   func(p conversionprofile.Profile, o seedorigin.Origin) conversionprofile.Profile { p.Seed = o; return p },
	StampNew: func(p conversionprofile.Profile, now time.Time) conversionprofile.Profile {
		p.CreatedAt, p.UpdatedAt = now, now
		return p
	},
	Upgrade: func(existing, golden conversionprofile.Profile, now time.Time) conversionprofile.Profile {
		golden.CreatedAt = existing.CreatedAt
		golden.UpdatedAt = now
		return golden
	},
	BuiltIn: conversionprofile.BuiltIn,
}

func (c *ConfigureService) ConversionProfiles() []conversionprofile.Profile {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]conversionprofile.Profile, len(c.conversionProfiles))
	copy(out, c.conversionProfiles)
	return out
}

func (c *ConfigureService) CreateConversionProfile(label, description string, ruleSets []string) (conversionprofile.Profile, error) {
	now := time.Now()
	p := conversionprofile.Profile{ID: seeding.NewSlugID(label, "conversionprofile"), Label: label, Description: description, RuleSets: ruleSets, CreatedAt: now, UpdatedAt: now}
	if err := conversionprofile.Validate(&p); err != nil {
		return conversionprofile.Profile{}, err
	}
	if err := entitystore.Insert(&c.mu, &c.conversionProfiles, c.persistConversionProfiles, conversionProfileDescriptor, p); err != nil {
		return conversionprofile.Profile{}, err
	}
	dataevent.Emit("conversionprofile", p.ID)
	return p, nil
}

func (c *ConfigureService) UpdateConversionProfile(id, label, description string, ruleSets []string) (conversionprofile.Profile, error) {
	p := conversionprofile.Profile{ID: id, Label: label, Description: description, RuleSets: ruleSets}
	if err := conversionprofile.Validate(&p); err != nil {
		return conversionprofile.Profile{}, err
	}
	updated, err := entitystore.Update(&c.mu, &c.conversionProfiles, c.persistConversionProfiles, conversionProfileDescriptor, id, func(existing conversionprofile.Profile) (conversionprofile.Profile, error) {
		p.BuiltIn = existing.BuiltIn
		p.CreatedAt = existing.CreatedAt
		p.UpdatedAt = time.Now()
		p.Seed = existing.Seed.Touch()
		return p, nil
	})
	if err != nil {
		return conversionprofile.Profile{}, err
	}
	dataevent.Emit("conversionprofile", updated.ID)
	return updated, nil
}

func (c *ConfigureService) DeleteConversionProfile(id string) error {
	recordTombstone := func(id string) error { return seeding.RecordTombstone(c.store, id) }
	clearTombstone := func(id string) error { return seeding.ClearTombstone(c.store, id) }
	restore, err := entitystore.DeleteRecoverable(&c.mu, &c.conversionProfiles, c.persistConversionProfiles, recordTombstone, clearTombstone, conversionProfileDescriptor, id)
	if err != nil {
		return err
	}
	c.undo.remember("conversionprofile", id, restore)
	dataevent.Emit("conversionprofile", id)
	return nil
}

func (c *ConfigureService) persistConversionProfiles() error {
	return entitystore.Persist(&c.mu, &c.conversionProfiles, c.store, conversionProfilesKey, conversionProfileDescriptor)
}

func (c *ConfigureService) restoreConversionProfiles() {
	entitystore.Load(&c.mu, &c.conversionProfiles, c.store, conversionProfilesKey)
}

func (c *ConfigureService) reconcileBuiltInConversionProfiles() {
	tombstones := seeding.LoadTombstones(c.store)
	if _, changed := entitystore.Reconcile(&c.mu, &c.conversionProfiles, tombstones, conversionProfileDescriptor); changed {
		if err := c.persistConversionProfiles(); err != nil {
			slog.Error("failed to reconcile built-in conversion profiles", "error", err)
		}
	}
}

// resolveConversionProfile is the converter step's lookup seam
// (composition.SetConversionProfileLookup): the rule sets a profile id
// names, or an error naming the missing profile.
func (c *ConfigureService) resolveConversionProfile(id string) (composition.ResolvedConversionProfile, error) {
	for _, p := range c.ConversionProfiles() {
		if p.ID == id {
			return composition.ResolvedConversionProfile{Label: p.Label, RuleSets: append([]string{}, p.RuleSets...)}, nil
		}
	}
	return composition.ResolvedConversionProfile{}, fmt.Errorf("conversion profile %q not found", id)
}
