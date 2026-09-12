package configuresvc

import (
	"fmt"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/domain/usererror"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/entitystore"
	"github.com/alicoding/mill/internal/services/seeding"
)

type aiProviderMutationCoordinator func(mutate func(assertUnused func(id string) error) error) error
type aiProviderImpactLookup func(id string, configRevision func() string) aiprovider.ChangeImpact

// SetAIProviderMutationCoordinator wires Configure to Execution's one atomic
// mutation and impact scanner. Package-level wiring functions do not become
// Wails methods.
func SetAIProviderMutationCoordinator(
	c *ConfigureService,
	mutation aiProviderMutationCoordinator,
	impact aiProviderImpactLookup,
) {
	c.mu.Lock()
	c.aiProviderMutation = mutation
	c.aiProviderImpact = impact
	c.mu.Unlock()
}

func (c *ConfigureService) withAIProviderMutation(
	id string,
	mutate func(assertUnused func() error) error,
) error {
	if mutate == nil {
		return c.withAIProviderMutations(nil)
	}
	return c.withAIProviderMutations(func(assertUnused func(id string) error) error {
		return mutate(func() error { return assertUnused(id) })
	})
}

func (c *ConfigureService) withAIProviderMutations(
	mutate func(assertUnused func(id string) error) error,
) error {
	if mutate == nil {
		return usererror.New(
			string(aiprovider.ChangeBlockerProviderCheckUnavailable),
			"Mill cannot confirm that this connection is unused. Review unfinished runs before changing it.",
		)
	}
	c.mu.Lock()
	coordinator := c.aiProviderMutation
	c.mu.Unlock()
	if coordinator == nil {
		return mutate(func(string) error {
			return usererror.New(
				string(aiprovider.ChangeBlockerProviderCheckUnavailable),
				"Mill cannot confirm that this connection is unused. Review unfinished runs before changing it.",
			)
		})
	}
	return coordinator(mutate)
}

// GetAIProviderChangeImpact is a passive read. The revision reader executes
// after Execution has acquired its genesis lock, so the returned revision and
// run evidence describe one ordered snapshot.
func (c *ConfigureService) GetAIProviderChangeImpact(id string) aiprovider.ChangeImpact {
	_, _, impact := c.aiProviderImpactSnapshot(id)
	return impact
}

func (c *ConfigureService) aiProviderImpactSnapshot(id string) (aiprovider.AIProvider, bool, aiprovider.ChangeImpact) {
	c.mu.Lock()
	lookup := c.aiProviderImpact
	c.mu.Unlock()
	var current aiprovider.AIProvider
	var exists bool
	revision := func() string {
		current, exists = c.currentAIProviderSnapshot(id)
		if !exists {
			return aiprovider.RevisionAbsent
		}
		return c.aiProviderConfigRevision(current)
	}
	if lookup == nil {
		currentRevision := revision()
		return current, exists, aiprovider.ChangeImpact{
			ProviderID: id, ConfigRevision: currentRevision,
			BlockerCodes: []aiprovider.ChangeBlockerCode{aiprovider.ChangeBlockerProviderCheckUnavailable},
		}
	}
	impact := lookup(id, revision)
	return current, exists, impact
}

func (c *ConfigureService) currentAIProviderSnapshot(id string) (aiprovider.AIProvider, bool) {
	c.mu.Lock()
	p, ok := c.aiProviderSnapshotLocked(id)
	c.mu.Unlock()
	return p, ok
}

func aiProviderRuntimeEqual(a, b aiprovider.AIProvider) bool {
	return a.Kind == b.Kind && effectiveAIProviderBaseURL(a) == effectiveAIProviderBaseURL(b) &&
		a.Model == b.Model && a.KeyRef == b.KeyRef
}

func effectiveAIProviderBaseURL(provider aiprovider.AIProvider) string {
	if provider.Kind == aiprovider.KindAnthropic && provider.BaseURL == "" {
		return aiprovider.DefaultAnthropicBaseURL
	}
	return provider.BaseURL
}

func (c *ConfigureService) createAIProviderUncoordinated(
	id, label string,
	kind aiprovider.Kind,
	baseURL, model, keyRef string,
) (aiprovider.AIProvider, error) {
	now := time.Now()
	provider := aiprovider.AIProvider{
		ID: id, Label: label, Kind: kind, BaseURL: baseURL, Model: model,
		KeyRef: keyRef, CreatedAt: now, UpdatedAt: now,
	}
	if err := aiprovider.Validate(provider); err != nil {
		return aiprovider.AIProvider{}, err
	}
	if err := entitystore.Insert(&c.mu, &c.aiProviders, c.persistAIProviders, aiProviderDescriptor, provider); err != nil {
		return aiprovider.AIProvider{}, err
	}
	return provider, nil
}

