package settingssvc

import (
	"encoding/base64"
	"fmt"
	"os"

	"github.com/alicoding/mill/internal/adapters/windowing"
)

// SaveTextFile prompts with the OS-native save dialog (suggestedName
// pre-filled) and writes content to whatever path the user picks --
// the desktop-mode counterpart to a browser's own download prompt,
// which the Wails webview does not provide (an anchor-element download
// click is silently inert there). Returns the chosen path, or "" with
// a nil error when the user cancels. Server mode and any other run
// without a live windowed application (a headless `go test`, in
// particular) return a nil app from application.Get() -- the same
// no-op guard atlasservice_share.go's revealPath uses -- and this
// method reports that as an error rather than a silent no-op, since
// unlike an OS-reveal action a caller genuinely needs to know the
// save never happened. A real `-tags server` build additionally
// degrades through Wails3's own server-mode dialog stub, which
// already returns an equivalent "not available" error.
func (s *SettingsService) SaveTextFile(suggestedName, content string) (string, error) {
	return saveFile(suggestedName, []byte(content), windowing.SaveFileDialog, os.WriteFile)
}

// SaveBinaryFile is SaveTextFile's byte-preserving counterpart for native
// exports. The base64 wire value is decoded before opening the dialog so an
// invalid payload can never prompt for or create a destination.
func (s *SettingsService) SaveBinaryFile(suggestedName, contentBase64 string) (string, error) {
	return saveBinaryFile(suggestedName, contentBase64, windowing.SaveFileDialog, os.WriteFile)
}

type saveFilePrompt func(string) (string, error)
type saveFileWrite func(string, []byte, os.FileMode) error

func saveBinaryFile(suggestedName, contentBase64 string, prompt saveFilePrompt, write saveFileWrite) (string, error) {
	content, err := base64.StdEncoding.Strict().DecodeString(contentBase64)
	if err != nil {
		return "", fmt.Errorf("decode file content: %w", err)
	}
	return saveFile(suggestedName, content, prompt, write)
}

func saveFile(suggestedName string, content []byte, prompt saveFilePrompt, write saveFileWrite) (string, error) {
	path, err := prompt(suggestedName)
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	if err := write(path, content, 0o600); err != nil {
		return "", fmt.Errorf("write file: %w", err)
	}
	return path, nil
}
