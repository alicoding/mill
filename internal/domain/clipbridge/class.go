package clipbridge

// ActionClass is the guardrail effect class an envelope action maps
// onto -- the taxonomy carrier is the existing gate's vocabulary, never
// a parallel system.
type ActionClass string

const (
	ClassRead    ActionClass = "read"
	ClassCreate  ActionClass = "create"
	ClassReplace ActionClass = "replace"
	ClassDelete  ActionClass = "delete"
	ClassUnknown ActionClass = "unknown"
)

// The v1 actions, both create-class. Replace/delete-class actions do
// not exist yet; when one lands, the field-level before/after review
// UI is REQUIRED in the same change (recorded in the goal contract).
const (
	ActionCreateCards      = "create-cards"
	ActionNoteToScratchpad = "note-to-scratchpad"
)

// V1Actions lists what the OUT envelope advertises today.
func V1Actions() []string {
	return []string{ActionCreateCards, ActionNoteToScratchpad}
}

// ClassOf maps an action to its effect class. Unknown actions classify
// as ClassUnknown and are refused upstream -- never guessed into a
// weaker class.
func ClassOf(action string) ActionClass {
	switch action {
	case ActionCreateCards, ActionNoteToScratchpad:
		return ClassCreate
	default:
		return ClassUnknown
	}
}

// MayAutoRun reports whether a class may execute without a human
// review-accept. The hard cap: mutation of existing data is never
// agentic regardless of source -- replace and delete always return
// false here, and no guardrail rule may override this (it is enforced
// in code, not configuration, by design).
func MayAutoRun(c ActionClass) bool {
	return c == ClassRead
}

// RequiresReview reports whether a class must pass the review-accept
// surface before executing. Everything that writes does.
func RequiresReview(c ActionClass) bool {
	switch c {
	case ClassCreate, ClassReplace, ClassDelete:
		return true
	default:
		return c == ClassUnknown
	}
}