func (c *ConfigureService) updateAIProviderUncoordinated(
	id, label string,
	kind aiprovider.Kind,
	baseURL, model, keyRef string,
) (aiprovider.AIProvider, error) {
	proposed := aiprovider.AIProvider{ID: id, Label: label, Kind: kind, BaseURL: baseURL, Model: model, KeyRef: keyRef}
	if err := aiprovider.Validate(proposed); err != nil {
		return aiprovider.AIProvider{}, err
	}
	return entitystore.Update(&c.mu, &c.aiProviders, c.persistAIProviders, aiProviderDescriptor, id, func(existing aiprovider.AIProvider) (aiprovider.AIProvider, error) {
		proposed.BuiltIn = existing.BuiltIn
		proposed.CreatedAt = existing.CreatedAt
		proposed.UpdatedAt = time.Now()
		proposed.Seed = existing.Seed.Touch()
		return proposed, nil
	})
}

func (c *ConfigureService) announceAIProviderMutation(id string) {
	InvalidateAIProviderAvailability(c, id)
	dataevent.Emit("aiprovider", id)
}

func (c *ConfigureService) createAIProviderCoordinated(
	label string,
	kind aiprovider.Kind,
	baseURL, model, keyRef string,
) (aiprovider.AIProvider, error) {
	if err := aiprovider.Validate(aiprovider.AIProvider{
		Label: label, Kind: kind, BaseURL: baseURL, Model: model, KeyRef: keyRef,
	}); err != nil {
		return aiprovider.AIProvider{}, err
	}
	var created aiprovider.AIProvider
	err := c.withAIProviderMutations(func(func(string) error) error {
		id := seeding.NewSlugID(label, "aiprovider")
		var err error
		created, err = c.createAIProviderUncoordinated(id, label, kind, baseURL, model, keyRef)
		return err
	})
	if err == nil {
		c.announceAIProviderMutation(created.ID)
	}
	return created, err
}

func (c *ConfigureService) updateAIProviderCoordinated(
	id, label string,
	kind aiprovider.Kind,
	baseURL, model, keyRef string,
) (aiprovider.AIProvider, error) {
	proposed := aiprovider.AIProvider{
		ID: id, Label: label, Kind: kind, BaseURL: baseURL, Model: model, KeyRef: keyRef,
	}
	if err := aiprovider.Validate(proposed); err != nil {
		return aiprovider.AIProvider{}, err
	}
	var updated aiprovider.AIProvider
	err := c.withAIProviderMutation(id, func(assertUnused func() error) error {
		current, exists := c.currentAIProviderSnapshot(id)
		if exists && !aiProviderRuntimeEqual(current, proposed) {
			if err := assertUnused(); err != nil {
				return err
			}
		}
		var err error
		updated, err = c.updateAIProviderUncoordinated(id, label, kind, baseURL, model, keyRef)
		return err
	})
	if err == nil {
		c.announceAIProviderMutation(updated.ID)
	}
	return updated, err
}

func (c *ConfigureService) deleteAIProviderCoordinated(id string) error {
	restore, removed, err := c.deleteAIProviderOnce(id)
	if err != nil {
		return err
	}
	c.registerEntityDelete(
		"aiprovider", id, removed.Label,
		c.guardAIProviderRestore(id, restore), c.guardAIProviderRedo(id), c.announceAIProviderMutation,
	)
	c.announceAIProviderMutation(id)
	return nil
}

func (c *ConfigureService) deleteAIProviderOnce(id string) (func() error, aiprovider.AIProvider, error) {
	var restore func() error
	var removed aiprovider.AIProvider
	err := c.withAIProviderMutation(id, func(assertUnused func() error) error {
		if err := c.refIntegrityError("aiprovider", "AI provider", id); err != nil {
			return err
		}
		if err := assertUnused(); err != nil {
			return err
		}
		var err error
		restore, removed, err = c.deleteAIProviderUncoordinated(id)
		return err
	})
	return restore, removed, err
}

func (c *ConfigureService) guardAIProviderRestore(id string, restore func() error) func() error {
	return func() error {
		return c.withAIProviderMutation(id, func(assertUnused func() error) error {
			if err := assertUnused(); err != nil {
				return err
			}
			return restore()
		})
	}
}

func (c *ConfigureService) guardAIProviderRedo(id string) func() error {
	return func() error {
		err := c.withAIProviderMutation(id, func(assertUnused func() error) error {
			if err := c.refIntegrityError("aiprovider", "AI provider", id); err != nil {
				return err
			}
			if err := assertUnused(); err != nil {
				return err
			}
			_, _, err := c.deleteAIProviderUncoordinated(id)
			return err
		})
		if err == nil {
			c.announceAIProviderMutation(id)
		}
		return err
	}
}

func (c *ConfigureService) deleteAIProviderUncoordinated(id string) (func() error, aiprovider.AIProvider, error) {
	recordTombstone := func(id string) error { return seeding.RecordTombstone(c.store, id) }
	clearTombstone := func(id string) error { return seeding.ClearTombstone(c.store, id) }
	return entitystore.DeleteRecoverable(
		&c.mu, &c.aiProviders, c.persistAIProviders,
		recordTombstone, clearTombstone, aiProviderDescriptor, id,
	)
}

