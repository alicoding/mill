package pluginsvc

import (
	"fmt"
	"os"
	"path/filepath"
)

func readStagedManifest(root string) (Manifest, error) {
	raw, err := os.ReadFile(filepath.Join(root, "manifest.json")) // #nosec G304 -- a staged temp folder this process just wrote
	if err != nil {
		return Manifest{}, fmt.Errorf("that download has no manifest.json")
	}
	m, parseProblem := parseManifest(raw)
	if parseProblem != "" {
		return Manifest{}, fmt.Errorf("%s", parseProblem)
	}
	return m, nil
}

func stagedPolicyRefusal(m Manifest, rec InstallRecord, root, hash string) error {
	if rec.Origin.Kind != "" {
		if rec.FinalArtifactURL != "" {
			if err := policyRequestRefusal(rec.Origin, rec.FinalArtifactURL, true); err != nil {
				return err
			}
		}
		return policyInstallRefusalOriginAt(m, rec.Tier, rec.Origin, rec.Marketplace, root, hash)
	}
	return policyInstallRefusalAt(m, rec.Tier, rec.Marketplace, installSourceLocator(rec.Source), root, hash)
}
