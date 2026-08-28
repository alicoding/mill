package settingssvc

import (
	"context"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

// downloadWithStaleAssetRetry runs u.DownloadAndInstall for version and,
// on a stale-asset 404 (see isStaleAssetDownloadError), performs ONE
// fresh CheckForUpdates and retries the download exactly once against
// whatever it finds. checkForUpdates re-populates u's own pending
// release as a side effect (u.Check sets it on every successful call),
// so the retried u.DownloadAndInstall transparently downloads the new
// asset with no separate download path. When the re-check finds
// nothing newer than version -- the single rolling beta release names
// the same version it did before, so this is a genuine 404, not a
// race -- the original error is returned unchanged and no retry is
// attempted.
func (s *SettingsService) downloadWithStaleAssetRetry(u *updater.Updater, version string) (string, error) {
	err := u.DownloadAndInstall(context.Background())
	if err == nil {
		return version, nil
	}
	if !isStaleAssetDownloadError(err) {
		return version, err
	}
	result, checkErr := s.checkForUpdates(context.Background())
	if checkErr != nil || !result.UpdateAvailable || result.Version == version {
		return version, err
	}
	if retryErr := u.DownloadAndInstall(context.Background()); retryErr != nil {
		return result.Version, retryErr
	}
	return result.Version, nil
}
