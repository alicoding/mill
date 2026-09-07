package pluginsvc

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/usererror"
)

// The install door (docs/goals/0349, ADR-0047): one path onto disk for
// every way a plugin arrives -- a marketplace entry, a repository, an
// archive address, or a folder on this Mac. Each fetch happens inside
// a user action and nowhere else.
//
// The order is always the same: stage into a temp folder, check the
// hash when one was declared, read the manifest's own id, refuse to
// overwrite a DIFFERENT plugin at that id, then move the folder into
// place and write the receipt. Nothing is written under the plugins
// directory until every check has passed.

// InstallSpec is what the caller asks to install. Exactly one shape is
// meaningful at a time: a marketplace entry (Marketplace + ID), a
// repository (Repo [+ Ref]), an archive (URL [+ SHA256]), or a folder
// (Path).
type InstallSpec struct {
	Marketplace string
	ID          string
	Repo        string
	Ref         string
	URL         string
	SHA256      string
	Path        string
}

// InstallPreview is what the user is shown BEFORE anything downloads:
// who the extension is, what installing it would earn for trust, and
// what it can do once it runs. Every permission-shaped fact a manifest
// declares is here, so the prompt never has to re-derive one.
type InstallPreview struct {
	ID          string
	Name        string
	Version     string
	Author      string
	Description string
	Marketplace string
	Tier        string
	// Capabilities are the manifest's declared capability ids
	// (pluginservice.go's vocabulary), rendered as sentences by the
	// surface that shows them.
	Capabilities []string
	// NetworkHosts are the hosts contributes.network declares; AnyHost
	// is true when it declares "*".
	NetworkHosts []string
	AnyHost      bool
	// Kinds are the contribution families the manifest fills.
	Kinds []string
	// UsesSecrets is true when the manifest declares a setting that
	// holds a secret reference -- the plugin never sees the secret, it
	// names one.
	UsesSecrets bool
	// AlreadyInstalled reports an existing folder with this id, so the
	// prompt can say "reinstall" rather than "install".
	AlreadyInstalled bool
	// PolicyRefusal is the organisation policy's sentence when it
	// refuses this install (policy_match.go), "" when it does not or
	// no policy is set; the prompt shows it and disables Install.
	PolicyRefusal string
	// Warnings are the install checks' advisory findings
	// (conform_install.go) for a folder that can be read before the
	// download -- the bundled examples and folder sources -- and the
	// recorded ones for an installed plugin.
	Warnings []string
}

// PreviewInstall answers the prompt's contents for a marketplace
// entry. It reads only the cached index -- previewing never downloads.
func (p *PluginService) PreviewInstall(marketplace, id string) (InstallPreview, error) {
	idx, entry, err := p.findEntry(marketplace, id)
	if err != nil {
		return InstallPreview{}, err
	}
	pv := InstallPreview{
		ID: entry.ID, Name: entry.Name, Version: entry.Version, Author: entry.Author,
		Description: entry.Description, Marketplace: idx.Name, Tier: entryTier(idx.Name, entry),
		Kinds: entry.Kinds,
	}
	m, readable := p.previewManifest(idx, entry)
	if readable {
		applyManifestToPreview(&pv, m)
	} else {
		m = Manifest{ID: entry.ID, Version: entry.Version}
	}
	if dir, ok := p.previewDir(idx, entry); ok {
		_, pv.Warnings = InstallChecks(dir, m)
	}
	if err := policyInstallRefusal(m, pv.Tier, idx.Name, "", ""); err != nil {
		pv.PolicyRefusal = err.Error()
	}
	pv.AlreadyInstalled = p.installedFolderExists(entry.ID)
	return pv, nil
}

// previewDir answers the folder a preview's files can be read from
// before any download: a folder source's own path. The bundled
// examples live inside the binary and are checked as they install.
func (p *PluginService) previewDir(idx MarketplaceIndex, entry MarketplaceEntry) (string, bool) {
	if idx.Name == ReservedMarketplaceName || entry.Source.Kind != "path" {
		return "", false
	}
	src, ok := p.sourceFor(idx.Name)
	if !ok || src.Kind != "path" {
		return "", false
	}
	return filepath.Join(expandHome(src.Locator), filepath.FromSlash(entry.Source.Path)), true
}

