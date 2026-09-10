package pluginsvc

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"golang.org/x/mod/semver"
)

// Updates on request (docs/goals/0349 S5, ADR-0047): Mill finds a newer
// version of an installed extension ONLY when someone presses Check
// for updates -- there is no timer, no launch-time check and no retry,
// because every outbound request here is a user action (SPEC §1.1).
//
// A check re-reads every marketplace the user added, then compares
// each installed extension's version with what its source offers now:
// the marketplace entry it came from, a repository's latest release,
// or the folder it was copied from. Only a strictly newer semver is
// offered -- a downgrade is never listed. Applying an update runs the
// same install door the first install took, so the tier rules and the
// unverified acknowledgment hold exactly as before.

// UpdateCandidate is one extension a newer version is known for.
type UpdateCandidate struct {
	ID          string
	Name        string
	Installed   string
	Available   string
	Marketplace string
	// Tier is what applying the update would earn, before any
	// download -- the same promise a Browse row makes.
	Tier   string
	Source PluginSource
	Origin SourceOrigin
}

// UpdateCheck is the last check's outcome, persisted beside the
// source list so the Updates tab and its count survive a relaunch
// without a new fetch. CheckedAt is "" when no check has ever run.
type UpdateCheck struct {
	CheckedAt  string            `json:"checkedAt"`
	Candidates []UpdateCandidate `json:"candidates"`
	// Problems names each source or extension the check could not
	// read, so one unreachable host never hides as "up to date".
	Problems []string `json:"problems"`
}

// ListUpdates answers the last check as it was recorded -- never a
// fetch.
func (p *PluginService) ListUpdates() (UpdateCheck, error) {
	st, err := p.readState()
	if err != nil {
		return UpdateCheck{}, err
	}
	check := st.Updates
	if check.Candidates == nil {
		check.Candidates = []UpdateCandidate{}
	}
	if check.Problems == nil {
		check.Problems = []string{}
	}
	return check, nil
}

// CheckForUpdates refreshes every source, then resolves the latest
// version for each installed extension that carries an install
// receipt. Built-ins and hand-copied folders have no source to ask.
func (p *PluginService) CheckForUpdates() (UpdateCheck, error) {
	problems, err := p.RefreshMarketplaceSources()
	if err != nil {
		return UpdateCheck{}, err
	}
	check := UpdateCheck{
		CheckedAt:  time.Now().UTC().Format(time.RFC3339),
		Candidates: []UpdateCandidate{},
		Problems:   append([]string{}, problems...),
	}
	infos, err := p.ListPlugins()
	if err != nil {
		return UpdateCheck{}, err
	}
	for _, info := range infos {
		if info.Builtin || info.Manifest.ID == "" {
			continue
		}
		rec, ok := ReadInstallRecord(info.Dir)
		if !ok {
			continue
		}
		cand, problem, found := p.updateCandidateFor(info, rec)
		if problem != "" {
			check.Problems = append(check.Problems, info.Manifest.ID+": "+problem)
		}
		if found {
			check.Candidates = append(check.Candidates, cand)
		}
	}
	sort.Slice(check.Candidates, func(i, j int) bool { return check.Candidates[i].ID < check.Candidates[j].ID })
	_, err = p.mutateState(func(st *marketplaceState) error {
		st.Updates = check
		return nil
	})
	return check, err
}

