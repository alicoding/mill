// Package clisecrets reaches the user's password manager through its
// own command-line tool (goal 0306 slice 3, ADR-0050): 1Password's `op`
// and Bitwarden's `bw`. Mill lists entry TITLES and resolves one value
// at the moment a step needs it -- the tools' own documented scripting
// posture -- and stores nothing. Contract at the seam: every call runs
// under a bounded context (a locked `op` with app integration blocks on
// the app's own unlock prompt; a runaway process must never hang a
// resolve), a missing tool or a locked session is a stated error the
// source's own row reports, and `bw` needs the BW_SESSION the starting
// shell holds -- Mill never drives `bw unlock` (a master-password flow
// with no OS-level consent equivalent to `op`'s biometric handoff).
package clisecrets

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

const (
	ListTimeout    = 8 * time.Second
	ResolveTimeout = 45 * time.Second
)

// Entry is one listed item: the id Mill references and the title the
// picker shows. Never a value.
type Entry struct {
	ID    string
	Title string
}

// runCommand is the exec seam tests swap for fixtures.
var runCommand = func(ctx context.Context, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...) // #nosec G204 -- a fixed tool name with Mill-built arguments
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) || errors.Is(err, exec.ErrNotFound) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, fmt.Errorf("%s: %s", name, firstLine(stderr.String(), err.Error()))
		}
		return nil, err
	}
	return stdout.Bytes(), nil
}

func firstLine(s, fallback string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return fallback
	}
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return s
}

// ErrNotInstalled names a tool that is not on PATH.
var ErrNotInstalled = errors.New("not installed")

func installed(name string) error {
	if _, err := exec.LookPath(name); err != nil {
		return fmt.Errorf("%s is %w", name, ErrNotInstalled)
	}
	return nil
}

// ListOnePassword lists items (optionally one vault) as
// "<vault>/<item id>" → "<title> — <vault>". A locked or signed-out
// tool answers an error naming it.
func ListOnePassword(ctx context.Context, vault string) ([]Entry, error) {
	if err := installed("op"); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, ListTimeout)
	defer cancel()
	args := []string{"item", "list", "--format", "json"}
	if v := strings.TrimSpace(vault); v != "" {
		args = append(args, "--vault", v)
	}
	raw, err := runCommand(ctx, "op", args...)
	if err != nil {
		return nil, err
	}
	var items []struct {
		ID    string `json:"id"`
		Title string `json:"title"`
		Vault struct {
			Name string `json:"name"`
		} `json:"vault"`
	}
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, fmt.Errorf("op: unexpected item list output")
	}
	out := make([]Entry, 0, len(items))
	for _, it := range items {
		if it.ID == "" {
			continue
		}
		title := it.Title
		if it.Vault.Name != "" {
			title += " — " + it.Vault.Name
		}
		out = append(out, Entry{ID: it.Vault.Name + "/" + it.ID, Title: title})
	}
	return out, nil
}

// ResolveOnePassword reads the item's password field through the
// documented secret-reference form.
func ResolveOnePassword(ctx context.Context, id string) (string, error) {
	if err := installed("op"); err != nil {
		return "", err
	}
	vault, item, ok := strings.Cut(id, "/")
	if !ok || strings.TrimSpace(item) == "" {
		return "", fmt.Errorf("op reference %q: expected <vault>/<item id>", id)
	}
	ctx, cancel := context.WithTimeout(ctx, ResolveTimeout)
	defer cancel()
	raw, err := runCommand(ctx, "op", "read", "--no-newline", fmt.Sprintf("op://%s/%s/password", vault, item))
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

// ListBitwarden lists items as "<id>" → "<name>" once the session is
// unlocked; a locked or signed-out session is a stated error.
func ListBitwarden(ctx context.Context) ([]Entry, error) {
	if err := installed("bw"); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, ListTimeout)
	defer cancel()
	if err := bitwardenUnlocked(ctx); err != nil {
		return nil, err
	}
	raw, err := runCommand(ctx, "bw", "list", "items")
	if err != nil {
		return nil, err
	}
	var items []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, fmt.Errorf("bw: unexpected item list output")
	}
	out := make([]Entry, 0, len(items))
	for _, it := range items {
		if it.ID != "" {
			out = append(out, Entry{ID: it.ID, Title: it.Name})
		}
	}
	return out, nil
}

func bitwardenUnlocked(ctx context.Context) error {
	raw, err := runCommand(ctx, "bw", "status")
	if err != nil {
		return err
	}
	var st struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(raw, &st); err != nil {
		return fmt.Errorf("bw: unexpected status output")
	}
	switch st.Status {
	case "unlocked":
		return nil
	case "locked":
		return errors.New("bw: locked -- unlock with `bw unlock` in the shell that starts Mill")
	default:
		return errors.New("bw: not signed in")
	}
}

// ResolveBitwarden reads one item's password.
func ResolveBitwarden(ctx context.Context, id string) (string, error) {
	if err := installed("bw"); err != nil {
		return "", err
	}
	if strings.TrimSpace(id) == "" {
		return "", errors.New("bw reference: an item id is required")
	}
	ctx, cancel := context.WithTimeout(ctx, ResolveTimeout)
	defer cancel()
	raw, err := runCommand(ctx, "bw", "get", "password", id)
	if err != nil {
		return "", err
	}
	return strings.TrimRight(string(raw), "\r\n"), nil
}
