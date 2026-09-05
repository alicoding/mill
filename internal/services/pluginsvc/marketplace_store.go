package pluginsvc

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// The source list and its cached indexes (docs/goals/0349). Sources
// live in a hidden file inside the plugins directory itself, beside
// the folders they install: one directory carries the whole extension
// state, so a test, a second data directory, or a copied profile takes
// its marketplaces with it. ListPlugins only reads directory entries,
// so this file is never mistaken for a plugin.
//
// Each source's last successfully-parsed index is cached here too --
// Browse reads the cache, never the network, so opening the tab is
// instant and works offline. A refresh is the only thing that fetches,
// and only because the user pressed it.

const marketplacesFile = ".mill-marketplaces.json"

// fetchTimeout bounds every user-initiated download. Long enough for a
// slow release asset, short enough that a hung host does not hold the
// UI's notice open forever.
const fetchTimeout = 60 * time.Second

// maxIndexBytes caps an index download; an index is a small JSON file,
// and anything larger is a wrong address, not a marketplace.
const maxIndexBytes int64 = 4 << 20

// maxDownloadBytes caps an archive download.
const maxDownloadBytes int64 = maxArchiveBytes

type marketplaceState struct {
	Sources []MarketplaceSource         `json:"sources"`
	Indexes map[string]MarketplaceIndex `json:"indexes"`
	// Updates is the last Check for updates outcome (updates.go).
	Updates UpdateCheck `json:"updates"`
}

var marketplaceStateMu sync.Mutex

func (p *PluginService) marketplacesPath() string {
	return filepath.Join(p.dir, marketplacesFile)
}

func (p *PluginService) readState() marketplaceState {
	st := marketplaceState{Indexes: map[string]MarketplaceIndex{}}
	raw, err := os.ReadFile(p.marketplacesPath()) // #nosec G304 -- this service's own plugins directory
	if err != nil {
		return st
	}
	if err := json.Unmarshal(raw, &st); err != nil {
		return marketplaceState{Indexes: map[string]MarketplaceIndex{}}
	}
	if st.Indexes == nil {
		st.Indexes = map[string]MarketplaceIndex{}
	}
	return st
}

func (p *PluginService) writeState(st marketplaceState) error {
	if err := os.MkdirAll(p.dir, 0o750); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p.marketplacesPath(), raw, 0o600)
}