// updateCandidateFor asks one extension's own source what it offers
// now. The answer is a candidate only when that version is strictly
// newer than the installed one.
func (p *PluginService) updateCandidateFor(info PluginInfo, rec InstallRecord) (UpdateCandidate, string, bool) {
	cand := UpdateCandidate{
		ID:          info.Manifest.ID,
		Name:        info.Manifest.Name,
		Installed:   info.Manifest.Version,
		Marketplace: rec.Marketplace,
		Source:      rec.Source,
		Origin:      rec.Origin,
	}
	if err := policyUpdateDiscoveryRefusal(rec.Origin); err != nil {
		return cand, err.Error(), false
	}
	var problem string
	switch {
	case rec.Marketplace != "":
		source, ok := p.sourceFor(rec.Marketplace)
		if !ok || (rec.Origin.Kind != "" && source.Origin != rec.Origin) {
			return cand, "Source could not be verified. Reinstall this extension from an allowed source.", false
		}
		idx, entry, err := p.findEntry(rec.Marketplace, info.Manifest.ID)
		if err != nil {
			return cand, err.Error(), false
		}
		cand.Available = entry.Version
		cand.Tier = entryTier(idx.Name, entry)
	case rec.Source.Kind == "github":
		tag, err := p.latestReleaseTag(rec.Source.Repo, rec.Origin)
		if err != nil {
			return cand, err.Error(), false
		}
		cand.Available = strings.TrimPrefix(tag, "v")
		// A release found by asking the repository directly declares
		// no hash Mill can pin to, so it earns the unverified tier.
		cand.Tier = TierUnverified
	case rec.Source.Kind == "path":
		version, err := p.folderManifestVersion(rec.Source.Path, rec.Origin)
		if err != nil {
			return cand, err.Error(), false
		}
		cand.Available = version
		cand.Tier = TierDev
	default:
		return cand, "", false
	}
	if !NewerVersion(cand.Available, cand.Installed) {
		return cand, problem, false
	}
	return cand, problem, true
}

// NewerVersion reports whether available is a strictly newer semver
// than installed. Anything that does not parse is never newer -- an
// unparseable version cannot be compared, so nothing is offered.
func NewerVersion(available, installed string) bool {
	a := "v" + strings.TrimPrefix(strings.TrimSpace(available), "v")
	i := "v" + strings.TrimPrefix(strings.TrimSpace(installed), "v")
	if !semver.IsValid(a) || !semver.IsValid(i) {
		return false
	}
	return semver.Compare(a, i) > 0
}

// LatestReleaseURL is the one address that answers a repository's
// newest release without a token: the releases API's "latest".
func LatestReleaseURL(repo string) string {
	return "https://api.github.com/repos/" + repo + "/releases/latest"
}

// ParseLatestReleaseTag reads the tag out of the releases API's
// answer.
func ParseLatestReleaseTag(raw []byte) (string, error) {
	var body struct {
		TagName string `json:"tag_name"`
	}
	if err := json.Unmarshal(raw, &body); err != nil || strings.TrimSpace(body.TagName) == "" {
		return "", fmt.Errorf("that repository's latest release could not be read")
	}
	return strings.TrimSpace(body.TagName), nil
}

func (p *PluginService) latestReleaseTag(repo string, origin SourceOrigin) (string, error) {
	return p.latestReleaseTagAt(repo, LatestReleaseURL(repo), origin)
}

func (p *PluginService) latestReleaseTagAt(repo, rawURL string, origin SourceOrigin) (string, error) {
	if !repoPattern.MatchString(repo) {
		return "", fmt.Errorf("the install receipt names no repository")
	}
	raw, _, err := p.httpGetBytesForOrigin(rawURL, maxIndexBytes, origin, true)
	if err != nil {
		return "", err
	}
	return ParseLatestReleaseTag(raw)
}

func (p *PluginService) folderManifestVersion(dir string, origin SourceOrigin) (string, error) {
	if origin.Kind == "" {
		source, err := canonicalSource(MarketplaceSource{Kind: "path", Locator: expandHome(dir)})
		if err != nil {
			return "", fmt.Errorf("the folder it was installed from could not be verified")
		}
		origin = source.Origin
	}
	raw, err := p.readSourceFile(origin, "manifest.json")
	if err != nil {
		return "", fmt.Errorf("the folder it was installed from has no manifest.json")
	}
	var m struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		return "", fmt.Errorf("the folder it was installed from has an unreadable manifest.json")
	}
	return m.Version, nil
}

