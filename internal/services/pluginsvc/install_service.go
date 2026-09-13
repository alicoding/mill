package pluginsvc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

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
	NetworkHosts        []string
	AnyHost             bool
	NetworkGrantVersion int
	NetworkMethods      map[string][]string
	// Kinds are the contribution families the manifest fills.
	Kinds []string
	// UsesSecrets is true when the manifest declares a setting that
	// holds a secret reference -- the plugin never sees the secret, it
	// names one.
	UsesSecrets bool
	// AlreadyInstalled reports an existing folder with this id, so the
	// prompt can say "reinstall" rather than "install".
	AlreadyInstalled bool
	// CanvasHost is true when this manifest earns the "canvas-host"
	// grant (pluginGrants, docs/goals/0375 S1b/S2): it declares a
	// canvas object and runs same-DOM in Mill's own window rather than
	// the sandboxed activation frame. Always false for a built-in.
	CanvasHost bool
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
// entry. Folder sources are read through their confined acquisition
// boundary; remote entries still use only the cached index.
func (p *PluginService) PreviewInstall(marketplace, id string) (InstallPreview, error) {
	resolved, err := p.resolveMarketplaceEntry(marketplace, id)
	if err != nil {
		return InstallPreview{}, err
	}
	idx, entry, source := resolved.Index, resolved.Entry, resolved.Source
	pv := InstallPreview{
		ID: entry.ID, Name: entry.Name, Version: entry.Version, Author: entry.Author,
		Description: entry.Description, Marketplace: idx.Name, Tier: entryTier(idx.Name, entry),
		Kinds: entry.Kinds,
	}
	origin := source.Origin
	if idx.Name != ReservedMarketplaceName {
		if err := policySourceRegistrationRefusal(idx.Name, source); err != nil {
			pv.PolicyRefusal = err.Error()
			pv.AlreadyInstalled = p.installedFolderExists(entry.ID)
			return pv, nil
		}
	}
	m, readable, err := p.previewManifest(resolved)
	if err != nil {
		return InstallPreview{}, err
	}
	if readable {
		applyManifestToPreview(&pv, m, false)
	} else {
		m = Manifest{ID: entry.ID, Version: entry.Version}
	}
	if readable && idx.Name != ReservedMarketplaceName && entry.Source.Kind == "path" {
		_, pv.Warnings, err = p.sourceInstallChecks(source.Origin, entry.Source.Path, m)
		if err != nil {
			return InstallPreview{}, err
		}
	}
	if err := policyInstallRefusalOriginAt(m, pv.Tier, origin, idx.Name, "", ""); err != nil {
		pv.PolicyRefusal = err.Error()
	}
	pv.AlreadyInstalled = p.installedFolderExists(entry.ID)
	return pv, nil
}

// previewManifest reads the manifest a preview describes, when it can
// be read without a download: the bundled examples, and a folder
// source already on disk. A remote archive's manifest is only known
// after the download, so its preview stands on the index's own
// declaration.
func (p *PluginService) previewManifest(resolved marketplaceEntryResolution) (Manifest, bool, error) {
	idx, entry, src := resolved.Index, resolved.Entry, resolved.Source
	if idx.Name == ReservedMarketplaceName {
		m, ok := p.exampleManifest(entry.ID)
		return m, ok, nil
	}
	if entry.Source.Kind != "path" {
		return Manifest{}, false, nil
	}
	if src.Kind != "path" {
		return Manifest{}, false, fmt.Errorf("%q is no longer a registered folder source", idx.Name)
	}
	raw, err := p.readSourceFile(src.Origin, filepath.Join(entry.Source.Path, "manifest.json"))
	if err != nil {
		return Manifest{}, false, fmt.Errorf("read %q from its source: %w", entry.ID, err)
	}
	var m Manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		return Manifest{}, false, fmt.Errorf("%q has an unreadable manifest.json", entry.ID)
	}
	return m, true, nil
}

