package composition

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/guardrail"
)

// timestampStampFormat is the "timestamp" ConfigField's documented
// stamp-line layout when set to "datetime" -- local time, matching the
// field's own Description.
const timestampStampFormat = "2006-01-02 15:04"

func init() {
	RegisterNodeType(NodeType{
		ID: "apply-file-write", Kind: KindApply,
		Effect:      guardrail.ClassLocal,
		Complexity:  ComplexityBasic,
		Output:      "the payload it wrote, unchanged",
		Label:       "Apply: write to file",
		Description: "Writes the payload to a local file, appending to or overwriting its existing contents.",
		ConfigFields: []ConfigField{
			{
				Key: "path", Label: "File path", Type: FieldText,
				Description: "Where to write. Use an absolute path, or start with ~ for your home folder.",
				Default:     "",
			},
			{
				Key: "mode", Label: "Mode", Type: FieldOptions,
				Description: "Append adds to the end of the file. Overwrite replaces its entire contents.",
				Default:     "append", Options: []string{"append", "overwrite"},
			},
			{
				Key: "createDirs", Label: "Create missing folders", Type: FieldBoolean,
				Description: "Creates the file's parent folders if they don't exist yet. Off fails the step instead when a folder is missing.",
				Default:     "true",
			},
			{
				Key: "timestamp", Label: "Timestamp", Type: FieldOptions,
				Description: "Append mode only: \"datetime\" puts a date-and-time line before each entry. Ignored in overwrite mode.",
				Default:     "none", Options: []string{"none", "datetime"},
			},
		},
	}, execApplyFileWrite)
}

func execApplyFileWrite(node Node, ctx ExecContext) (ExecContext, error) {
	path, err := resolveFileWritePath(node.Config["path"])
	if err != nil {
		return ctx, fmt.Errorf("apply-file-write: %w", err)
	}

	if node.Config["createDirs"] == "true" {
		// 0o750, not 0o755 -- this repo's gosec gate (G301) caps
		// created-directory permissions at 0750; internal/adapters/
		// settings.go's own os.MkdirAll already uses the same mode.
		if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
			return ctx, fmt.Errorf("apply-file-write: %w", err)
		}
	}

	// Append mode's own no-op-on-empty-payload rule (applyFileWriteAppend
	// below) means no file content actually changed -- the cycle guard
	// (docs/goals/0087) only needs to record a REAL write, so it's only
	// called on the branch that actually touched the file.
	if node.Config["mode"] == "overwrite" {
		if err := applyFileWriteOverwrite(path, ctx.Payload); err != nil {
			return ctx, err
		}
		recordFileWriteFn(ctx.WorkflowID, path)
		return ctx, nil
	}
	if err := applyFileWriteAppend(path, ctx.Payload, node.Config["timestamp"] == "datetime"); err != nil {
		return ctx, err
	}
	if ctx.Payload != "" {
		recordFileWriteFn(ctx.WorkflowID, path)
	}
	return ctx, nil
}

// applyFileWriteOverwrite replaces path's entire contents with payload
// verbatim -- no added newline, no timestamp -- truncating (or
// creating) the file. An empty payload legitimately truncates it to
// empty.
func applyFileWriteOverwrite(path, payload string) error {
	if err := os.WriteFile(path, []byte(payload), 0o644); err != nil { //nolint:gosec // guardrail-gated user-configured path, by design (see fileread.Read's identical comment)
		return fmt.Errorf("apply-file-write: %w", err)
	}
	return nil
}

// applyFileWriteAppend adds payload to the end of path as one entry,
// no-op on an empty payload (mirrors process-inject-text's empty-input
// no-op). A trailing newline is added to the entry if missing, an
// optional stamp line is prepended when withTimestamp is set, and a
// blank-line separator precedes the entry whenever the file already
// has content, so consecutive entries never run together.
func applyFileWriteAppend(path, payload string, withTimestamp bool) error {
	if payload == "" {
		return nil
	}

	entry := payload
	if !strings.HasSuffix(entry, "\n") {
		entry += "\n"
	}
	if withTimestamp {
		entry = "[" + time.Now().Format(timestampStampFormat) + "]\n" + entry
	}
	if info, err := os.Stat(path); err == nil && info.Size() > 0 {
		entry = "\n" + entry
	}

	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644) //nolint:gosec // guardrail-gated user-configured path, by design (see fileread.Read's identical comment)
	if err != nil {
		return fmt.Errorf("apply-file-write: %w", err)
	}
	if _, err := f.WriteString(entry); err != nil {
		_ = f.Close()
		return fmt.Errorf("apply-file-write: %w", err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("apply-file-write: %w", err)
	}
	return nil
}

// resolveFileWritePath expands a leading "~" to the user's home
// directory -- Node.Config values never pass through a shell, so this
// node does the expansion itself. Any other relative path resolves
// against the process's working directory, the same stance
// internal/adapters/fileread.Read already takes (no divergent path
// semantics between the read and write sides).
func resolveFileWritePath(path string) (string, error) {
	if path == "" {
		return "", fmt.Errorf("no file path given")
	}
	if path != "~" && !strings.HasPrefix(path, "~/") {
		return path, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolving ~: %w", err)
	}
	if path == "~" {
		return home, nil
	}
	return filepath.Join(home, path[2:]), nil
}
