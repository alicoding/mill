package clipbridge

import (
	"encoding/json"
	"fmt"
)

// KindReply is the reply envelope's kind -- fixed, so a reply and a
// context envelope are distinguishable on the same clipboard.
const KindReply = "reply"

// replySchemaTemplate is the committed literal reply contract; the two
// empty enums (action, item kind) are the ONLY parts ReplySchema fills
// in, and it does so structurally -- parse, set the arrays, re-marshal
// -- never by string formatting, so no label content can alter the
// document's shape. The vocabulary deliberately stays inside the
// portable structured-output intersection the goal contract locks:
// type/object/properties/required/additionalProperties:false/enum/
// array items/local $refs -- no allOf/anyOf/if-then-else/external
// refs/recursion/format extensions
// (TestReplySchema_KeywordsStayInsidePortableSubset pins this).
// Per-action item requirements (a card needs title, a note needs text)
// are deliberately NOT expressed conditionally -- conditionals are
// outside the subset -- and are enforced by ParseReply instead.
const replySchemaTemplate = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["mill", "kind", "action", "items"],
  "properties": {
    "mill": {"type": "integer", "enum": [1]},
    "kind": {"type": "string", "enum": ["reply"]},
    "action": {"type": "string", "enum": []},
    "items": {"type": "array", "items": {"$ref": "#/$defs/item"}}
  },
  "$defs": {
    "item": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "title": {"type": "string"},
        "kind": {"type": "string", "enum": []},
        "note": {"type": "string"},
        "summary": {"type": "string"},
        "text": {"type": "string"}
      }
    }
  }
}`

// ReplySchema renders the reply contract with the current kind labels
// and allowed actions as enums.
func ReplySchema(kindLabels []string, actions []string) (json.RawMessage, error) {
	if len(kindLabels) == 0 || len(actions) == 0 {
		return nil, fmt.Errorf("reply schema needs at least one kind label and one action")
	}
	var doc map[string]any
	if err := json.Unmarshal([]byte(replySchemaTemplate), &doc); err != nil {
		return nil, fmt.Errorf("committed reply schema template is not valid JSON: %w", err)
	}
	setEnum := func(path []string, values []string) error {
		node := doc
		for _, key := range path[:len(path)-1] {
			next, ok := node[key].(map[string]any)
			if !ok {
				return fmt.Errorf("reply schema template lost its %q node", key)
			}
			node = next
		}
		enum := make([]any, len(values))
		for i, v := range values {
			enum[i] = v
		}
		node[path[len(path)-1]] = map[string]any{"type": "string", "enum": enum}
		return nil
	}
	if err := setEnum([]string{"properties", "action"}, actions); err != nil {
		return nil, err
	}
	if err := setEnum([]string{"$defs", "item", "properties", "kind"}, kindLabels); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(doc)
	if err != nil {
		return nil, fmt.Errorf("marshal reply schema: %w", err)
	}
	return raw, nil
}
