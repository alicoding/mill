package pluginsvc

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"github.com/alicoding/mill/internal/domain/usererror"
	"golang.org/x/mod/sumdb/dirhash"
)

func (p *PluginService) prepareCandidate(ctx context.Context, candidate InstallCandidate) (preparedArtifact, error) {
	if err := validateInstallCandidate(candidate); err != nil {
		return preparedArtifact{}, err
	}
	stage, cleanup, err := stageDir()
	if err != nil {
		return preparedArtifact{}, err
	}
	artifact := preparedArtifact{candidate: candidate, stage: stage}
	succeeded := false
	defer func() {
		if !succeeded {
			cleanup()
		}
	}()

	staged, err := p.stageCandidate(ctx, stage, candidate)
	if err != nil {
		return preparedArtifact{}, err
	}
	artifact.record = staged.record
	artifact.expectedSource = staged.expectedSource
	artifact.update = staged.update
	if err := ctx.Err(); err != nil {
		return preparedArtifact{}, err
	}
	id, root, err := ManifestIDIn(stage)
	if err != nil {
		return preparedArtifact{}, err
	}
	manifest, err := readStagedManifest(root)
	if err != nil {
		return preparedArtifact{}, err
	}
	if err := validatePreparedIdentity(id, manifest.Version, staged.expectedID, staged.expectedVersion); err != nil {
		return preparedArtifact{}, err
	}
	// Transaction recovery is intentionally non-cancelable: once filesystem
	// reconciliation starts it must settle before another install can proceed.
	warnings, err := p.stagedChecks(root, artifact.record) //nolint:contextcheck
	if err != nil {
		return preparedArtifact{}, err
	}
	artifact.record.Warnings = append([]string(nil), warnings...)
	artifact.artifactIdentity, err = completeArtifactIdentity(ctx, root)
	if err != nil {
		return preparedArtifact{}, err
	}
	artifact.root = root
	artifact.preview = previewFromManifest(manifest, artifact.record, warnings)
	// The review lock may perform the same non-cancelable recovery before it
	// snapshots installed content.
	if err := p.reviewPreparedCandidate(&artifact, manifest); err != nil { //nolint:contextcheck
		return preparedArtifact{}, err
	}
	succeeded = true
	return artifact, nil
}

type stagedInstallCandidate struct {
	record          InstallRecord
	expectedSource  *MarketplaceSource
	expectedID      string
	expectedVersion string
	update          bool
}

func (p *PluginService) stageCandidate(ctx context.Context, stage string, candidate InstallCandidate) (stagedInstallCandidate, error) {
	switch candidate.Kind {
	case "marketplace":
		return p.stageMarketplaceCandidate(ctx, stage, candidate)
	case "link":
		return p.stageDirectCandidate(ctx, stage, candidate)
	case "update":
		return p.stageSelectedUpdate(ctx, stage, candidate)
	case "theme":
		record, id, err := prepareThemeCandidate(stage, candidate)
		return stagedInstallCandidate{record: record, expectedID: id, expectedVersion: "1.0.0"}, err
	default:
		return stagedInstallCandidate{}, userInstallCandidateError()
	}
}

func (p *PluginService) stageMarketplaceCandidate(ctx context.Context, stage string, candidate InstallCandidate) (stagedInstallCandidate, error) {
	resolved, err := p.resolveMarketplaceEntryContext(ctx, candidate.Marketplace, candidate.ID)
	if err != nil {
		return stagedInstallCandidate{}, err
	}
	if resolved.Source.Incarnation != candidate.Incarnation || resolved.Entry.Version != candidate.Version {
		return stagedInstallCandidate{}, candidateChangedError()
	}
	tier, finalURL, err := p.stageEntryContext(ctx, stage, resolved)
	if err != nil {
		return stagedInstallCandidate{}, err
	}
	source := resolved.Source
	record := InstallRecord{Source: resolved.Entry.Source, Marketplace: resolved.Index.Name, Tier: tier, Origin: source.Origin, FinalArtifactURL: finalURL}
	return stagedInstallCandidate{record: record, expectedSource: &source, expectedID: candidate.ID, expectedVersion: candidate.Version}, nil
}

func (p *PluginService) stageDirectCandidate(ctx context.Context, stage string, candidate InstallCandidate) (stagedInstallCandidate, error) {
	raw := strings.TrimSpace(candidate.Locator)
	classified, err := ClassifySource(raw)
	if err != nil {
		return stagedInstallCandidate{}, err
	}
	if err := policySourceRegistrationRefusal("", classified); err != nil {
		return stagedInstallCandidate{}, err
	}
	tier, source, finalURL, err := p.stageLinkContext(ctx, stage, raw)
	record := InstallRecord{Source: source, Tier: tier, Origin: classified.Origin, FinalArtifactURL: finalURL}
	return stagedInstallCandidate{record: record}, err
}

