package pluginsvc

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

// The federated marketplace index (docs/goals/0349, ADR-0047): a
// marketplace is any repository or folder carrying `.mill/marketplace.json`
// at its root, and Mill holds a LIST of them rather than one index of
// its own. There is no hosted service anywhere in this file.
//
// Every fetch in this package happens only inside a user action --
// adding a source, refreshing one, installing, checking for updates.
// Nothing here polls, schedules or retries in the background: SPEC
// §1.1's zero-outbound constraint is the reason the refresh is a
// button and not a timer.

// IndexFile is the path a marketplace repository publishes its index
// at, relative to the repository root.
const IndexFile = ".mill/marketplace.json"

// ReservedMarketplaceName is the name Mill's own bundled examples
// marketplace answers to; an added source may not claim it.
const ReservedMarketplaceName = "mill"

// marketplaceNamePattern pins a marketplace name to the same slug
// shape a plugin id takes -- the name is a stable key in the source
// list and appears in a row's "from" line, never free text.
var marketplaceNamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

// MarketplaceOwner names who publishes an index, for the Sources
// dialog to attribute it.
type MarketplaceOwner struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// PluginSource is where one marketplace entry's files come from. Kind
// is "path" (a folder relative to the index), "github" (a repository's
// releases) or "archive" (a direct zip URL). SHA256 is the bare hex
// digest of the downloaded archive when the publisher declares one --
// declaring it is what earns the hash-pinned tier.
type PluginSource struct {
	Kind   string `json:"kind"`
	Path   string `json:"path"`
	Repo   string `json:"repo"`
	Ref    string `json:"ref"`
	SHA    string `json:"sha"`
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
}

// MarketplaceEntry is one plugin an index offers.
type MarketplaceEntry struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Version     string       `json:"version"`
	Author      string       `json:"author"`
	Kinds       []string     `json:"kinds"`
	SHA256      string       `json:"sha256"`
	Source      PluginSource `json:"source"`
}

// MarketplaceIndex is a parsed `.mill/marketplace.json`.
type MarketplaceIndex struct {
	Name    string             `json:"name"`
	Owner   MarketplaceOwner   `json:"owner"`
	Plugins []MarketplaceEntry `json:"plugins"`
}

// ParseIndex reads an index's bytes and refuses anything that would
// make its entries ambiguous: a name outside the slug shape, the
// reserved name, an entry with no id or an unknown source kind, and
// two entries claiming the same id (which would make "install the
// entry with id X" undefined).
func ParseIndex(raw []byte) (MarketplaceIndex, error) {
	var idx MarketplaceIndex
	if err := json.Unmarshal(raw, &idx); err != nil {
		return MarketplaceIndex{}, fmt.Errorf("that file is not a valid marketplace index")
	}
	idx.Name = strings.TrimSpace(idx.Name)
	if !marketplaceNamePattern.MatchString(idx.Name) {
		return MarketplaceIndex{}, fmt.Errorf("the marketplace name must be lowercase letters, digits, and hyphens")
	}
	if idx.Name == ReservedMarketplaceName {
		return MarketplaceIndex{}, fmt.Errorf("the name %q is reserved for the extensions Mill ships", ReservedMarketplaceName)
	}
	seen := map[string]bool{}
	for i := range idx.Plugins {
		e := &idx.Plugins[i]
		e.ID = strings.TrimSpace(e.ID)
		if !pluginIDPattern.MatchString(e.ID) {
			return MarketplaceIndex{}, fmt.Errorf("the plugin id %q must be lowercase letters, digits, and hyphens", e.ID)
		}
		if seen[e.ID] {
			return MarketplaceIndex{}, fmt.Errorf("the index lists %q twice", e.ID)
		}
		seen[e.ID] = true
		if err := validateSource(e.Source); err != nil {
			return MarketplaceIndex{}, fmt.Errorf("%s: %w", e.ID, err)
		}
	}
	return idx, nil
}

func validateSource(s PluginSource) error {
	switch s.Kind {
	case "path":
		if strings.TrimSpace(s.Path) == "" {
			return fmt.Errorf("a path source needs a path")
		}
		if !safeRelPath(s.Path) {
			return fmt.Errorf("a path source must stay inside the marketplace folder")
		}
	case "github":
		if !repoPattern.MatchString(strings.TrimSpace(s.Repo)) {
			return fmt.Errorf("a github source needs an owner/repo")
		}
	case "archive":
		u, err := url.Parse(strings.TrimSpace(s.URL))
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
			return fmt.Errorf("an archive source needs an http address")
		}
	default:
		return fmt.Errorf("unknown source kind %q", s.Kind)
	}
	return nil
}