// previewManifest reads the manifest a preview describes, when it can
// be read without a download: the bundled examples, and a folder
// source already on disk. A remote archive's manifest is only known
// after the download, so its preview stands on the index's own
// declaration.
func (p *PluginService) previewManifest(idx MarketplaceIndex, entry MarketplaceEntry) (Manifest, bool) {
	if idx.Name == ReservedMarketplaceName {
		return p.exampleManifest(entry.ID)
	}
	if entry.Source.Kind != "path" {
		return Manifest{}, false
	}
	src, ok := p.sourceFor(idx.Name)
	if !ok || src.Kind != "path" {
		return Manifest{}, false
	}
	raw, err := os.ReadFile(filepath.Join(expandHome(src.Locator), filepath.FromSlash(entry.Source.Path), "manifest.json")) // #nosec G304 -- a folder the user added as a source
	if err != nil {
		return Manifest{}, false
	}
	var m Manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		return Manifest{}, false
	}
	return m, true
}

func applyManifestToPreview(pv *InstallPreview, m Manifest) {
	pv.Capabilities = m.Capabilities
	for _, n := range m.Contributes.Network {
		if n.Host == AnyHost {
			pv.AnyHost = true
			continue
		}
		pv.NetworkHosts = append(pv.NetworkHosts, n.Host)
	}
	pv.Kinds = contributionKinds(m.Contributes)
	for _, s := range m.Contributes.Settings {
		if strings.EqualFold(s.Type, "secretRef") {
			pv.UsesSecrets = true
		}
	}
	if pv.Name == "" {
		pv.Name = m.Name
	}
	if pv.Version == "" {
		pv.Version = m.Version
	}
	if pv.Author == "" {
		pv.Author = m.Author
	}
	if pv.Description == "" {
		pv.Description = m.Description
	}
}

// PreviewInstalled answers the same "what it can do" list for a plugin
// already on disk -- the Verification tab shows exactly what the
// install prompt showed.
func (p *PluginService) PreviewInstalled(id string) (InstallPreview, error) {
	info := p.resolvePlugin(id)
	if info.Manifest.Name == "" && info.Error != "" {
		return InstallPreview{}, fmt.Errorf("%s", info.Error)
	}
	pv := InstallPreview{
		ID: info.Manifest.ID, Name: info.Manifest.Name, Version: info.Manifest.Version,
		Author: info.Manifest.Author, Description: info.Manifest.Description,
		Tier: InstalledTier(info.Dir, info.Builtin), AlreadyInstalled: true,
	}
	applyManifestToPreview(&pv, info.Manifest)
	if rec, ok := ReadInstallRecord(info.Dir); ok {
		pv.Marketplace = rec.Marketplace
		pv.Warnings = rec.Warnings
	}
	pv.PolicyRefusal = info.PolicyBlocked
	return pv, nil
}

func (p *PluginService) installedFolderExists(id string) bool {
	if !pluginIDPattern.MatchString(id) {
		return false
	}
	info, err := os.Stat(filepath.Join(p.dir, id)) // #nosec G703 -- id passed pluginIDPattern
	return err == nil && info.IsDir()
}

// InstallFromMarketplace installs one index entry.
func (p *PluginService) InstallFromMarketplace(marketplace, id string) (InstallRecord, error) {
	idx, entry, err := p.findEntry(marketplace, id)
	if err != nil {
		return InstallRecord{}, err
	}
	stage, cleanup, err := stageDir()
	if err != nil {
		return InstallRecord{}, err
	}
	defer cleanup()
	tier, err := p.stageEntry(stage, idx, entry)
	if err != nil {
		return InstallRecord{}, err
	}
	return p.finishInstall(stage, InstallRecord{Source: entry.Source, Marketplace: idx.Name, Tier: tier})
}

// stageEntry puts one index entry's files in the staging folder and
// answers the tier that earned. Mill's own bundled index is its own
// case: those files come out of the binary, so nothing is fetched and
// nothing needs checking.
func (p *PluginService) stageEntry(stage string, idx MarketplaceIndex, entry MarketplaceEntry) (string, error) {
	if idx.Name == ReservedMarketplaceName {
		if !p.hasExample(entry.ID) {
			return "", fmt.Errorf("%q is not one of the extensions this Mill ships", entry.ID)
		}
		return TierVerified, CopyEmbeddedPlugin(p.examples, embeddedPluginPath(exampleMarketplaceRoot, entry.ID), stage)
	}
	switch entry.Source.Kind {
	case "path":
		src, ok := p.sourceFor(idx.Name)
		if !ok || src.Kind != "path" {
			return "", fmt.Errorf("%q is only offered as a folder, and that source is not a folder", entry.ID)
		}
		return TierDev, CopyPluginFolder(filepath.Join(expandHome(src.Locator), filepath.FromSlash(entry.Source.Path)), stage)
	case "archive":
		return p.stageArchive(stage, entry.Source.URL, declaredHash(entry))
	case "github":
		return p.stageRepo(stage, entry.Source.Repo, firstNonEmpty(entry.Source.Ref, entry.Source.SHA), entry.ID, entry.Version, declaredHash(entry))
	}
	return "", fmt.Errorf("unknown source kind %q", entry.Source.Kind)
}