func (p *PluginService) stageSelectedUpdate(ctx context.Context, stage string, candidate InstallCandidate) (stagedInstallCandidate, error) {
	update, found, err := p.updateCandidateContext(ctx, candidate.ID)
	if err != nil {
		return stagedInstallCandidate{}, err
	}
	if !found || update.Available != candidate.Version {
		return stagedInstallCandidate{}, candidateChangedError()
	}
	record, source, err := p.stageUpdateCandidateContext(ctx, stage, update)
	return stagedInstallCandidate{
		record: record, expectedSource: source, update: true, expectedID: candidate.ID, expectedVersion: candidate.Version,
	}, err
}

func validatePreparedIdentity(id, version, expectedID, expectedVersion string) error {
	if expectedID != "" && id != expectedID {
		return fmt.Errorf("the prepared extension id is %q, not %q", id, expectedID)
	}
	if expectedVersion != "" && version != expectedVersion {
		return fmt.Errorf("the prepared extension version is %q, not %q", version, expectedVersion)
	}
	return nil
}

func previewFromManifest(manifest Manifest, record InstallRecord, warnings []string) InstallPreview {
	preview := InstallPreview{
		ID: manifest.ID, Name: manifest.Name, Version: manifest.Version, Author: manifest.Author,
		Description: manifest.Description, Marketplace: record.Marketplace, Tier: record.Tier,
		Warnings: append([]string(nil), warnings...),
	}
	applyManifestToPreview(&preview, manifest, false)
	return preview
}

func (p *PluginService) reviewPreparedCandidate(artifact *preparedArtifact, manifest Manifest) error {
	p.installMu.Lock()
	defer p.installMu.Unlock()
	if err := p.recoverInstallationsLocked(); err != nil {
		return err
	}
	var err error
	artifact.installedPresent, artifact.installedArtifactIdentity, err = p.installedIdentityLocked(manifest.ID)
	if err == nil {
		artifact.preview.AlreadyInstalled = artifact.installedPresent
		artifact.requiresReview = p.requiresReviewLocked(*artifact, manifest)
	}
	return err
}

func validateInstallCandidate(candidate InstallCandidate) error {
	marketplace := candidate.Marketplace != "" || candidate.Incarnation != ""
	identity := candidate.ID != "" || candidate.Version != ""
	link := candidate.Locator != ""
	theme := candidate.Encoded != "" || candidate.Basename != "" || candidate.DisplayName != "" || candidate.Family != ""
	valid := false
	switch candidate.Kind {
	case "marketplace":
		valid = candidate.Marketplace != "" && candidate.Incarnation != "" && candidate.ID != "" && candidate.Version != "" && !link && !theme
	case "link":
		valid = link && !marketplace && !identity && !theme
	case "update":
		valid = candidate.ID != "" && candidate.Version != "" && !marketplace && !link && !theme
	case "theme":
		valid = candidate.Encoded != "" && candidate.Basename != "" && candidate.DisplayName != "" && (candidate.Family == "light" || candidate.Family == "dark") && !marketplace && !identity && !link
	}
	if !valid {
		return userInstallCandidateError()
	}
	return nil
}

func userInstallCandidateError() error {
	return usererror.New("install-preparation-invalid", "This extension preview is no longer available. Prepare it again to continue.")
}

func candidateChangedError() error {
	return usererror.New("install-candidate-changed", "This extension offer changed. Prepare it again to continue.")
}