// applyManifestToPreview fills pv with what m declares. builtin picks
// the "canvas-host" grant correctly (pluginGrants never grants a
// built-in one): false for every install/update path, since a
// built-in is never installed through this door.
func applyManifestToPreview(pv *InstallPreview, m Manifest, builtin bool) {
	pv.Capabilities = m.Capabilities
	for _, n := range m.Contributes.Network {
		if n.Host == AnyHost {
			pv.AnyHost = true
			continue
		}
		pv.NetworkHosts = append(pv.NetworkHosts, n.Host)
	}
	pv.NetworkGrantVersion = 1
	pv.NetworkMethods = manifestNetworkMethods(m)
	pv.Kinds = contributionKinds(m.Contributes)
	for _, s := range m.Contributes.EffectiveSettings() {
		if strings.EqualFold(s.Type, "secretRef") {
			pv.UsesSecrets = true
		}
	}
	pv.CanvasHost = len(pluginGrants(builtin, m)) > 0
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
	if info.Error != "" {
		return InstallPreview{}, fmt.Errorf("%s", info.Error)
	}
	pv := InstallPreview{
		ID: info.Manifest.ID, Name: info.Manifest.Name, Version: info.Manifest.Version,
		Author: info.Manifest.Author, Description: info.Manifest.Description,
		Tier: InstalledTier(info.Dir, info.Builtin), AlreadyInstalled: true,
	}
	applyManifestToPreview(&pv, info.Manifest, info.Builtin)
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

// stageEntry puts one index entry's files in the staging folder and
// answers the tier that earned. Mill's own bundled index is its own
// case: those files come out of the binary, so nothing is fetched and
// nothing needs checking.
func (p *PluginService) stageEntryContext(ctx context.Context, stage string, resolved marketplaceEntryResolution) (string, string, error) {
	idx, entry, source := resolved.Index, resolved.Entry, resolved.Source
	if idx.Name == ReservedMarketplaceName {
		if !p.hasExample(entry.ID) {
			return "", "", fmt.Errorf("%q is not one of the extensions this Mill ships", entry.ID)
		}
		return TierVerified, "", CopyEmbeddedPlugin(p.examples, embeddedPluginPath(exampleMarketplaceRoot, entry.ID), stage)
	}
	if err := policySourceRegistrationRefusal(idx.Name, source); err != nil {
		return "", "", err
	}
	switch entry.Source.Kind {
	case "path":
		if source.Kind != "path" {
			return "", "", fmt.Errorf("%q is only offered as a folder, and that source is not a folder", entry.ID)
		}
		return TierDev, "", p.copySourceFolderContext(ctx, source.Origin, entry.Source.Path, stage)
	case "archive":
		return p.stageArchiveContext(ctx, stage, entry.Source.URL, declaredHash(entry), source.Origin)
	case "github":
		return p.stageRepoContext(ctx, stage, entry.Source.Repo, firstNonEmpty(entry.Source.Ref, entry.Source.SHA), entry.ID, entry.Version, declaredHash(entry), source.Origin)
	}
	return "", "", fmt.Errorf("unknown source kind %q", entry.Source.Kind)
}

// stageLink reads what the user pasted and stages it, answering the
// tier and the source to record.
func (p *PluginService) stageLinkContext(ctx context.Context, stage, raw string) (string, PluginSource, string, error) {
	classified, classifyErr := ClassifySource(raw)
	if classifyErr != nil {
		return "", PluginSource{}, "", classifyErr
	}
	if classified.Kind == "path" {
		return TierDev, PluginSource{Kind: "path", Path: raw}, "", p.copySourceFolderContext(ctx, classified.Origin, ".", stage)
	}
	if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
		if owner, repo, ok := gitHubRemoteRepo(raw); ok {
			tier, finalURL, err := p.stageRepoContext(ctx, stage, owner+"/"+repo, "", "", "", "", classified.Origin)
			return tier, PluginSource{Kind: "github", Repo: owner + "/" + repo}, finalURL, err
		}
		tier, finalURL, err := p.stageArchiveContext(ctx, stage, raw, "", classified.Origin)
		return tier, PluginSource{Kind: "archive", URL: raw}, finalURL, err
	}
	repoName, ref, _ := strings.Cut(raw, "@")
	if !repoPattern.MatchString(repoName) {
		return "", PluginSource{}, "", fmt.Errorf("that is not a repo, an address, or a folder")
	}
	tier, finalURL, err := p.stageRepoContext(ctx, stage, repoName, ref, "", "", "", classified.Origin)
	return tier, PluginSource{Kind: "github", Repo: repoName, Ref: ref}, finalURL, err
}

