package pluginsvc

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/usererror"
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

func (p *PluginService) marketplacesPath() string {
	return filepath.Join(p.dir, marketplacesFile)
}

// httpGetBytes performs one user-initiated download. The seam
// (p.download) exists so tests never reach a real host; the default
// is a plain client with a timeout and a size cap.
func (p *PluginService) httpGetBytes(url string, limit int64) ([]byte, error) {
	data, _, err := p.httpGetBytesForOrigin(url, limit, SourceOrigin{}, false)
	return data, err
}

func (p *PluginService) httpGetBytesForOrigin(rawURL string, limit int64, origin SourceOrigin, artifact bool) ([]byte, string, error) {
	if err := policyRequestRefusal(origin, rawURL, artifact); err != nil {
		return nil, "", err
	}
	if p.download != nil {
		data, err := p.download(rawURL, limit)
		return data, rawURL, err
	}
	return p.downloadHTTP(rawURL, limit, origin, artifact)
}

func (p *PluginService) downloadHTTP(rawURL string, limit int64, origin SourceOrigin, artifact bool) ([]byte, string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), fetchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", fmt.Errorf("that address can't be read")
	}
	client := &http.Client{Timeout: fetchTimeout, CheckRedirect: func(next *http.Request, via []*http.Request) error {
		if len(via) >= 10 {
			return fmt.Errorf("too many redirects")
		}
		if len(via) > 0 && via[len(via)-1].URL.Scheme == "https" && next.URL.Scheme == "http" {
			return fmt.Errorf("an https download cannot redirect to http")
		}
		return policyRequestRefusal(origin, next.URL.String(), artifact)
	}}
	resp, err := client.Do(req)
	if err != nil {
		var userErr *usererror.Error
		if errors.As(err, &userErr) {
			return nil, "", userErr
		}
		return nil, "", fmt.Errorf("couldn't reach that address")
	}
	defer func() { _ = resp.Body.Close() }()
	data, err := readHTTPResponse(resp, limit)
	if err != nil {
		return nil, "", err
	}
	return data, resp.Request.URL.String(), nil
}

func readHTTPResponse(resp *http.Response, limit int64) ([]byte, error) {
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
	raw, _, err := p.httpGetBytesForOrigin(url, maxIndexBytes, src.Origin, false)
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
	// The organisation's allowed sources (policy_service.go) are checked
	// on the pasted locator BEFORE any fetch, and on the index's own
	// name after -- a source may be allowed under either.
	if err := policySourceRegistrationRefusal("", src); err != nil {
		return MarketplaceSource{}, err
	}
	idx, err := p.fetchIndex(src)
	if err != nil {
		return MarketplaceSource{}, err
	}
	if err := policySourceRegistrationRefusal(idx.Name, src); err != nil {
		return MarketplaceSource{}, err
	}
	src.Name = idx.Name
	src.Owner = idx.Owner.Name
	src.AddedAt = time.Now().UTC().Format(time.RFC3339)
	src.Status = SourceCurrent
	src.LastAttemptAt = src.AddedAt
	src.LastSuccessAt = src.AddedAt
	src.Incarnation, err = freshIncarnation()
	if err != nil {
		return MarketplaceSource{}, err
	}
	_, err = p.mutateState(func(st *marketplaceState) error {
		for _, existing := range st.Sources {
			if existing.Name == src.Name {
				return fmt.Errorf("%q is already one of your sources", src.Name)
			}
		}
		st.Sources = append(st.Sources, src)
		st.Indexes[src.Name] = marketplaceIndexCache{Incarnation: src.Incarnation, Origin: src.Origin, Index: idx}
		return nil
	})
	if err != nil {
		return MarketplaceSource{}, err
	}
	return src, nil
}

// ListMarketplaceSources answers the sources the user added, oldest
// first. Mill's own bundled examples are not one of them -- they need
// no source and cannot be removed.
func (p *PluginService) ListMarketplaceSources() ([]MarketplaceSource, error) {
	st, err := p.readState()
	if err != nil {
		return nil, err
	}
	included := MarketplaceSource{Name: ReservedMarketplaceName, Owner: "Mill", Kind: "bundled", Origin: SourceOrigin{Kind: "bundled"}, Incarnation: "bundled", Status: SourceCurrent, Included: true}
	return append([]MarketplaceSource{included}, st.Sources...), nil
}