func (p *PluginService) stageUpdateCandidateContext(ctx context.Context, stage string, candidate UpdateCandidate) (InstallRecord, *MarketplaceSource, error) {
	if candidate.Marketplace != "" {
		resolved, err := p.resolveMarketplaceEntryContext(ctx, candidate.Marketplace, candidate.ID)
		if err != nil {
			return InstallRecord{}, nil, err
		}
		if resolved.Entry.Version != candidate.Available {
			return InstallRecord{}, nil, candidateChangedError()
		}
		tier, finalURL, err := p.stageEntryContext(ctx, stage, resolved)
		if err != nil {
			return InstallRecord{}, nil, err
		}
		source := resolved.Source
		return InstallRecord{Source: resolved.Entry.Source, Marketplace: resolved.Index.Name, Tier: tier, Origin: source.Origin, FinalArtifactURL: finalURL}, &source, nil
	}
	if err := policyUpdateDiscoveryRefusal(candidate.Origin, candidate.Marketplace, candidate.Source); err != nil {
		return InstallRecord{}, nil, err
	}
	switch candidate.Source.Kind {
	case "github":
		tier, finalURL, err := p.stageRepoContext(ctx, stage, candidate.Source.Repo, candidate.Source.Ref, candidate.ID, candidate.Available, "", candidate.Origin)
		return InstallRecord{Source: candidate.Source, Tier: tier, Origin: candidate.Origin, FinalArtifactURL: finalURL}, nil, err
	case "path":
		origin := candidate.Origin
		if origin.Kind == "" {
			classified, err := ClassifySource(candidate.Source.Path)
			if err != nil {
				return InstallRecord{}, nil, err
			}
			origin = classified.Origin
		}
		err := p.copySourceFolderContext(ctx, origin, ".", stage)
		return InstallRecord{Source: candidate.Source, Tier: TierDev, Origin: origin}, nil, err
	default:
		return InstallRecord{}, nil, fmt.Errorf("%q has no source an update can come from", candidate.ID)
	}
}

type artifactIdentityEntry struct {
	Path       string `json:"path"`
	Kind       string `json:"kind"`
	Executable bool   `json:"executable"`
}

type artifactIdentityEnvelope struct {
	Version     int                     `json:"version"`
	ContentHash string                  `json:"contentHash"`
	Entries     []artifactIdentityEntry `json:"entries"`
}

var errArtifactIdentityTooLarge = errors.New("that extension is too large to install")

func completeArtifactIdentity(ctx context.Context, root string) (string, error) {
	return completeArtifactIdentityWithOpen(ctx, root, openArtifactFile)
}

type artifactFileOpener func(root *os.Root, name string) (*os.File, error)

func completeArtifactIdentityWithOpen(ctx context.Context, root string, openFile artifactFileOpener) (string, error) {
	opened, err := os.OpenRoot(root)
	if err != nil {
		return "", err
	}
	defer func() { _ = opened.Close() }()
	entries, files, planned, err := planArtifactIdentity(ctx, opened.FS())
	if err != nil {
		return "", err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Path < entries[j].Path })
	remaining := int64(maxArchiveBytes)
	var closeErr error
	contentHash, err := dirhash.Hash1(files, func(name string) (io.ReadCloser, error) {
		return openIdentityFile(ctx, opened, name, planned[name], openFile, &remaining, &closeErr)
	})
	if err != nil {
		return "", err
	}
	if closeErr != nil {
		return "", closeErr
	}
	if err := verifyArtifactIdentityPlan(opened, planned); err != nil {
		return "", err
	}
	payload, err := json.Marshal(artifactIdentityEnvelope{Version: 1, ContentHash: contentHash, Entries: entries})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(payload)
	return "prepared-v1:sha256-" + hex.EncodeToString(sum[:]), nil
}

func planArtifactIdentity(ctx context.Context, root fs.FS) ([]artifactIdentityEntry, []string, map[string]fs.FileInfo, error) {
	index := newPortablePathIndex()
	entries := []artifactIdentityEntry{}
	files := []string{}
	planned := make(map[string]fs.FileInfo)
	err := fs.WalkDir(root, ".", func(name string, entry fs.DirEntry, walkErr error) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if walkErr != nil {
			return walkErr
		}
		identity, info, include, err := plannedIdentityEntry(name, entry, index, len(entries))
		if err != nil {
			return err
		}
		if !include {
			return nil
		}
		if identity.Kind == "file" {
			files = append(files, identity.Path)
		}
		entries = append(entries, identity)
		planned[identity.Path] = info
		return nil
	})
	return entries, files, planned, err
}

func plannedIdentityEntry(name string, entry fs.DirEntry, index *portablePathIndex, count int) (artifactIdentityEntry, fs.FileInfo, bool, error) {
	if name == "." {
		return artifactIdentityEntry{}, nil, false, nil
	}
	if err := entryLimitError(count + 1); err != nil {
		return artifactIdentityEntry{}, nil, false, err
	}
	info, err := entry.Info()
	if err != nil {
		return artifactIdentityEntry{}, nil, false, err
	}
	if info.Mode()&fs.ModeSymlink != 0 || (!info.IsDir() && !info.Mode().IsRegular()) {
		return artifactIdentityEntry{}, nil, false, fmt.Errorf("the prepared extension contains an unsupported file")
	}
	portable := filepath.ToSlash(name)
	if err := index.add(portable, info.IsDir()); err != nil {
		return artifactIdentityEntry{}, nil, false, err
	}
	identity := artifactIdentityEntry{Path: portable, Kind: "directory"}
	if info.Mode().IsRegular() {
		identity.Kind = "file"
		identity.Executable = artifactExecutable(info)
	}
	return identity, info, true, nil
}