func (c *ConfigureService) resetAIProviderToSeedCoordinated(id string) (aiprovider.AIProvider, error) {
	var updated aiprovider.AIProvider
	err := c.withAIProviderMutation(id, func(assertUnused func() error) error {
		current, exists := c.currentAIProviderSnapshot(id)
		golden, goldenExists := findGoldenAIProvider(id)
		if exists && goldenExists && !aiProviderRuntimeEqual(current, golden) {
			if err := assertUnused(); err != nil {
				return err
			}
		}
		var err error
		updated, err = entitystore.ResetToSeed(
			&c.mu, &c.aiProviders, c.persistAIProviders, aiProviderDescriptor, id,
		)
		return err
	})
	if err == nil {
		c.announceAIProviderMutation(id)
	}
	return updated, err
}

func (c *ConfigureService) restoreAIProviderCoordinated(id string) (aiprovider.AIProvider, error) {
	if _, ok := findGoldenAIProvider(id); !ok {
		return aiprovider.AIProvider{}, fmt.Errorf("no built-in AI provider with id %q", id)
	}
	var restored aiprovider.AIProvider
	err := c.withAIProviderMutation(id, func(assertUnused func() error) error {
		if err := assertUnused(); err != nil {
			return err
		}
		var err error
		restored, err = entitystore.Restore(
			&c.mu, &c.aiProviders, c.persistAIProviders, c.store, aiProviderDescriptor, id,
		)
		return err
	})
	if err == nil {
		c.announceAIProviderMutation(id)
	}
	return restored, err
}

func findGoldenAIProvider(id string) (aiprovider.AIProvider, bool) {
	for _, provider := range aiprovider.BuiltIn() {
		if provider.ID == id {
			return provider, true
		}
	}
	return aiprovider.AIProvider{}, false
}

// ReconcileBuiltInAIProviders applies the seed plan as one provider batch.
// Planning happens on a private copy so a refusal exposes no half-reconciled
// in-memory state; persistence failure restores the exact previous slice.
func ReconcileBuiltInAIProviders(c *ConfigureService) error {
	if c == nil {
		return fmt.Errorf("configure service is not available")
	}
	var changedIDs []string
	err := c.withAIProviderMutations(func(assertUnused func(id string) error) error {
		var err error
		changedIDs, err = c.reconcileBuiltInAIProviders(assertUnused)
		return err
	})
	if err != nil {
		return err
	}
	for _, id := range changedIDs {
		c.announceAIProviderMutation(id)
	}
	return nil
}

func (c *ConfigureService) reconcileBuiltInAIProviders(assertUnused func(string) error) ([]string, error) {
	before, proposed, changed := c.planBuiltInAIProviderReconciliation()
	if !changed {
		return nil, nil
	}
	changedIDs, err := changedAIProviderIDs(before, proposed, assertUnused)
	if err != nil {
		return nil, err
	}
	if err := c.persistAIProviderReconciliation(before, proposed); err != nil {
		return nil, err
	}
	return changedIDs, nil
}

func (c *ConfigureService) planBuiltInAIProviderReconciliation() ([]aiprovider.AIProvider, []aiprovider.AIProvider, bool) {
	c.mu.Lock()
	before := append([]aiprovider.AIProvider(nil), c.aiProviders...)
	c.mu.Unlock()
	proposed := append([]aiprovider.AIProvider(nil), before...)
	var planMu sync.Mutex
	_, changed := entitystore.Reconcile(
		&planMu, &proposed, seeding.LoadTombstones(c.store), aiProviderDescriptor,
	)
	return before, proposed, changed
}

func changedAIProviderIDs(
	before, proposed []aiprovider.AIProvider,
	assertUnused func(string) error,
) ([]string, error) {
	beforeByID := make(map[string]aiprovider.AIProvider, len(before))
	for _, provider := range before {
		beforeByID[provider.ID] = provider
	}
	changedIDs := make([]string, 0, len(proposed))
	for _, provider := range proposed {
		previous, existed := beforeByID[provider.ID]
		if !existed || !aiProviderRuntimeEqual(previous, provider) {
			if err := assertUnused(provider.ID); err != nil {
				return nil, err
			}
		}
		if !existed || previous != provider {
			changedIDs = append(changedIDs, provider.ID)
		}
	}
	return changedIDs, nil
}

func (c *ConfigureService) persistAIProviderReconciliation(before, proposed []aiprovider.AIProvider) error {
	c.mu.Lock()
	c.aiProviders = proposed
	c.mu.Unlock()
	if err := c.persistAIProviders(); err != nil {
		c.mu.Lock()
		c.aiProviders = before
		c.mu.Unlock()
		return fmt.Errorf("save reconciled AI providers: %w", err)
	}
	return nil
}