// InstallFromLink installs from whatever the user pasted: a
// repository, an archive address, or a folder on this Mac.
func (p *PluginService) InstallFromLink(input string) (InstallRecord, error) {
	raw := strings.TrimSpace(input)
	if raw == "" {
		return InstallRecord{}, fmt.Errorf("enter a repo, an address, or a folder")
	}
	if err := policySourceRefusal("", raw); err != nil {
		return InstallRecord{}, err
	}
	stage, cleanup, err := stageDir()
	if err != nil {
		return InstallRecord{}, err
	}
	defer cleanup()
	tier, source, err := p.stageLink(stage, raw)
	if err != nil {
		return InstallRecord{}, err
	}
	return p.finishInstall(stage, InstallRecord{Source: source, Tier: tier})
}

// stageLink reads what the user pasted and stages it, answering the
// tier and the source to record.
func (p *PluginService) stageLink(stage, raw string) (string, PluginSource, error) {
	if strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "~") {
		return TierDev, PluginSource{Kind: "path", Path: raw}, CopyPluginFolder(expandHome(raw), stage)
	}
	if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
		if owner, repo, ok := gitHubRemoteRepo(raw); ok {
			tier, err := p.stageRepo(stage, owner+"/"+repo, "", "", "", "")
			return tier, PluginSource{Kind: "github", Repo: owner + "/" + repo}, err
		}
		tier, err := p.stageArchive(stage, raw, "")
		return tier, PluginSource{Kind: "archive", URL: raw}, err
	}
	repoName, ref, _ := strings.Cut(raw, "@")
	if !repoPattern.MatchString(repoName) {
		return "", PluginSource{}, fmt.Errorf("that is not a repo, an address, or a folder")
	}
	tier, err := p.stageRepo(stage, repoName, ref, "", "", "")
	return tier, PluginSource{Kind: "github", Repo: repoName, Ref: ref}, err
}

// stageArchive downloads one zip and extracts it, refusing the whole
// install when a declared hash does not match the bytes.
func (p *PluginService) stageArchive(stage, url, declared string) (string, error) {
	data, err := p.httpGetBytes(url, maxDownloadBytes)
	if err != nil {
		return "", err
	}
	actual := SHA256Hex(data)
	if strings.TrimSpace(declared) != "" && !strings.EqualFold(strings.TrimSpace(declared), actual) {
		return "", fmt.Errorf("the download doesn't match the hash the source declared")
	}
	if err := ExtractZip(data, stage); err != nil {
		return "", err
	}
	return TierFor(TierInputs{DeclaredSHA256: declared, ActualSHA256: actual}), nil
}

// stageRepo installs from a repository: the release asset the standard
// names when the entry pins a version, and the branch archive
// otherwise -- which nothing checks, so it is unverified by
// construction.
func (p *PluginService) stageRepo(stage, repo, ref, id, version, declared string) (string, error) {
	if id != "" && version != "" {
		assetURL := releaseAssetURL(repo, version, ReleaseAssetName(id, version))
		tier, err := p.stageArchive(stage, assetURL, declared)
		if err == nil {
			return tier, nil
		}
	}
	if _, err := p.stageArchive(stage, BranchArchiveURL(repo, ref), ""); err != nil {
		return "", err
	}
	return TierUnverified, nil
}

func releaseAssetURL(repo, version, asset string) string {
	tag := version
	if !strings.HasPrefix(tag, "v") {
		tag = "v" + tag
	}
	return "https://github.com/" + repo + "/releases/download/" + tag + "/" + asset
}

