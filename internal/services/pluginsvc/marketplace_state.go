package pluginsvc

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const marketplaceStateVersion = 2

type marketplaceIndexCache struct {
	Incarnation string           `json:"incarnation"`
	Origin      SourceOrigin     `json:"origin"`
	Index       MarketplaceIndex `json:"index"`
}

type marketplaceState struct {
	Version int                              `json:"version"`
	Sources []MarketplaceSource              `json:"sources"`
	Indexes map[string]marketplaceIndexCache `json:"indexes"`
	Updates UpdateCheck                      `json:"updates"`
}

type legacyMarketplaceState struct {
	Sources []MarketplaceSource         `json:"sources"`
	Indexes map[string]MarketplaceIndex `json:"indexes"`
	Updates UpdateCheck                 `json:"updates"`
}

func emptyMarketplaceState() marketplaceState {
	return marketplaceState{Version: marketplaceStateVersion, Indexes: map[string]marketplaceIndexCache{}}
}

func (p *PluginService) readState() (marketplaceState, error) {
	return p.readStateContext(context.Background())
}

func (p *PluginService) readStateContext(ctx context.Context) (marketplaceState, error) {
	payload, _, present, err := p.state.Load(ctx)
	if err != nil {
		return marketplaceState{}, err
	}
	if present {
		return decodeMarketplaceState(payload)
	}
	return p.readLegacyState()
}

func decodeMarketplaceState(payload []byte) (marketplaceState, error) {
	var st marketplaceState
	if err := json.Unmarshal(payload, &st); err != nil {
		return marketplaceState{}, fmt.Errorf("extension source state is not valid JSON: %w", err)
	}
	if st.Version != marketplaceStateVersion {
		return marketplaceState{}, fmt.Errorf("extension source state version %d is not supported", st.Version)
	}
	if st.Indexes == nil {
		st.Indexes = map[string]marketplaceIndexCache{}
	}
	if err := validateMarketplaceState(st); err != nil {
		return marketplaceState{}, err
	}
	return st, nil
}

func (p *PluginService) readLegacyState() (marketplaceState, error) {
	raw, err := os.ReadFile(p.marketplacesPath()) // #nosec G304 -- this service's own profile path
	if err != nil {
		if os.IsNotExist(err) {
			return emptyMarketplaceState(), nil
		}
		return marketplaceState{}, fmt.Errorf("read legacy extension source state: %w", err)
	}
	return decodeLegacyMarketplaceState(raw)
}

func decodeLegacyMarketplaceState(raw []byte) (marketplaceState, error) {
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return marketplaceState{}, fmt.Errorf("legacy extension source state is not valid JSON: %w", err)
	}
	if _, ok := envelope["version"]; ok {
		return marketplaceState{}, errors.New("legacy extension source state has an unsupported version")
	}
	var legacy legacyMarketplaceState
	if err := json.Unmarshal(raw, &legacy); err != nil {
		return marketplaceState{}, fmt.Errorf("legacy extension source state is invalid: %w", err)
	}
	st := emptyMarketplaceState()
	st.Updates = legacy.Updates
	seen := map[string]bool{}
	for _, source := range legacy.Sources {
		source.Name = strings.TrimSpace(source.Name)
		if source.Name == ReservedMarketplaceName || !marketplaceNamePattern.MatchString(source.Name) || seen[source.Name] {
			return marketplaceState{}, fmt.Errorf("legacy extension source state has invalid or duplicate source %q", source.Name)
		}
		seen[source.Name] = true
		canonical, err := canonicalSource(source)
		if err != nil {
			return marketplaceState{}, fmt.Errorf("legacy source %q has invalid identity: %w", source.Name, err)
		}
		canonical.Name = source.Name
		canonical.AddedAt = source.AddedAt
		canonical.Status = SourceNeverFetched
		canonical.Incarnation = legacyIncarnation(canonical.Name, canonical.Origin)
		if idx, ok := legacy.Indexes[source.Name]; ok && idx.Name == source.Name {
			canonical.Status = SourceCurrent
			st.Indexes[source.Name] = marketplaceIndexCache{Incarnation: canonical.Incarnation, Origin: canonical.Origin, Index: idx}
		}
		st.Sources = append(st.Sources, canonical)
	}
	if err := validateMarketplaceState(st); err != nil {
		return marketplaceState{}, err
	}
	return st, nil
}

func legacyIncarnation(name string, origin SourceOrigin) string {
	sum := sha256.Sum256([]byte(name + "\x00" + origin.Kind + "\x00" + origin.Locator + "\x00" + origin.Ref))
	return "legacy-" + hex.EncodeToString(sum[:16])
}

