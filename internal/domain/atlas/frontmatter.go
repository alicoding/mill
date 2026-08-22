package atlas

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"

	"github.com/alicoding/mill/internal/domain/typedfield"
)

// ParseFrontmatter extracts the YAML header framed by content's first
// two standalone "---" lines into a raw key/value map, preserving
// YAML's own inferred scalar types (string, bool, int, float64,
// time.Time) and list types ([]any) rather than a fixed Go struct
// (goal 0172): a struct only understands the field names it was
// written for, so a folder using entirely different frontmatter keys
// parsed nothing useful. Bounded to exactly those two delimiter lines
// -- found by scanning forward from line 1 and stopping at the FIRST
// match -- so a document whose body also contains a standalone "---"
// (a markdown horizontal rule right after the header, as two files in
// docs/goals/archive already do) is never misread as framing a second
// frontmatter block. ok is false, with no error, when content doesn't
// open with a "---" line at all or never closes one -- absent
// frontmatter is a normal case for this parser, not a failure.
func ParseFrontmatter(content []byte) (fm map[string]any, ok bool, err error) {
	lines := strings.Split(string(content), "\n")
	if len(lines) == 0 || strings.TrimRight(lines[0], "\r") != "---" {
		return nil, false, nil
	}
	end := -1
	for i := 1; i < len(lines); i++ {
		if strings.TrimRight(lines[i], "\r") == "---" {
			end = i
			break
		}
	}
	if end == -1 {
		return nil, false, nil
	}
	block := strings.Join(lines[1:end], "\n")
	var raw map[string]any
	if err := yaml.Unmarshal([]byte(block), &raw); err != nil {
		return nil, false, err
	}
	if raw == nil {
		raw = map[string]any{}
	}
	return raw, true, nil
}

// CoerceFrontmatterFields maps a raw parsed frontmatter header onto a
// Kind's field set (goal 0172's "the Kind is the contract"): a
// frontmatter key that literally matches a Field's own Key -- or one
// of that Field's FrontmatterAliases when the Key itself has no match
// -- is coerced to a wire-format string and written under the Field's
// Key; every other frontmatter key is ignored, and a Field with no
// matching key anywhere in raw is left ABSENT from the result. That
// absence is what lets a caller merging only the returned keys
// (atlassvc.MergeCardFields) preserve any field a re-synced file
// simply doesn't carry -- an owner-owned field survives a re-sync by
// construction, never a special case.
func CoerceFrontmatterFields(raw map[string]any, fields []typedfield.Field) map[string]string {
	out := make(map[string]string, len(fields))
	for _, f := range fields {
		v, present := raw[f.Key]
		if !present {
			for _, alias := range f.FrontmatterAliases {
				if v, present = raw[alias]; present {
					break
				}
			}
		}
		if !present {
			continue
		}
		out[f.Key] = coerceFrontmatterValue(v)
	}
	return out
}

// coerceFrontmatterValue formats one raw YAML-decoded value as Mill's
// existing field-value wire format (a plain string; every
// Node.Config/Card.Fields entry already is one). A list coerces to
// the same comma-joined text a multi-value ledger field already
// produced before this parser was generic; a date-shaped scalar
// (YAML's own timestamp resolution for an unquoted date) formats as
// YYYY-MM-DD, matching the quoted-string date convention
// docs/goals/archive already uses.
func coerceFrontmatterValue(v any) string {
	if list, isList := v.([]any); isList {
		parts := make([]string, 0, len(list))
		for _, item := range list {
			parts = append(parts, coerceFrontmatterScalar(item))
		}
		return strings.Join(parts, ", ")
	}
	return coerceFrontmatterScalar(v)
}

func coerceFrontmatterScalar(v any) string {
	switch val := v.(type) {
	case nil:
		return ""
	case string:
		return val
	case bool:
		return strconv.FormatBool(val)
	case int:
		return strconv.Itoa(val)
	case int64:
		return strconv.FormatInt(val, 10)
	case float64:
		return strconv.FormatFloat(val, 'f', -1, 64)
	case time.Time:
		return val.Format("2006-01-02")
	default:
		return fmt.Sprint(val)
	}
}