// finishInstall moves a staged folder into place under the manifest's
// own id and writes the receipt. A folder already at that id is
// replaced only when it is the SAME plugin -- a different one there is
// refused rather than silently overwritten.
func (p *PluginService) finishInstall(stage string, rec InstallRecord) (InstallRecord, error) {
	id, root, err := ManifestIDIn(stage)
	if err != nil {
		return InstallRecord{}, err
	}
	// The policy and the static checks run over the STAGED folder: a
	// refusal leaves nothing under the plugins directory, and the
	// staging folder itself goes with the caller's deferred cleanup.
	warnings, err := p.stagedChecks(root, rec)
	if err != nil {
		return InstallRecord{}, err
	}
	rec.Warnings = warnings
	if err := os.MkdirAll(p.dir, 0o750); err != nil {
		return InstallRecord{}, err
	}
	target := filepath.Join(p.dir, id) // #nosec G703 -- id passed pluginIDPattern inside ManifestIDIn
	if existing := p.scanOne(id); p.installedFolderExists(id) && existing.Manifest.ID != "" && existing.Manifest.ID != id {
		return InstallRecord{}, fmt.Errorf("a different extension is already installed at %q", id)
	}
	if err := os.RemoveAll(target); err != nil {
		return InstallRecord{}, err
	}
	if err := os.Rename(root, target); err != nil {
		// A rename across devices fails; the copy is the same result.
		if copyErr := CopyPluginFolder(root, target); copyErr != nil {
			return InstallRecord{}, copyErr
		}
	}
	info := p.scanOne(id)
	if info.Error != "" {
		_ = os.RemoveAll(target)
		return InstallRecord{}, fmt.Errorf("%s", info.Error)
	}
	rec.Version = info.Manifest.Version
	rec.ContentHash = info.ContentHash
	rec.InstalledAt = time.Now().UTC().Format(time.RFC3339)
	if rec.Tier == TierVerified && !p.signatureOK(target, info.ContentHash) {
		// The signed tier is only earned when a pinned key verifies the
		// folder; without a signing policy the honest answer is the
		// hash it was pinned by.
		if rec.Marketplace != ReservedMarketplaceName {
			rec.Tier = TierHashPinned
		}
	}
	if err := WriteInstallRecord(target, rec); err != nil {
		return InstallRecord{}, err
	}
	return rec, nil
}

// stagedChecks asks the policy and the install checks about a staged
// folder. The policy sees the tier the staging earned and, for the
// signed tier, which policy key signed the folder.
func (p *PluginService) stagedChecks(root string, rec InstallRecord) ([]string, error) {
	raw, err := os.ReadFile(filepath.Join(root, "manifest.json")) // #nosec G304 -- a staged temp folder this process just wrote
	if err != nil {
		return nil, fmt.Errorf("that download has no manifest.json")
	}
	m, parseProblem := parseManifest(raw)
	if parseProblem != "" {
		return nil, fmt.Errorf("%s", parseProblem)
	}
	hash, _ := ContentHash(root)
	if err := policyInstallRefusal(m, rec.Tier, rec.Marketplace, root, hash); err != nil {
		return nil, err
	}
	refusals, warnings := InstallChecks(root, m)
	if len(refusals) > 0 {
		slog.Warn("install refused by the static checks", "plugin", m.ID, "problems", refusals)
		return nil, usererror.New(InstallRefusedCode, installRefusalSentence(refusals[0]))
	}
	return warnings, nil
}

// InstallRefusedCode is the error code a static-check refusal carries.
const InstallRefusedCode = "plugin-install-refused"

// installRefusalSentence turns a rule finding ("standard rule 25:
// main.js: reaches x without declaring it") into the one sentence the
// install prompt shows.
func installRefusalSentence(finding string) string {
	_, rest, found := strings.Cut(finding, ": ")
	if !found {
		rest = finding
	}
	file, detail, found := strings.Cut(rest, ": ")
	if !found {
		detail = rest
		file = ""
	}
	sentence := strings.ToUpper(detail[:1]) + detail[1:]
	if file != "" {
		sentence += " (" + file + ")"
	}
	return sentence + "."
}

func (p *PluginService) signatureOK(dir, hash string) bool {
	keys := p.signingKeySet()
	if len(keys) == 0 {
		return false
	}
	return SignatureVerified(dir, hash, keys)
}

func stageDir() (string, func(), error) {
	dir, err := os.MkdirTemp("", "mill-install-")
	if err != nil {
		return "", func() {}, err
	}
	return dir, func() { _ = os.RemoveAll(dir) }, nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