func validateMarketplaceState(st marketplaceState) error {
	if st.Version != marketplaceStateVersion {
		return fmt.Errorf("extension source state version %d is not supported", st.Version)
	}
	seen, err := validateMarketplaceSources(st.Sources)
	if err != nil {
		return err
	}
	return validateMarketplaceIndexes(st.Indexes, seen)
}

func validateMarketplaceSources(sources []MarketplaceSource) (map[string]MarketplaceSource, error) {
	seen := map[string]MarketplaceSource{}
	for _, source := range sources {
		if source.Name == ReservedMarketplaceName || !marketplaceNamePattern.MatchString(source.Name) {
			return nil, fmt.Errorf("extension source state has invalid source name %q", source.Name)
		}
		if _, exists := seen[source.Name]; exists {
			return nil, fmt.Errorf("extension source state has duplicate source %q", source.Name)
		}
		if !storedSourceIdentityValid(source) {
			return nil, fmt.Errorf("extension source state has invalid identity for %q", source.Name)
		}
		if strings.TrimSpace(source.Incarnation) == "" {
			return nil, fmt.Errorf("extension source state has no incarnation for %q", source.Name)
		}
		switch source.Status {
		case SourceNeverFetched, SourceCurrent, SourceUnavailable, SourceBlocked:
		default:
			return nil, fmt.Errorf("extension source state has invalid status for %q", source.Name)
		}
		seen[source.Name] = source
	}
	return seen, nil
}

func storedSourceIdentityValid(source MarketplaceSource) bool {
	if source.Kind == "path" {
		locator := strings.TrimSpace(source.Locator)
		return source.Locator == locator && source.Ref == "" && filepath.IsAbs(locator) && filepath.Clean(locator) == locator &&
			source.Origin == (SourceOrigin{Kind: "path", Locator: locator})
	}
	canonical, err := canonicalSource(source)
	return err == nil && canonical.Origin == source.Origin
}

func validateMarketplaceIndexes(indexes map[string]marketplaceIndexCache, sources map[string]MarketplaceSource) error {
	for name, cached := range indexes {
		source, ok := sources[name]
		if !ok || cached.Index.Name != name || cached.Incarnation != source.Incarnation || cached.Origin != source.Origin {
			return fmt.Errorf("extension source state has inconsistent cache for %q", name)
		}
	}
	return nil
}

func encodeMarketplaceState(st marketplaceState) ([]byte, error) {
	st.Version = marketplaceStateVersion
	if st.Indexes == nil {
		st.Indexes = map[string]marketplaceIndexCache{}
	}
	if err := validateMarketplaceState(st); err != nil {
		return nil, err
	}
	return json.Marshal(st)
}

func (p *PluginService) mutateState(change func(*marketplaceState) error) (marketplaceState, error) {
	_, _, present, err := p.state.Load(context.Background())
	if err != nil {
		return marketplaceState{}, err
	}
	initialBytes, err := p.initialCatalogPayload(present)
	if err != nil {
		return marketplaceState{}, err
	}
	payload, _, err := p.state.Update(context.Background(), func() ([]byte, error) {
		if initialBytes == nil {
			return nil, errors.New("extension source state disappeared during update")
		}
		return append([]byte(nil), initialBytes...), nil
	}, func(current []byte) ([]byte, error) {
		st, err := decodeMarketplaceState(current)
		if err != nil {
			return nil, err
		}
		if err := change(&st); err != nil {
			return nil, err
		}
		return encodeMarketplaceState(st)
	})
	if err != nil {
		return marketplaceState{}, err
	}
	return decodeMarketplaceState(payload)
}

func (p *PluginService) initialCatalogPayload(present bool) ([]byte, error) {
	if present {
		return nil, nil
	}
	initial, legacyErr := p.readLegacyState()
	if legacyErr == nil {
		return encodeMarketplaceState(initial)
	}
	_, _, winnerPresent, loadErr := p.state.Load(context.Background())
	if loadErr != nil {
		return nil, loadErr
	}
	if winnerPresent {
		return nil, nil
	}
	return nil, legacyErr
}

func indexList(st marketplaceState) []MarketplaceIndex {
	names := make([]string, 0, len(st.Indexes))
	for name := range st.Indexes {
		names = append(names, name)
	}
	sort.Strings(names)
	out := make([]MarketplaceIndex, 0, len(names))
	for _, name := range names {
		out = append(out, st.Indexes[name].Index)
	}
	return out
}
