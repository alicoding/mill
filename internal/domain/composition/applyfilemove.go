package composition

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/guardrail"
)

func init() {
	RegisterNodeType(NodeType{
		ID: "apply-file-move", Kind: KindApply,
		Effect:      guardrail.ClassLocal,
		Complexity:  ComplexityBasic,
		Output:      "the file's new path",
		Label:       "Move file",
		Description: "Moves or renames a local file to a new location.",
		ConfigFields: []ConfigField{
			{
				Key: "sourcePath", Label: "Source file", Type: FieldText,
				Description: "File to move. Leave empty to use the incoming payload, or set a path or attr: value.",
				Default:     "",
			},
			{
				Key: "destination", Label: "Destination", Type: FieldText,
				Description: "Where the file goes. Tokens: {filename} {name} {ext} {date:2006-01-02} {attr:key}. End with / to keep the file's name.",
				Default:     "",
			},
			{
				Key: "createDirs", Label: "Create missing folders", Type: FieldBoolean,
				Description: "Creates the destination's parent folders if they don't exist yet. Off fails the step instead when a folder is missing.",
				Default:     "true",
			},
			{
				Key: "onConflict", Label: "If the destination exists", Type: FieldOptions,
				Description: "Fail stops the step. Suffix adds \" (2)\", \" (3)\", and so on to the file name.",
				Default:     "fail", Options: []string{"fail", "suffix"},
			},
		},
	}, execApplyFileMove)
}

func execApplyFileMove(node Node, ctx ExecContext) (ExecContext, error) {
	source, err := resolveFileMoveSourcePath(node.Config["sourcePath"], ctx)
	if err != nil {
		return ctx, fmt.Errorf("apply-file-move: %w", err)
	}

	dest, err := expandPathTemplate(node.Config["destination"], source, stringAttrs(ctx.Attributes), time.Now())
	if err != nil {
		return ctx, fmt.Errorf("apply-file-move: %w", err)
	}

	if node.Config["createDirs"] == "true" {
		// 0o750, not 0o755 -- this repo's gosec gate (G301) caps
		// created-directory permissions at 0750, same as
		// apply-file-write's identical MkdirAll call.
		if err := os.MkdirAll(filepath.Dir(dest), 0o750); err != nil {
			return ctx, fmt.Errorf("apply-file-move: %w", err)
		}
	}

	dest, err = resolveFileMoveConflict(dest, node.Config["onConflict"])
	if err != nil {
		return ctx, fmt.Errorf("apply-file-move: %w", err)
	}

	if err := moveFile(source, dest); err != nil {
		return ctx, fmt.Errorf("apply-file-move: %w", err)
	}

	// Both the vacated source and the new destination count as this
	// workflow's own write for the structural cycle guard (docs/goals/
	// 0087) -- a rename delivers a create event at dest and, on some
	// watchers, a remove/rename event at source, and either one re-
	// entering this same workflow's own trigger-filesystem-watch would
	// loop it.
	recordFileWriteFn(ctx.WorkflowID, source)
	recordFileWriteFn(ctx.WorkflowID, dest)

	ctx.Payload = dest
	return ctx, nil
}

// resolveFileMoveSourcePath resolves the sourcePath field: empty means
// "use the incoming payload" (trigger-filesystem-watch's own fire
// payload IS the changed file's path, docs/SPEC.md §3.4's Trigger row),
// otherwise a literal path or an "attr:<name>" reference resolved the
// same way every other ConfigField binding in this package already is
// (attributebinding.go's resolveBindingValue).
func resolveFileMoveSourcePath(raw string, ctx ExecContext) (string, error) {
	if raw == "" {
		if ctx.Payload == "" {
			return "", fmt.Errorf("no source path: sourcePath is empty and the incoming payload is empty too")
		}
		return ctx.Payload, nil
	}
	resolved := resolveBindingValue(raw, ctx.Attributes)
	if resolved == "" {
		return "", fmt.Errorf("sourcePath resolved to an empty value")
	}
	return resolved, nil
}

// stringAttrs stringifies an Attributes bag for expandPathTemplate's
// {attr:key} token -- the same fmt.Sprintf("%v", ...) stringification
// resolveBindingValue already applies to a single attr: reference.
func stringAttrs(attrs map[string]any) map[string]string {
	out := make(map[string]string, len(attrs))
	for k, v := range attrs {
		out[k] = fmt.Sprintf("%v", v)
	}
	return out
}

