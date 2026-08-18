// Package clipbridge is the clipboard bridge's protocol core (goal
// 0099): the JSON envelope Mill copies OUT for an external AI, and the
// validated reply it accepts back IN. The clipboard is the transport,
// the inline JSON Schema is the protocol, and the guardrail taxonomy
// (class.go) decides what a reply may do. Pure domain: no clipboard
// access, no persistence -- the service layer owns those.
package clipbridge

import (
	"encoding/json"
	"fmt"
	"sort"
)

// EnvelopeVersion is the "mill" marker value; a reply carrying a
// different version is refused with an honest error, never guessed at.
const EnvelopeVersion = 1

// KindContext is the OUT envelope's kind: card data plus the reply
// contract an external AI answers against.
const KindContext = "context"

// Envelope is the single JSON object Copy as context places on the
// clipboard. Schema is an INLINE JSON Schema 2020-12 document (the
// transport is an offline blob -- no URI resolution), restricted to the
// portable structured-output subset replySchemaBase documents.
type Envelope struct {
	Mill           int               `json:"mill"`
	Kind           string            `json:"kind"`
	Instructions   string            `json:"instructions"`
	Schema         json.RawMessage   `json:"schema"`
	AllowedActions []string          `json:"allowedActions"`
	Items          []json.RawMessage `json:"items"`
}

// ContextCard is one card's structured data inside an OUT envelope --
// the same facts renderCardContext prints as prose, as data.
type ContextCard struct {
	Title  string            `json:"title"`
	Kind   string            `json:"kind"`
	Note   string            `json:"note,omitempty"`
	Fields map[string]string `json:"fields,omitempty"`
	Links  []ContextLink     `json:"links,omitempty"`
}

// ContextLink names a relationship from the card's own point of view.
type ContextLink struct {
	Kind      string `json:"kind"`
	Direction string `json:"direction"` // "out" or "in"
	Title     string `json:"title"`
}

// replyInstructions is the one line of prose the contract allows; the
// schema is the rest of the instruction.
const replyInstructions = "Reply with a single JSON code block that conforms to the schema in this envelope's \"schema\" field."

// BuildContextEnvelope assembles the OUT envelope for a set of cards.
// kindLabels and actions become enum values inside the reply schema --
// the only dynamic parts, injected into fixed literal JSON so the
// portable-subset restriction can never widen at runtime.
func BuildContextEnvelope(cards []ContextCard, kindLabels []string, actions []string) (Envelope, error) {
	schema, err := ReplySchema(kindLabels, actions)
	if err != nil {
		return Envelope{}, err
	}
	items := make([]json.RawMessage, 0, len(cards))
	for _, c := range cards {
		raw, err := json.Marshal(c)
		if err != nil {
			return Envelope{}, fmt.Errorf("marshal context card %q: %w", c.Title, err)
		}
		items = append(items, raw)
	}
	sorted := append([]string(nil), actions...)
	sort.Strings(sorted)
	return Envelope{
		Mill:           EnvelopeVersion,
		Kind:           KindContext,
		Instructions:   replyInstructions,
		Schema:         schema,
		AllowedActions: sorted,
		Items:          items,
	}, nil
}