// stageArchive downloads one zip and extracts it, refusing the whole
// install when a declared hash does not match the bytes.
func (p *PluginService) stageArchiveContext(ctx context.Context, stage, url, declared string, origins ...SourceOrigin) (string, string, error) {
	origin := SourceOrigin{}
	if len(origins) > 0 {
		origin = origins[0]
	}
	data, finalURL, err := p.httpGetBytesForOriginContext(ctx, url, maxDownloadBytes, origin, true)
	if err != nil {
		return "", "", err
	}
	actual := SHA256Hex(data)
	if strings.TrimSpace(declared) != "" && !strings.EqualFold(strings.TrimSpace(declared), actual) {
		return "", "", fmt.Errorf("the download doesn't match the hash the source declared")
	}
	if err := ExtractZipContext(ctx, data, stage); err != nil {
		return "", "", err
	}
	return TierFor(TierInputs{DeclaredSHA256: declared, ActualSHA256: actual}), finalURL, nil
}

// stageRepo installs from a repository: the release asset the standard
// names when the entry pins a version, and the branch archive
// otherwise -- which nothing checks, so it is unverified by
// construction.
func (p *PluginService) stageRepo(stage, repo, ref, id, version, declared string, origins ...SourceOrigin) (string, string, error) {
	return p.stageRepoContext(context.Background(), stage, repo, ref, id, version, declared, origins...)
}

func (p *PluginService) stageRepoContext(ctx context.Context, stage, repo, ref, id, version, declared string, origins ...SourceOrigin) (string, string, error) {
	if id != "" && version != "" {
		assetURL := releaseAssetURL(repo, version, ReleaseAssetName(id, version))
		tier, finalURL, err := p.stageArchiveContext(ctx, stage, assetURL, declared, origins...)
		if err == nil {
			return tier, finalURL, nil
		}
		var statusErr *httpStatusError
		if strings.TrimSpace(declared) != "" || !errors.As(err, &statusErr) || statusErr.status != http.StatusNotFound {
			return "", "", err
		}
	}
	_, finalURL, err := p.stageArchiveContext(ctx, stage, BranchArchiveURL(repo, ref), "", origins...)
	if err != nil {
		return "", "", err
	}
	return TierUnverified, finalURL, nil
}

func releaseAssetURL(repo, version, asset string) string {
	tag := version
	if !strings.HasPrefix(tag, "v") {
		tag = "v" + tag
	}
	return "https://github.com/" + repo + "/releases/download/" + tag + "/" + asset
}

// stagedChecks asks the policy and the install checks about a staged
// folder. The policy sees the tier the staging earned and, for the
// signed tier, which policy key signed the folder.
func (p *PluginService) stagedChecks(root string, rec InstallRecord) ([]string, error) {
	return p.stagedChecksWithInstalled(root, rec, p.installedManifests())
}

func (p *PluginService) stagedChecksLocked(root string, rec InstallRecord) ([]string, error) {
	return p.stagedChecksWithInstalled(root, rec, p.installedManifestsLocked())
}

func (p *PluginService) stagedChecksWithInstalled(root string, rec InstallRecord, installed map[string]Manifest) ([]string, error) {
	m, err := readStagedManifest(root)
	if err != nil {
		return nil, err
	}
	if _, mainErr := os.Stat(filepath.Join(root, "main.js")); mainErr != nil && isDataOnlyManifest(m) {
		if problem := dataOnlyFolderProblem(os.DirFS(root)); problem != "" {
			return nil, usererror.New(InstallRefusedCode, installRefusalSentence(problem))
		}
	}
	hash, err := ContentHash(root)
	if err != nil {
		return nil, err
	}
	if err := stagedPolicyRefusal(m, rec, root, hash); err != nil {
		return nil, err
	}
	refusals, warnings := InstallChecks(root, m)
	if len(refusals) > 0 {
		slog.Warn("install refused by the static checks", "plugin", m.ID, "problems", refusals)
		return nil, usererror.New(InstallRefusedCode, installRefusalSentence(refusals[0]))
	}
	if err := dependencyInstallRefusalAgainst(m, installed); err != nil {
		return nil, err
	}
	return warnings, nil
}

// dependencyInstallRefusal is standard rule 33's install door: every
// declared dependency must resolve against what is ALREADY on this
// Mill (installed extensions, built-ins included), and the new
// manifest may not close a dependency cycle. Run only at install --
// the registry of what else is installed exists nowhere else.
func dependencyInstallRefusalAgainst(m Manifest, installed map[string]Manifest) error {
	if refusals := dependencyRefusals(m.Dependencies, installed); len(refusals) > 0 {
		return usererror.New(InstallRefusedCode, refusals[0])
	}
	if a, b, found := dependencyCycle(m.ID, m.Dependencies, installed); found {
		return usererror.New(InstallRefusedCode, fmt.Sprintf("Extensions %s and %s depend on each other.", a, b))
	}
	return nil
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