// RemoveMarketplaceSource drops one source and its cached index.
// Extensions already installed from it stay installed.
func (p *PluginService) RemoveMarketplaceSource(name, expectedIncarnation string) error {
	if name == ReservedMarketplaceName {
		return fmt.Errorf("%q is included with Mill and cannot be removed", name)
	}
	if strings.TrimSpace(expectedIncarnation) == "" {
		return fmt.Errorf("source identity is required")
	}
	_, err := p.mutateState(func(st *marketplaceState) error {
		kept := make([]MarketplaceSource, 0, len(st.Sources))
		found := false
		for _, source := range st.Sources {
			if source.Name == name {
				if source.Incarnation != expectedIncarnation {
					return fmt.Errorf("source changed since it was selected")
				}
				found = true
				continue
			}
			kept = append(kept, source)
		}
		if !found {
			return fmt.Errorf("%q is not one of your sources", name)
		}
		st.Sources = kept
		delete(st.Indexes, name)
		return nil
	})
	return err
}

// RefreshMarketplaceSources re-reads every source's index. A source
// that cannot be read keeps the index it had, and its reason is
// returned -- one unreachable host never empties the whole tab.
func (p *PluginService) RefreshMarketplaceSources() ([]string, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	reserved, err := p.mutateState(func(st *marketplaceState) error {
		for i := range st.Sources {
			st.Sources[i].Generation++
			st.Sources[i].LastAttemptAt = now
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sources := append([]MarketplaceSource(nil), reserved.Sources...)
	problems := []string{}
	for _, src := range sources {
		if err := policySourceRegistrationRefusal(src.Name, src); err != nil {
			problems = append(problems, fmt.Sprintf("%s: %s", src.Name, err.Error()))
			if _, storeErr := p.finishRefresh(src, MarketplaceIndex{}, "source-blocked", err.Error()); storeErr != nil {
				return nil, storeErr
			}
			continue
		}
		idx, err := p.fetchIndex(src)
		if err != nil {
			problems = append(problems, fmt.Sprintf("%s: %s", src.Name, err.Error()))
			if _, storeErr := p.finishRefresh(src, MarketplaceIndex{}, "source-unavailable", err.Error()); storeErr != nil {
				return nil, storeErr
			}
			continue
		}
		if idx.Name != src.Name {
			problems = append(problems, fmt.Sprintf("%s: Source identity changed", src.Name))
			if _, storeErr := p.finishRefresh(src, MarketplaceIndex{}, "source-identity-changed", "Source identity changed"); storeErr != nil {
				return nil, storeErr
			}
			continue
		}
		if err := policySourceRegistrationRefusal(src.Name, src); err != nil {
			problems = append(problems, fmt.Sprintf("%s: %s", src.Name, err.Error()))
			if _, storeErr := p.finishRefresh(src, MarketplaceIndex{}, "source-blocked", err.Error()); storeErr != nil {
				return nil, storeErr
			}
			continue
		}
		accepted, storeErr := p.finishRefresh(src, idx, "", "")
		if storeErr != nil {
			return nil, storeErr
		}
		if !accepted {
			problems = append(problems, fmt.Sprintf("%s: refresh result was discarded", src.Name))
		}
	}
	return problems, nil
}

func (p *PluginService) finishRefresh(expected MarketplaceSource, idx MarketplaceIndex, code, detail string) (bool, error) {
	accepted := false
	_, err := p.mutateState(func(st *marketplaceState) error {
		for i := range st.Sources {
			source := &st.Sources[i]
			if source.Name != expected.Name || source.Incarnation != expected.Incarnation || source.Origin != expected.Origin || source.Generation != expected.Generation {
				continue
			}
			accepted = true
			source.ErrorCode, source.ErrorDetail = code, detail
			if code != "" {
				if code == "source-blocked" {
					source.Status = SourceBlocked
				} else {
					source.Status = SourceUnavailable
				}
				return nil
			}
			source.Status = SourceCurrent
			source.LastSuccessAt = source.LastAttemptAt
			source.Owner = idx.Owner.Name
			st.Indexes[source.Name] = marketplaceIndexCache{Incarnation: source.Incarnation, Origin: source.Origin, Index: idx}
			return nil
		}
		return nil
	})
	return accepted, err
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
	Tier         string
	PolicyReason string
}

type BrowseResult struct {
	Entries             []BrowseEntry
	Sources             []MarketplaceSource
	InstalledStateReady bool
	InstalledStateError string
}

// BrowseMarketplaces lists every cached index's entries plus Mill's
// own bundled examples, sorted by marketplace then name. Reads only
// what is already on disk: opening Browse never fetches.
func (p *PluginService) BrowseMarketplaces() (BrowseResult, error) {
	installed, installedErr := p.installedPluginIDs()
	st, err := p.readState()
	if err != nil {
		return BrowseResult{}, err
	}
	bundled, err := p.exampleIndexChecked()
	if err != nil {
		return BrowseResult{}, err
	}
	out := p.browseRows(append([]MarketplaceIndex{bundled}, indexList(st)...), st.Sources, installed)
	sources, err := p.ListMarketplaceSources()
	if err != nil {
		return BrowseResult{}, err
	}
	result := BrowseResult{Entries: out, Sources: sources, InstalledStateReady: installedErr == nil}
	if installedErr != nil {
		result.InstalledStateError = installedErr.Error()
	}
	return result, nil
}

func (p *PluginService) installedPluginIDs() (map[string]bool, error) {
	installed := map[string]bool{}
	infos, err := p.ListPlugins()
	if err != nil {
		return installed, err
	}
	for _, info := range infos {
		installed[info.Manifest.ID] = true
	}
	return installed, nil
}

func (p *PluginService) browseRows(indexes []MarketplaceIndex, sources []MarketplaceSource, installed map[string]bool) []BrowseEntry {
	origins := map[string]SourceOrigin{ReservedMarketplaceName: {Kind: "bundled"}}
	for _, source := range sources {
		origins[source.Name] = source.Origin
	}
	rows := []BrowseEntry{}
	for _, idx := range indexes {
		for _, entry := range idx.Plugins {
			rows = append(rows, p.browseRow(idx, entry, origins[idx.Name], installed[entry.ID]))
		}
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].Marketplace != rows[j].Marketplace {
			return rows[i].Marketplace < rows[j].Marketplace
		}
		return strings.ToLower(rows[i].Name) < strings.ToLower(rows[j].Name)
	})
	return rows
}

func (p *PluginService) browseRow(idx MarketplaceIndex, entry MarketplaceEntry, origin SourceOrigin, installed bool) BrowseEntry {
	tier := entryTier(idx.Name, entry)
	row := BrowseEntry{
		Marketplace: idx.Name,
		Owner:       idx.Owner.Name,
		ID:          entry.ID,
		Name:        entry.Name,
		Description: entry.Description,
		Version:     entry.Version,
		Author:      entry.Author,
		Kinds:       entry.Kinds,
		Installed:   installed,
		Tier:        tier,
	}
	manifest := Manifest{ID: entry.ID, Version: entry.Version}
	if known, readable := p.previewManifest(idx, entry); readable {
		manifest = known
	}
	if refusal := policyInstallRefusalOriginAt(manifest, tier, origin, idx.Name, "", ""); refusal != nil {
		row.PolicyReason = refusal.Error()
	}
	return row
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

// findEntry resolves one marketplace entry by marketplace and plugin
// id, over the cached indexes and the bundled examples alike.
func (p *PluginService) findEntry(marketplace, id string) (MarketplaceIndex, MarketplaceEntry, error) {
	st, err := p.readState()
	if err != nil {
		return MarketplaceIndex{}, MarketplaceEntry{}, err
	}
	bundled, err := p.exampleIndexChecked()
	if err != nil {
		return MarketplaceIndex{}, MarketplaceEntry{}, err
	}
	for _, idx := range append([]MarketplaceIndex{bundled}, indexList(st)...) {
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
	st, err := p.readState()
	if err != nil {
		return MarketplaceSource{}, false
	}
	for _, s := range st.Sources {
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