// expandPathTemplate expands template's {filename} {name} {ext}
// {date:<layout>} {attr:<key>} tokens against sourcePath/attrs/now, then
// keeps sourcePath's own base name when the expanded result names a
// directory -- either because it ends in a path separator, or because it
// already exists on disk as one. An unrecognized {...} token is a hard
// error (fail-safe: a typo'd token must not silently resolve to a wrong
// path).
func expandPathTemplate(template, sourcePath string, attrs map[string]string, now time.Time) (string, error) {
	if template == "" {
		return "", fmt.Errorf("no destination given")
	}
	expanded, err := substituteDestinationTokens(template, sourcePath, attrs, now)
	if err != nil {
		return "", err
	}

	keepName := strings.HasSuffix(expanded, "/") || strings.HasSuffix(expanded, string(filepath.Separator))
	if !keepName {
		if info, statErr := os.Stat(expanded); statErr == nil && info.IsDir() {
			keepName = true
		}
	}
	if keepName {
		expanded = filepath.Join(expanded, filepath.Base(sourcePath))
	}
	if expanded == "" {
		return "", fmt.Errorf("destination resolved to an empty path")
	}
	return expanded, nil
}

// substituteDestinationTokens walks template once, replacing every
// {...} token in place -- a hand-rolled scanner rather than
// regexp.ReplaceAllStringFunc since a couple of token kinds (date, attr)
// need their own captured suffix parsed out, which regexp's callback
// form makes more awkward than a single left-to-right pass.
func substituteDestinationTokens(template, sourcePath string, attrs map[string]string, now time.Time) (string, error) {
	var b strings.Builder
	i := 0
	for i < len(template) {
		if template[i] != '{' {
			b.WriteByte(template[i])
			i++
			continue
		}
		end := strings.IndexByte(template[i:], '}')
		if end == -1 {
			return "", fmt.Errorf("destination has an unterminated token: %q", template[i:])
		}
		token := template[i+1 : i+end]
		i += end + 1

		val, err := expandDestinationToken(token, sourcePath, attrs, now)
		if err != nil {
			return "", err
		}
		b.WriteString(val)
	}
	return b.String(), nil
}

func expandDestinationToken(token, sourcePath string, attrs map[string]string, now time.Time) (string, error) {
	switch {
	case token == "filename":
		return filepath.Base(sourcePath), nil
	case token == "name":
		base := filepath.Base(sourcePath)
		return strings.TrimSuffix(base, filepath.Ext(base)), nil
	case token == "ext":
		return filepath.Ext(sourcePath), nil
	case strings.HasPrefix(token, "date:"):
		layout := strings.TrimPrefix(token, "date:")
		if layout == "" {
			return "", fmt.Errorf("destination token {date:} needs a layout, e.g. {date:2006-01-02}")
		}
		return now.Format(layout), nil
	case strings.HasPrefix(token, "attr:"):
		return attrs[strings.TrimPrefix(token, "attr:")], nil
	default:
		return "", fmt.Errorf("unknown destination token {%s}", token)
	}
}

// resolveFileMoveConflict returns dest unchanged when nothing is there
// yet. Otherwise: "fail" (the default) errors; "suffix" finds the first
// free "name (2).ext", "name (3).ext", ... candidate, the same
// convention macOS Finder/most desktop file managers use for "safe
// rename".
func resolveFileMoveConflict(dest, onConflict string) (string, error) {
	if _, err := os.Stat(dest); err != nil {
		return dest, nil
	}
	if onConflict != "suffix" {
		return "", fmt.Errorf("destination already exists: %s", dest)
	}
	ext := filepath.Ext(dest)
	base := strings.TrimSuffix(dest, ext)
	for n := 2; ; n++ {
		candidate := fmt.Sprintf("%s (%d)%s", base, n, ext)
		if _, err := os.Stat(candidate); err != nil {
			return candidate, nil
		}
	}
}

// moveFile renames source to dest, falling back to a copy-then-remove
// when os.Rename fails -- covering the cross-device (EXDEV) case
// os.Rename can't handle on its own. Falls back unconditionally on ANY
// os.Rename error, rather than testing specifically for EXDEV: the
// errno constant naming a cross-device link differs by OS in Go's
// syscall package (this app builds for macOS/Linux/Windows, Taskfile.yml),
// and a non-cross-device failure simply reproduces with a clearer error
// during the copy attempt instead.
func moveFile(source, dest string) error {
	if err := os.Rename(source, dest); err == nil {
		return nil
	}
	return copyThenRemoveFile(source, dest)
}

func copyThenRemoveFile(source, dest string) error {
	info, err := os.Stat(source)
	if err != nil {
		return err
	}
	in, err := os.Open(source) //nolint:gosec // guardrail-gated user-configured path, by design (see fileread.Read's identical comment)
	if err != nil {
		return err
	}
	defer func() { _ = in.Close() }()

	out, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, info.Mode()) //nolint:gosec // guardrail-gated user-configured path, by design
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil { //nolint:gosec // guardrail-gated local file move, bounded by the source file's own size
		_ = out.Close()
		return err
	}
	if err := out.Sync(); err != nil {
		_ = out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	return os.Remove(source)
}