func openIdentityFile(ctx context.Context, root *os.Root, name string, planned fs.FileInfo, openFile artifactFileOpener, remaining *int64, closeErr *error) (io.ReadCloser, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	path := filepath.FromSlash(name)
	before, err := root.Lstat(path)
	if err != nil || !before.Mode().IsRegular() || !os.SameFile(planned, before) || artifactExecutable(before) != artifactExecutable(planned) {
		return nil, fmt.Errorf("the prepared extension changed while its identity was read")
	}
	file, err := openFile(root, path)
	if err != nil {
		return nil, err
	}
	openedInfo, err := file.Stat()
	if err != nil || !openedInfo.Mode().IsRegular() || !os.SameFile(before, openedInfo) || artifactExecutable(openedInfo) != artifactExecutable(before) {
		_ = file.Close()
		return nil, fmt.Errorf("the prepared extension changed while its identity was read")
	}
	return &boundedArtifactReader{ctx: ctx, file: file, initial: openedInfo, remaining: remaining, closeErr: closeErr}, nil
}

func verifyArtifactIdentityPlan(root *os.Root, planned map[string]fs.FileInfo) error {
	for name, before := range planned {
		after, err := root.Lstat(filepath.FromSlash(name))
		if err != nil || !os.SameFile(before, after) || after.IsDir() != before.IsDir() || after.Mode().IsRegular() != before.Mode().IsRegular() || artifactExecutable(after) != artifactExecutable(before) {
			return fmt.Errorf("the prepared extension changed while its identity was read")
		}
	}
	return nil
}

func artifactExecutable(info fs.FileInfo) bool {
	return info.Mode().IsRegular() && runtime.GOOS != "windows" && sanitizedFileMode(info.Mode())&0o111 != 0
}

type boundedArtifactReader struct {
	ctx       context.Context
	file      *os.File
	initial   fs.FileInfo
	remaining *int64
	closeErr  *error
}

func (r *boundedArtifactReader) Read(buffer []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	limit := int64(len(buffer))
	if limit > *r.remaining+1 {
		limit = *r.remaining + 1
	}
	n, err := r.file.Read(buffer[:limit])
	*r.remaining -= int64(n)
	if *r.remaining < 0 {
		return n, errArtifactIdentityTooLarge
	}
	return n, err
}

func (r *boundedArtifactReader) Close() error {
	current, statErr := r.file.Stat()
	if statErr == nil && (!current.Mode().IsRegular() || !os.SameFile(r.initial, current) || current.Size() != r.initial.Size() || !current.ModTime().Equal(r.initial.ModTime())) {
		statErr = errors.New("the prepared extension changed while its identity was read")
	}
	err := r.file.Close()
	if statErr != nil {
		err = statErr
	}
	if err != nil && *r.closeErr == nil {
		*r.closeErr = err
	}
	return err
}

func (p *PluginService) installedIdentityLocked(id string) (bool, string, error) {
	target := filepath.Join(p.dir, id)
	info, err := os.Lstat(target)
	if os.IsNotExist(err) {
		return false, "", nil
	}
	if err != nil {
		return false, "", err
	}
	if !info.IsDir() || info.Mode()&fs.ModeSymlink != 0 {
		return false, "", fmt.Errorf("a different filesystem entry already exists at %q", id)
	}
	hash, err := completeArtifactIdentity(context.Background(), target)
	if err != nil {
		return false, "", err
	}
	return true, hash, nil
}

func (p *PluginService) requiresReviewLocked(artifact preparedArtifact, manifest Manifest) bool {
	if !artifact.update || !artifact.installedPresent || (artifact.record.Tier != TierVerified && artifact.record.Tier != TierHashPinned) || p.trust == nil {
		return true
	}
	installed := p.scanOneWithoutApproval(manifest.ID)
	if installed.Error != "" || installed.CodeHash == "" {
		return true
	}
	record, ok := ReadInstallRecord(installed.Dir)
	if !ok || record.Source != artifact.record.Source || record.Origin != artifact.record.Origin || record.Marketplace != artifact.record.Marketplace {
		return true
	}
	approval, err := p.trust.Approval()
	if err != nil || !containsString(approval.Allowed, manifest.ID) {
		return true
	}
	lock, ok := approval.Locks[manifest.ID]
	if !ok || lock.Hash == "" || lock.Hash != installed.CodeHash || lock.Grant.NetworkGrantVersion != 1 {
		return true
	}
	_, widened := widenedFrom(lock.Grant, currentGrant(manifest))
	return widened
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
