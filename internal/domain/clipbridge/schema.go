package clipbridge

import (
	"encoding/json"
	"fmt"
)

// KindReply is the reply envelope's kind -- fixed, so a reply and a
// context envelope are distinguishable on the same clipboard.
const KindReply = "reply"

// replySchemaTemplate is the committed literal reply contract. Two
// injection slots only -- the kind-label enum and the action enum --
// both filled with json.Marshal-ed string arrays, so the keyword
// vocabulary can never widen at runtime. The vocabulary deliberately
// stays inside the portable structured-output intersection the goal
// contract locks: type/object/properties/required/
// additionalProperties:false/enum/array items/local $refs -- no
// allOf/anyOf/if-then-else/external refs/recursion/format extensions
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
    "action": {"type": "string", "enum": %s},
    "items": {"type": "array", "items": {"$ref": "#/$defs/item"}}
  },
  "$defs": {
    "item": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "title": {"type": "string"},
        "kind": {"type": "string", "enum": %s},
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
	actionsJSON, err := json.Marshal(actions)
	if err != nil {
		return nil, fmt.Errorf("marshal actions enum: %w", err)
	}
	kindsJSON, err := json.Marshal(kindLabels)
	if err != nil {
		return nil, fmt.Errorf("marshal kinds enum: %w", err)
	}
	doc := fmt.Sprintf(replySchemaTemplate, actionsJSON, kindsJSON)
	var compact json.RawMessage
	if err := json.Unmarshal([]byte(doc), &compact); err != nil {
		return nil, fmt.Errorf("rendered reply schema is not valid JSON: %w", err)
	}
	return json.RawMessage(doc), nil
}
