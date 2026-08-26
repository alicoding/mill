package atlassvc

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/alicoding/mill/internal/domain/atlas"
)

// builtInBoardObjectsLocked resolves atlas.BuiltInBoardObjects()'s
// declarative goldens into insertable objects for reconcileObjectsLocked
// (goal 0223): a file-backed Kind (ink/image) carries no
// mirrorPath from the pure domain package (backend.md's persistence-
// free rule) -- this materializes its seed content under the captures
// directory and fills Payload["mirrorPath"] before reconcile ever sees
// it. A golden whose asset can't yet be materialized (a.capturesDir
// still unset -- the construction-time reconcile pass runs before
// main.go's WireAtlasStorageDirs) is OMITTED from the returned slice
// entirely, never inserted half-built; SetCapturesDir re-runs reconcile
// once the real directory is wired in, so a live install still ends up
// with these goldens, just one wiring step later. Caller must hold a.mu.
func (a *AtlasService) builtInBoardObjectsLocked() []atlas.BoardObject {
	goldens := atlas.BuiltInBoardObjects()
	out := make([]atlas.BoardObject, 0, len(goldens))
	for _, golden := range goldens {
		asset := golden.Payload[atlas.BoardObjectSeedAssetKey]
		if asset == "" {
			out = append(out, golden)
			continue
		}
		if a.capturesDir == "" {
			continue
		}
		path, err := materializeSeedBoardObjectAsset(a.capturesDir, golden.ID, asset)
		if err != nil {
			slog.Error("failed to materialize seed board-object asset", "id", golden.ID, "asset", asset, "error", err)
			continue
		}
		golden.Payload = copyPayload(golden.Payload)
		golden.Payload["mirrorPath"] = path
		delete(golden.Payload, atlas.BoardObjectSeedAssetKey)
		out = append(out, golden)
	}
	return out
}

// materializeSeedBoardObjectAsset writes a file-backed board-object
// golden's own seed content to disk under dir, named by id (stable and
// collision-free -- every golden ID is already unique across every
// entity family this package seeds). A file already present at the
// target path is left untouched and its path simply returned -- the
// path IS the object's mirrorPath, so an existing file there can only
// be this golden's own prior materialization; reconcile must never
// clobber it (a user could in principle have edited the mirrored bytes
// directly, same "the mirror file is the user's, not ours to rewrite"
// posture every other mirror-backed door in this package already
// holds).
func materializeSeedBoardObjectAsset(dir, id, asset string) (string, error) {
	content, ext, ok := atlas.BuiltInBoardObjectAsset(asset)
	if !ok {
		return "", fmt.Errorf("unknown seed board-object asset %q", asset)
	}
	// 0o750, not 0o755 -- matches atlasservice_imagecapture.go's own
	// gosec-capped (G301) captures-directory creation.
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", fmt.Errorf("materialize seed board-object asset: %w", err)
	}
	path := filepath.Join(dir, id+ext)
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		return "", fmt.Errorf("materialize seed board-object asset: %w", err)
	}
	return path, nil
}
