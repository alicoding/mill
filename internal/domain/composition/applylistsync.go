package composition

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/alicoding/mill/internal/domain/guardrail"
)

// The synced-List node (docs/goals/0299): a JSON payload's array of
// items becomes rows of a Configure-authored List, each upserted by
// a key column through the SAME write path apply-list-row uses --
// one guard, one audit, one row store. One-way by construction: this
// package has no node that writes to the source; a row's own door is
// whatever link the field map writes into a url column.

// ListSyncResult is what the wired sync reports back.
type ListSyncResult struct {
	Synced  int
	Expired int
}

// applyListSyncFn upserts every row by keyColumn and, when
// expireMissing is set, marks rows whose key is absent from this batch
// as expired (never deleted). Injected the same way applyListRowFn is.
var applyListSyncFn = func(listID, keyColumn string, rows []map[string]string, expireMissing bool) (ListSyncResult, error) {
	return ListSyncResult{}, fmt.Errorf("no list sync writer registered (yet) for id %q", listID)
}

// SetApplyListSync wires the sync writer. Called once from the
// composition root once ConfigureService exists.
func SetApplyListSync(fn func(listID, keyColumn string, rows []map[string]string, expireMissing bool) (ListSyncResult, error)) {
	applyListSyncFn = fn
}

func init() {
	RegisterNodeType(NodeType{
		ID: "apply-list-sync", Kind: KindApply,
		Label:      "Sync rows into a list",
		Effect:     guardrail.ClassLocal,
		Complexity: ComplexityAdvanced,
		Consumes:   []PayloadKind{PayloadJSON, PayloadText, PayloadAny},
		Produces:   PayloadProduce{Passthrough: true},
		Output:     "payload unchanged; syncedRows and expiredRows -> Attributes",
		Description: "Turns a JSON payload's array of items into rows of a Configure-authored List, one " +
			"row per item, matched by \"Key column\": an existing row with the same key is updated in the " +
			"mapped columns, a new key appends a row, and with \"Expire missing rows\" on, rows whose key is " +
			"absent from this result are marked expired (never deleted). One-way: nothing is written back " +
			"to the source, and a later sync overwrites the mapped columns of a row edited by hand.",
		ConfigFields: []ConfigField{
			{
				Key: "listId", Label: "List", Type: FieldText, RefKind: "list",
				Description: "The Configure-authored List that mirrors the source.",
			},
			{
				Key: "itemsPath", Label: "Items path", Type: FieldText,
				Description: "Dotted path to the array of items inside the JSON payload, e.g. issues. Blank when the payload itself is the array.",
			},
			{
				Key: "keyColumn", Label: "Key column", Type: FieldText,
				Description: "The List column that identifies an item. It must be named in the field map.",
			},
			{
				Key: "fieldMap", Label: "Field map", Type: FieldText, Multiline: true,
				Description: `JSON object mapping List column keys to a dotted path inside each item, e.g. ` +
					`{"key":"key","summary":"fields.summary","status":"fields.status.name"}. A value with ` +
					`{{path}} placeholders is a template, e.g. "https://jira.example.com/browse/{{key}}".`,
			},
			{
				Key: "expireMissing", Label: "Expire missing rows", Type: FieldBoolean, Default: "true",
				Description: "Mark rows whose key is absent from this result as expired.",
			},
		},
	}, execApplyListSync)
}

var templatePlaceholder = regexp.MustCompile(`\{\{\s*([^}]+?)\s*\}\}`)

func execApplyListSync(node Node, ctx ExecContext) (ExecContext, error) {
	listID := node.Config["listId"]
	if listID == "" {
		return ctx, fmt.Errorf("apply-list-sync: listId is required")
	}
	keyColumn := node.Config["keyColumn"]
	if keyColumn == "" {
		return ctx, fmt.Errorf("apply-list-sync: keyColumn is required")
	}
	fieldMap, err := parseBindings(node.Config["fieldMap"])
	if err != nil {
		return ctx, fmt.Errorf("apply-list-sync: fieldMap: %w", err)
	}
	if _, ok := fieldMap[keyColumn]; !ok {
		return ctx, fmt.Errorf("apply-list-sync: fieldMap must name the key column %q", keyColumn)
	}
	items, err := itemsFromPayload(ctx.Payload, node.Config["itemsPath"])
	if err != nil {
		return ctx, fmt.Errorf("apply-list-sync: %w", err)
	}
	rows := make([]map[string]string, 0, len(items))
	for i, item := range items {
		row := make(map[string]string, len(fieldMap))
		for col, spec := range fieldMap {
			row[col] = resolveFieldSpec(spec, item)
		}
		if row[keyColumn] == "" {
			return ctx, fmt.Errorf("apply-list-sync: item %d has no value at the key column's path", i)
		}
		rows = append(rows, row)
	}
	expire := node.Config["expireMissing"] == "true"
	result, err := applyListSyncFn(listID, keyColumn, rows, expire)
	if err != nil {
		return ctx, fmt.Errorf("apply-list-sync: %w", err)
	}
	if ctx.Attributes == nil {
		ctx.Attributes = map[string]any{}
	}
	ctx.Attributes["syncedRows"] = result.Synced
	ctx.Attributes["expiredRows"] = result.Expired
	return ctx, nil
}

// itemsFromPayload decodes the payload and walks itemsPath to the
// array. A payload that is not JSON, a path that leads nowhere, or a
// non-array at its end all fail loudly -- a silent empty sync would
// expire every row.
func itemsFromPayload(payload, itemsPath string) ([]any, error) {
	var doc any
	if err := json.Unmarshal([]byte(payload), &doc); err != nil {
		return nil, fmt.Errorf("payload is not JSON: %w", err)
	}
	at, ok := lookupPath(doc, itemsPath)
	if !ok {
		return nil, fmt.Errorf("itemsPath %q not found in the payload", itemsPath)
	}
	items, ok := at.([]any)
	if !ok {
		return nil, fmt.Errorf("itemsPath %q is not an array", itemsPath)
	}
	return items, nil
}

// lookupPath walks a dotted path through objects and arrays (a numeric
// segment indexes an array). An empty path is the value itself.
func lookupPath(v any, path string) (any, bool) {
	if strings.TrimSpace(path) == "" {
		return v, true
	}
	cur := v
	for _, seg := range strings.Split(path, ".") {
		switch node := cur.(type) {
		case map[string]any:
			next, ok := node[seg]
			if !ok {
				return nil, false
			}
			cur = next
		case []any:
			i, err := strconv.Atoi(seg)
			if err != nil || i < 0 || i >= len(node) {
				return nil, false
			}
			cur = node[i]
		default:
			return nil, false
		}
	}
	return cur, true
}

// resolveFieldSpec answers a column's value for one item: a template
// substitutes every {{path}}, a plain spec is a path. A missing path
// resolves to "" (a sparse source field stays blank, never fails the
// whole sync).
func resolveFieldSpec(spec string, item any) string {
	if templatePlaceholder.MatchString(spec) {
		return templatePlaceholder.ReplaceAllStringFunc(spec, func(m string) string {
			inner := templatePlaceholder.FindStringSubmatch(m)[1]
			v, _ := lookupPath(item, inner)
			return stringifyPathValue(v)
		})
	}
	v, _ := lookupPath(item, spec)
	return stringifyPathValue(v)
}

func stringifyPathValue(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(x)
	default:
		b, err := json.Marshal(x)
		if err != nil {
			return ""
		}
		return string(b)
	}
}
