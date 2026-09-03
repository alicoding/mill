package composition

import (
	"encoding/csv"
	"fmt"
	"strconv"
	"strings"

	"github.com/alicoding/mill/internal/adapters/todoscan"
	"github.com/alicoding/mill/internal/domain/guardrail"
)

// defaultTodoMarkers mirrors the "markers" ConfigField's own Default --
// named here too so execProcessTodoScan's empty-after-split fallback
// (a node whose config predates this field, or was cleared by hand)
// stays in one place with the field declaration below.
const defaultTodoMarkers = "TODO,FIXME,HACK,XXX"

func init() {
	RegisterNodeType(NodeType{
		ID: "process-todo-scan", Kind: KindProcess,
		Label:      "Scan a folder for TODO markers",
		Effect:     guardrail.ClassLocal,
		Complexity: ComplexityAdvanced,
		Consumes:   []PayloadKind{PayloadAny},
		Produces:   PayloadProduce{Kind: PayloadText},
		Output:     "a CSV table of every marker hit: file, line, marker, text",
		Description: "Walks a folder and lists every TODO-style marker it finds as a table: one row per hit " +
			"with the file, line, marker, and the text after it. Hidden folders, node_modules, vendor and " +
			".git are skipped.",
		ConfigFields: []ConfigField{
			{
				Key: "path", Label: "Folder", Type: FieldText,
				Description: "The folder to scan. A literal path or attr:<name>.",
			},
			{
				Key: "markers", Label: "Markers", Type: FieldText,
				Description: "Comma-separated words to look for, matched as whole words, case-sensitive.",
				Default:     defaultTodoMarkers,
			},
			{
				Key: "extensions", Label: "File types", Type: FieldText,
				Description: "Comma-separated extensions to include, e.g. go,ts,md. Blank scans every text file.",
				Default:     "",
			},
			{
				Key: "maxFiles", Label: "File limit", Type: FieldText,
				Description: "Stops after this many files so a huge folder never runs away.",
				Default:     "5000",
			},
		},
	}, execProcessTodoScan)
}

func execProcessTodoScan(node Node, ctx ExecContext) (ExecContext, error) {
	path := resolveBindingValue(node.Config["path"], ctx.Attributes)
	if path == "" {
		return ctx, fmt.Errorf("process-todo-scan: path is required")
	}
	maxFiles, err := strconv.Atoi(strings.TrimSpace(node.Config["maxFiles"]))
	if err != nil || maxFiles <= 0 {
		return ctx, fmt.Errorf("process-todo-scan: maxFiles must be a positive integer")
	}

	markers := splitCSVField(node.Config["markers"])
	if len(markers) == 0 {
		markers = splitCSVField(defaultTodoMarkers)
	}

	matches, err := todoscan.Scan(path, todoscan.Options{
		Markers:    markers,
		Extensions: splitCSVField(node.Config["extensions"]),
		MaxFiles:   maxFiles,
	})
	if err != nil {
		return ctx, fmt.Errorf("process-todo-scan: %w", err)
	}

	table, fileCount, err := todoScanCSV(matches)
	if err != nil {
		return ctx, fmt.Errorf("process-todo-scan: %w", err)
	}
	ctx.Payload = table
	if ctx.Attributes == nil {
		ctx.Attributes = map[string]any{}
	}
	ctx.Attributes["todoCount"] = len(matches)
	ctx.Attributes["todoFiles"] = fileCount
	return ctx, nil
}

// splitCSVField splits a comma-separated ConfigField value into its
// trimmed, non-empty parts. Returns nil for an empty/all-blank input.
func splitCSVField(raw string) []string {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// todoScanCSV renders matches as a header + one row per match, quoted
// by encoding/csv, and reports the count of distinct files hit.
func todoScanCSV(matches []todoscan.Match) (table string, distinctFiles int, err error) {
	var sb strings.Builder
	w := csv.NewWriter(&sb)
	if err := w.Write([]string{"file", "line", "marker", "text"}); err != nil {
		return "", 0, err
	}
	files := make(map[string]bool, len(matches))
	for _, m := range matches {
		files[m.File] = true
		if err := w.Write([]string{m.File, strconv.Itoa(m.Line), m.Marker, m.Text}); err != nil {
			return "", 0, err
		}
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return "", 0, err
	}
	return sb.String(), len(files), nil
}
