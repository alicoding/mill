package clipbridge

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"golang.org/x/text/language"
	"golang.org/x/text/message"
)

// CardDraft is one to-be-created card parsed from a valid create-cards
// reply -- exactly what the review surface previews.
type CardDraft struct {
	Title   string `json:"title"`
	Kind    string `json:"kind,omitempty"`
	Note    string `json:"note,omitempty"`
	Summary string `json:"summary,omitempty"`
}

// ReplyPreview is ParseReply's typed result. Never a bare Go error for
// user-visible failure modes -- the malformed cases render inline (the
// PreviewClipboardApply precedent), so every refusal names itself.
type ReplyPreview struct {
	Recognized bool        `json:"Recognized"` // a {"mill": ...} object at all
	Valid      bool        `json:"Valid"`
	Action     string      `json:"Action"`
	Class      ActionClass `json:"Class"`
	Errors     []string    `json:"Errors"`
	Cards      []CardDraft `json:"Cards"`
	NoteTexts  []string    `json:"NoteTexts"`
}

type replyWire struct {
	Mill   *int              `json:"mill"`
	Kind   string            `json:"kind"`
	Action string            `json:"action"`
	Items  []json.RawMessage `json:"items"`
}

// ParseReply validates a raw clipboard string against the v1 reply
// contract rendered with the CURRENT kind labels and actions. The
// schema validates shape; the per-action item requirements the schema
// deliberately cannot express (conditionals are outside the portable
// subset) are enforced here with named errors.
func ParseReply(raw string, kindLabels []string, actions []string) ReplyPreview {
	trimmed := stripCodeFence(strings.TrimSpace(raw))
	var wire replyWire
	if err := json.Unmarshal([]byte(trimmed), &wire); err != nil || wire.Mill == nil {
		return ReplyPreview{Recognized: false}
	}
	p := ReplyPreview{Recognized: true, Action: wire.Action, Class: ClassOf(wire.Action)}
	if *wire.Mill != EnvelopeVersion {
		p.Errors = append(p.Errors, fmt.Sprintf("unsupported envelope version %d (this Mill speaks version %d)", *wire.Mill, EnvelopeVersion))
		return p
	}

	schemaDocRaw, err := ReplySchema(kindLabels, actions)
	if err != nil {
		p.Errors = append(p.Errors, fmt.Sprintf("internal: reply schema unavailable: %v", err))
		return p
	}
	schemaDoc, err := jsonschema.UnmarshalJSON(bytes.NewReader(schemaDocRaw))
	if err != nil {
		p.Errors = append(p.Errors, fmt.Sprintf("internal: reply schema unreadable: %v", err))
		return p
	}
	compiler := jsonschema.NewCompiler()
	if err := compiler.AddResource("mill://schema/clipbridge-reply/v1", schemaDoc); err != nil {
		p.Errors = append(p.Errors, fmt.Sprintf("internal: reply schema rejected: %v", err))
		return p
	}
	schema, err := compiler.Compile("mill://schema/clipbridge-reply/v1")
	if err != nil {
		p.Errors = append(p.Errors, fmt.Sprintf("internal: reply schema does not compile: %v", err))
		return p
	}
	instance, err := jsonschema.UnmarshalJSON(strings.NewReader(trimmed))
	if err != nil {
		p.Errors = append(p.Errors, fmt.Sprintf("reply is not valid JSON: %v", err))
		return p
	}
	if err := schema.Validate(instance); err != nil {
		p.Errors = append(p.Errors, schemaErrorLines(err)...)
		return p
	}

	// Shape is valid; now the per-action requirements.
	switch wire.Action {
	case ActionCreateCards:
		for i, item := range wire.Items {
			var d CardDraft
			if err := json.Unmarshal(item, &d); err != nil {
				p.Errors = append(p.Errors, fmt.Sprintf("item %d: unreadable: %v", i+1, err))
				continue
			}
			if strings.TrimSpace(d.Title) == "" {
				p.Errors = append(p.Errors, fmt.Sprintf("item %d: a card needs a non-empty \"title\"", i+1))
				continue
			}
			p.Cards = append(p.Cards, d)
		}
		if len(wire.Items) == 0 {
			p.Errors = append(p.Errors, "the reply carries no items to create")
		}
	case ActionNoteToScratchpad:
		for i, item := range wire.Items {
			var d struct {
				Text string `json:"text"`
			}
			if err := json.Unmarshal(item, &d); err != nil {
				p.Errors = append(p.Errors, fmt.Sprintf("item %d: unreadable: %v", i+1, err))
				continue
			}
			if strings.TrimSpace(d.Text) == "" {
				p.Errors = append(p.Errors, fmt.Sprintf("item %d: a note needs a non-empty \"text\"", i+1))
				continue
			}
			p.NoteTexts = append(p.NoteTexts, d.Text)
		}
		if len(wire.Items) == 0 {
			p.Errors = append(p.Errors, "the reply carries no items to save")
		}
	default:
		// The schema's action enum already refused unknown actions; this
		// branch only exists for defense in depth.
		p.Errors = append(p.Errors, fmt.Sprintf("action %q is not offered by this Mill", wire.Action))
	}

	p.Valid = len(p.Errors) == 0
	return p
}

// stripCodeFence tolerates a reply pasted from a chat surface that
// wraps JSON in a markdown code fence -- the contract asks for a bare
// JSON block, but a fenced one is unambiguous and refusing it would be
// pedantry the user pays for.
func stripCodeFence(s string) string {
	if !strings.HasPrefix(s, "```") {
		return s
	}
	body, ok := strings.CutPrefix(s, "```")
	if !ok {
		return s
	}
	if idx := strings.Index(body, "\n"); idx >= 0 {
		body = body[idx+1:]
	}
	body = strings.TrimSpace(body)
	body = strings.TrimSuffix(body, "```")
	return strings.TrimSpace(body)
}

// schemaErrorLines flattens a jsonschema validation error into honest,
// per-failure lines naming what failed where.
func schemaErrorLines(err error) []string {
	var ve *jsonschema.ValidationError
	if !errors.As(err, &ve) {
		return []string{err.Error()}
	}
	printer := message.NewPrinter(language.English)
	var lines []string
	var walk func(e *jsonschema.ValidationError)
	walk = func(e *jsonschema.ValidationError) {
		if len(e.Causes) == 0 {
			loc := "/" + strings.Join(e.InstanceLocation, "/")
			lines = append(lines, fmt.Sprintf("%s: %s", loc, e.ErrorKind.LocalizedString(printer)))
			return
		}
		for _, c := range e.Causes {
			walk(c)
		}
	}
	walk(ve)
	if len(lines) == 0 {
		lines = []string{err.Error()}
	}
	return lines
}