// httpGetBytes performs one user-initiated download. The seam
// (p.download) exists so tests never reach a real host; the default
// is a plain client with a timeout and a size cap.
func (p *PluginService) httpGetBytes(url string, limit int64) ([]byte, error) {
	if p.download != nil {
		return p.download(url, limit)
	}
	ctx, cancel := context.WithTimeout(context.Background(), fetchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("that address can't be read")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("couldn't reach that address")
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("nothing is published at that address")
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("that address answered %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, fmt.Errorf("that download stopped partway")
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("that download is too large")
	}
	return data, nil
}

// fetchIndex reads one source's index -- from disk for a folder
// source, over https for every other kind. Called only from AddSource
// and RefreshSource.
func (p *PluginService) fetchIndex(src MarketplaceSource) (MarketplaceIndex, error) {
	if src.Kind == "path" {
		raw, err := os.ReadFile(filepath.Join(expandHome(src.Locator), filepath.FromSlash(IndexFile))) // #nosec G304 -- a folder the user chose
		if err != nil {
			return MarketplaceIndex{}, fmt.Errorf("that folder has no %s file", IndexFile)
		}
		return ParseIndex(raw)
	}
	url, err := IndexURL(src)
	if err != nil {
		return MarketplaceIndex{}, err
	}
	raw, err := p.httpGetBytes(url, maxIndexBytes)
	if err != nil {
		return MarketplaceIndex{}, err
	}
	return ParseIndex(raw)
}

// AddMarketplaceSource adds one source and reads its index once, so a
// wrong address is refused while the user is still looking at the
// field rather than silently listing nothing later.
func (p *PluginService) AddMarketplaceSource(input string) (MarketplaceSource, error) {
	src, err := ClassifySource(input)
	if err != nil {
		return MarketplaceSource{}, err
	}
	idx, err := p.fetchIndex(src)
	if err != nil {
		return MarketplaceSource{}, err
	}
	src.Name = idx.Name
	src.AddedAt = time.Now().UTC().Format(time.RFC3339)
	marketplaceStateMu.Lock()
	defer marketplaceStateMu.Unlock()
	st := p.readState()
	for _, existing := range st.Sources {
		if existing.Name == src.Name {
			return MarketplaceSource{}, fmt.Errorf("%q is already one of your sources", src.Name)
		}
	}
	st.Sources = append(st.Sources, src)
	st.Indexes[src.Name] = idx
	if err := p.writeState(st); err != nil {
		return MarketplaceSource{}, err
	}
	return src, nil
}

// ListMarketplaceSources answers the sources the user added, oldest
// first. Mill's own bundled examples are not one of them -- they need
// no source and cannot be removed.
func (p *PluginService) ListMarketplaceSources() ([]MarketplaceSource, error) {
	marketplaceStateMu.Lock()
	defer marketplaceStateMu.Unlock()
	st := p.readState()
	if st.Sources == nil {
		return []MarketplaceSource{}, nil
	}
	return st.Sources, nil
}

// RemoveMarketplaceSource drops one source and its cached index.
// Extensions already installed from it stay installed.
func (p *PluginService) RemoveMarketplaceSource(name string) error {
	marketplaceStateMu.Lock()
	defer marketplaceStateMu.Unlock()
	st := p.readState()
	kept := make([]MarketplaceSource, 0, len(st.Sources))
	found := false
	for _, s := range st.Sources {
		if s.Name == name {
			found = true
			continue
		}
		kept = append(kept, s)
	}
	if !found {
		return fmt.Errorf("%q is not one of your sources", name)
	}
	st.Sources = kept
	delete(st.Indexes, name)
	return p.writeState(st)
}

// RefreshMarketplaceSources re-reads every source's index. A source
// that cannot be read keeps the index it had, and its reason is
// returned -- one unreachable host never empties the whole tab.
func (p *PluginService) RefreshMarketplaceSources() ([]string, error) {
	marketplaceStateMu.Lock()
	sources := append([]MarketplaceSource(nil), p.readState().Sources...)
	marketplaceStateMu.Unlock()
	fetched := map[string]MarketplaceIndex{}
	problems := []string{}
	for _, src := range sources {
		idx, err := p.fetchIndex(src)
		if err != nil {
			problems = append(problems, fmt.Sprintf("%s: %s", src.Name, err.Error()))
			continue
		}
		fetched[src.Name] = idx
	}
	marketplaceStateMu.Lock()
	defer marketplaceStateMu.Unlock()
	st := p.readState()
	for name, idx := range fetched {
		st.Indexes[name] = idx
	}
	if err := p.writeState(st); err != nil {
		return problems, err
	}
	return problems, nil
}

// BrowseEntry is one offering in the Browse tab: the index's own
// description of a plugin, plus which marketplace it came from and
// whether it is already installed.
type BrowseEntry struct {
	Marketplace string
	Owner       string
	ID          string
	Name        string
	Description string
	Version     string
	Author      string
	Kinds       []string
	Installed   bool
	// Tier is what installing this entry would earn, before any
	// download -- "hash-pinned" when the index declares a hash,
	// "unverified" when it does not.
	Tier string
}

// BrowseMarketplaces lists every cached index's entries plus Mill's
// own bundled examples, sorted by marketplace then name. Reads only
// what is already on disk: opening Browse never fetches.
func (p *PluginService) BrowseMarketplaces() ([]BrowseEntry, error) {
	installed := map[string]bool{}
	infos, err := p.ListPlugins()
	if err == nil {
		for _, info := range infos {
			installed[info.Manifest.ID] = true
		}
	}
	marketplaceStateMu.Lock()
	st := p.readState()
	marketplaceStateMu.Unlock()
	out := []BrowseEntry{}
	for _, idx := range append([]MarketplaceIndex{p.exampleIndex()}, indexList(st)...) {
		for _, e := range idx.Plugins {
			out = append(out, BrowseEntry{
				Marketplace: idx.Name,
				Owner:       idx.Owner.Name,
				ID:          e.ID,
				Name:        e.Name,
				Description: e.Description,
				Version:     e.Version,
				Author:      e.Author,
				Kinds:       e.Kinds,
				Installed:   installed[e.ID],
				Tier:        entryTier(idx.Name, e),
			})
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Marketplace != out[j].Marketplace {
			return out[i].Marketplace < out[j].Marketplace
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

// entryTier is what a browse row PROMISES, before anything is
// downloaded -- and it must agree with what the install actually
// records, or the prompt would ask for an acknowledgment the install
// never needed. Mill's own bundled examples come out of the binary and
// are verified by definition; a folder entry is copied off this Mac,
// which is dev; anything downloaded is pinned only if its index
// declared a hash.
func entryTier(marketplace string, e MarketplaceEntry) string {
	if marketplace == ReservedMarketplaceName {
		return TierVerified
	}
	if e.Source.Kind == "path" {
		return TierDev
	}
	if strings.TrimSpace(declaredHash(e)) != "" {
		return TierHashPinned
	}
	return TierUnverified
}

func declaredHash(e MarketplaceEntry) string {
	if strings.TrimSpace(e.SHA256) != "" {
		return e.SHA256
	}
	return e.Source.SHA256
}

func indexList(st marketplaceState) []MarketplaceIndex {
	names := make([]string, 0, len(st.Indexes))
	for name := range st.Indexes {
		names = append(names, name)
	}
	sort.Strings(names)
	out := make([]MarketplaceIndex, 0, len(names))
	for _, name := range names {
		out = append(out, st.Indexes[name])
	}
	return out
}

// findEntry resolves one marketplace entry by marketplace and plugin
// id, over the cached indexes and the bundled examples alike.
func (p *PluginService) findEntry(marketplace, id string) (MarketplaceIndex, MarketplaceEntry, error) {
	marketplaceStateMu.Lock()
	st := p.readState()
	marketplaceStateMu.Unlock()
	for _, idx := range append([]MarketplaceIndex{p.exampleIndex()}, indexList(st)...) {
		if idx.Name != marketplace {
			continue
		}
		for _, e := range idx.Plugins {
			if e.ID == id {
				return idx, e, nil
			}
		}
	}
	return MarketplaceIndex{}, MarketplaceEntry{}, fmt.Errorf("%q is no longer offered by %q", id, marketplace)
}

// sourceFor answers the source a marketplace was added from, so a
// path-kind entry resolves against the folder the index lives in.
func (p *PluginService) sourceFor(marketplace string) (MarketplaceSource, bool) {
	marketplaceStateMu.Lock()
	defer marketplaceStateMu.Unlock()
	for _, s := range p.readState().Sources {
		if s.Name == marketplace {
			return s, true
		}
	}
	return MarketplaceSource{}, false
}

// SetDownloader replaces the user-initiated download seam.
//
//wails:ignore
func (p *PluginService) SetDownloader(fn func(url string, limit int64) ([]byte, error)) {
	p.download = fn
}