// updateCandidate answers the recorded candidate for one extension.
func (p *PluginService) updateCandidate(id string) (UpdateCandidate, bool, error) {
	st, err := p.readState()
	if err != nil {
		return UpdateCandidate{}, false, err
	}
	for _, c := range st.Updates.Candidates {
		if c.ID == id {
			return c, true, nil
		}
	}
	return UpdateCandidate{}, false, nil
}

// PreviewUpdate answers the install prompt's contents for an update:
// what the newer version can do, and the tier applying it would earn.
// Reads only what is cached -- previewing never downloads.
func (p *PluginService) PreviewUpdate(id string) (InstallPreview, error) {
	cand, ok, err := p.updateCandidate(id)
	if err != nil {
		return InstallPreview{}, err
	}
	if !ok {
		return InstallPreview{}, fmt.Errorf("no update is known for %q; check for updates first", id)
	}
	if cand.Marketplace != "" {
		pv, err := p.PreviewInstall(cand.Marketplace, id)
		if err != nil {
			return InstallPreview{}, err
		}
		pv.AlreadyInstalled = true
		return pv, nil
	}
	info := p.resolvePlugin(id)
	pv := InstallPreview{
		ID: id, Name: info.Manifest.Name, Version: cand.Available, Author: info.Manifest.Author,
		Description: info.Manifest.Description, Tier: cand.Tier, AlreadyInstalled: true,
	}
	applyManifestToPreview(&pv, info.Manifest, info.Builtin)
	pv.Version = cand.Available
	return pv, nil
}

// UpdatePlugin applies one recorded candidate through the same install
// door the extension first came through, then drops it from the list.
func (p *PluginService) UpdatePlugin(id string) (InstallRecord, error) {
	cand, ok, err := p.updateCandidate(id)
	if err != nil {
		return InstallRecord{}, err
	}
	if !ok {
		return InstallRecord{}, fmt.Errorf("no update is known for %q; check for updates first", id)
	}
	rec, err := p.installCandidate(cand)
	if err != nil {
		return InstallRecord{}, err
	}
	_, err = p.mutateState(func(st *marketplaceState) error {
		kept := make([]UpdateCandidate, 0, len(st.Updates.Candidates))
		for _, c := range st.Updates.Candidates {
			if c.ID != id {
				kept = append(kept, c)
			}
		}
		st.Updates.Candidates = kept
		return nil
	})
	return rec, err
}

func (p *PluginService) installCandidate(cand UpdateCandidate) (InstallRecord, error) {
	switch {
	case cand.Marketplace != "":
		return p.InstallFromMarketplace(cand.Marketplace, cand.ID)
	case cand.Source.Kind == "github":
		stage, cleanup, err := stageDir()
		if err != nil {
			return InstallRecord{}, err
		}
		defer cleanup()
		tier, finalURL, err := p.stageRepo(stage, cand.Source.Repo, cand.Source.Ref, cand.ID, cand.Available, "", cand.Origin)
		if err != nil {
			return InstallRecord{}, err
		}
		return p.finishInstall(stage, InstallRecord{Source: cand.Source, Tier: tier, Origin: cand.Origin, FinalArtifactURL: finalURL})
	case cand.Source.Kind == "path":
		if cand.Origin.Kind == "" {
			return p.InstallFromLink(cand.Source.Path)
		}
		if err := policyUpdateDiscoveryRefusal(cand.Origin); err != nil {
			return InstallRecord{}, err
		}
		stage, cleanup, err := stageDir()
		if err != nil {
			return InstallRecord{}, err
		}
		defer cleanup()
		if err := p.copySourceFolder(cand.Origin, ".", stage); err != nil {
			return InstallRecord{}, err
		}
		return p.finishInstall(stage, InstallRecord{Source: cand.Source, Tier: TierDev, Origin: cand.Origin})
	}
	return InstallRecord{}, fmt.Errorf("%q has no source an update can come from", cand.ID)
}
