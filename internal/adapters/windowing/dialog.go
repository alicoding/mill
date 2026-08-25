package windowing

import (
	"fmt"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// PickFolder opens the native folder picker with title, optionally
// pre-filled at startDir, returning the chosen path -- "" with a nil
// error when the user cancels. Returns an error when no live app
// exists (headless/server, no native dialog to show). Dialog prompts
// are already main-thread-safe internally (Wails3's own dialog
// implementation dispatches its native panel itself), so this doesn't
// route through runMainThreadAction.
func PickFolder(title, startDir string) (string, error) {
	app := application.Get()
	if app == nil {
		return "", fmt.Errorf("folder picker unavailable outside the desktop app")
	}
	dialog := app.Dialog.OpenFile().
		CanChooseFiles(false).
		CanChooseDirectories(true).
		SetTitle(title)
	if startDir != "" {
		dialog.SetDirectory(startDir)
	}
	path, err := dialog.PromptForSingleSelection()
	if err != nil {
		return "", fmt.Errorf("pick folder: %w", err)
	}
	return path, nil
}

// PickImageFile opens the native file picker filtered to recognized
// image extensions, returning the chosen path -- "" with a nil error
// when the user cancels. Returns an error when no live app exists. The
// filter pattern is display-only on some platforms (AllowsOtherFileTypes
// defaults false, but a user can still type an arbitrary filename on
// some OS file dialogs), so a caller must still validate the returned
// extension rather than trusting the filter alone.
func PickImageFile(title string) (string, error) {
	app := application.Get()
	if app == nil {
		return "", fmt.Errorf("image picker unavailable outside the desktop app")
	}
	dialog := app.Dialog.OpenFile().
		CanChooseFiles(true).
		CanChooseDirectories(false).
		SetTitle(title).
		AddFilter("Images", "*.png;*.jpg;*.jpeg;*.gif;*.webp;*.heic;*.bmp;*.svg")
	path, err := dialog.PromptForSingleSelection()
	if err != nil {
		return "", fmt.Errorf("pick image file: %w", err)
	}
	return path, nil
}

// SaveFileDialog prompts the OS-native save dialog pre-filled with
// suggestedName, returning the chosen path -- "" with a nil error when
// the user cancels. Returns an error when no live app exists.
func SaveFileDialog(suggestedName string) (string, error) {
	app := application.Get()
	if app == nil {
		return "", fmt.Errorf("native file save is not available in this mode")
	}
	path, err := app.Dialog.SaveFile().SetFilename(suggestedName).PromptForSingleSelection()
	if err != nil {
		return "", fmt.Errorf("native file save is not available in this mode: %w", err)
	}
	return path, nil
}