// repoPattern is GitHub's own owner/repo shape.
var repoPattern = regexp.MustCompile(`^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$`)

// safeRelPath rejects anything that would escape the folder it is
// resolved against -- the same traversal refusal the archive extractor
// applies, checked here so a bad index never reaches the copy step.
func safeRelPath(p string) bool {
	p = strings.ReplaceAll(p, `\`, "/")
	if strings.HasPrefix(p, "/") || strings.Contains(p, "://") {
		return false
	}
	for _, seg := range strings.Split(p, "/") {
		if seg == ".." {
			return false
		}
	}
	return true
}

// MarketplaceSource is one place Mill reads an index from, as the user
// added it. Kind is "github" (owner/repo[@ref]), "git" (a repository
// URL), "url" (a direct index address) or "path" (a folder on this
// Mac). Name is filled in from the index the first time it parses.
type MarketplaceSource struct {
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	Locator string `json:"locator"`
	Ref     string `json:"ref"`
	AddedAt string `json:"addedAt"`
}

// ClassifySource reads what the user typed in "Add source" and answers
// the source it names. Four shapes, in the order a person is likeliest
// to paste them: an absolute folder, an http(s) address, owner/repo
// with an optional @ref, and a git remote.
func ClassifySource(input string) (MarketplaceSource, error) {
	raw := strings.TrimSpace(input)
	if raw == "" {
		return MarketplaceSource{}, fmt.Errorf("enter a repo, an address, or a folder")
	}
	if strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "~") {
		return MarketplaceSource{Kind: "path", Locator: raw}, nil
	}
	if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
		if strings.HasSuffix(raw, ".git") {
			return MarketplaceSource{Kind: "git", Locator: raw}, nil
		}
		return MarketplaceSource{Kind: "url", Locator: raw}, nil
	}
	if strings.HasPrefix(raw, "git@") || strings.HasSuffix(raw, ".git") {
		return MarketplaceSource{Kind: "git", Locator: raw}, nil
	}
	repo, ref, _ := strings.Cut(raw, "@")
	if repoPattern.MatchString(repo) {
		return MarketplaceSource{Kind: "github", Locator: repo, Ref: ref}, nil
	}
	return MarketplaceSource{}, fmt.Errorf("that is not a repo, an address, or a folder")
}

// IndexURL answers where a source's index is fetched from. A github
// source resolves to the raw file at its ref (HEAD when unpinned) --
// the one address that needs no clone and no API token; a git remote
// resolves through the same rule when it is a GitHub remote. A path
// source has no URL at all (the caller reads the file directly).
func IndexURL(s MarketplaceSource) (string, error) {
	switch s.Kind {
	case "url":
		return s.Locator, nil
	case "github":
		return rawGitHubIndexURL(s.Locator, s.Ref), nil
	case "git":
		owner, repo, ok := gitHubRemoteRepo(s.Locator)
		if !ok {
			return "", fmt.Errorf("an index is read over https, so this remote needs its marketplace.json address instead")
		}
		return rawGitHubIndexURL(owner+"/"+repo, s.Ref), nil
	case "path":
		return "", fmt.Errorf("a folder source is read from disk")
	}
	return "", fmt.Errorf("unknown source kind %q", s.Kind)
}

func rawGitHubIndexURL(repo, ref string) string {
	if strings.TrimSpace(ref) == "" {
		ref = "HEAD"
	}
	return "https://raw.githubusercontent.com/" + repo + "/" + ref + "/" + IndexFile
}

// gitHubRemoteRepo pulls owner/repo out of an https or ssh GitHub
// remote, reporting false for any other host.
func gitHubRemoteRepo(remote string) (owner, repo string, ok bool) {
	r := strings.TrimSuffix(strings.TrimSpace(remote), ".git")
	switch {
	case strings.HasPrefix(r, "git@github.com:"):
		r = strings.TrimPrefix(r, "git@github.com:")
	case strings.HasPrefix(r, "https://github.com/"):
		r = strings.TrimPrefix(r, "https://github.com/")
	case strings.HasPrefix(r, "http://github.com/"):
		r = strings.TrimPrefix(r, "http://github.com/")
	default:
		return "", "", false
	}
	owner, repo, found := strings.Cut(r, "/")
	if !found || owner == "" || repo == "" || strings.Contains(repo, "/") {
		return "", "", false
	}
	return owner, repo, true
}

// BranchArchiveURL is the fallback a github source falls back to when
// a repository publishes no release: the branch as a zip, which
// nothing signs and nothing pins -- the unverified tier by
// construction.
func BranchArchiveURL(repo, ref string) string {
	if strings.TrimSpace(ref) == "" {
		ref = "HEAD"
	}
	return "https://codeload.github.com/" + repo + "/zip/" + ref
}
