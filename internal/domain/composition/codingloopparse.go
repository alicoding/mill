package composition

import "strings"

// The coding-loop's own pure parser (docs/goals/0240 S1): turns one
// captured clipboard block into the visible step structure the
// Confirm/Running screens render and executeShellCommandBlock actually
// runs -- ONE definition, never re-derived on the display side and the
// execution side separately (the "S1 GO" directive's own no-drift
// requirement). Kept pure (no I/O, no package-level mutable state) so
// it's directly table-testable and safe to call from both the preview
// RPC and the node's exec function.
//
// Scope, stated rather than silently assumed: splits on a top-level
// newline or `&&` only, per docs/goals/0240's own ratified answer
// ("a pipeline (pipes) is ONE unit; newline/&&-separated commands are
// SEPARATE visible steps") -- `;` and backgrounding `&` are
// deliberately NOT treated as step separators (out of the goal's own
// enumerated join tokens), staying inside whatever segment they
// appear in. Quote-aware (single/double) and paren-depth-aware (so a
// `&&`/newline inside `$(...)` or `(...)` never splits), and a
// trailing `\` before a newline is treated as a real shell line
// continuation (the split never happens, the backslash+newline are
// both kept verbatim) -- the common shape a multi-line curl command
// with `-H` flags on separate lines actually takes.

// CommandJoin names how a parsed step relates to the step immediately
// before it.
type CommandJoin string

const (
	// JoinNone marks the first step -- there is no previous step to
	// relate to.
	JoinNone CommandJoin = ""
	// JoinNewline means the two steps were newline-separated: the next
	// step runs regardless of this one's outcome (matches pasting
	// multiple lines into a real terminal).
	JoinNewline CommandJoin = "newline"
	// JoinAnd means the two steps were `&&`-separated: the next step is
	// SKIPPED if this one fails, preserving `&&`'s own short-circuit
	// meaning even though the two sides now render as separate steps.
	JoinAnd CommandJoin = "and"
)

// ParsedCommandStep is one visible step of a parsed command block.
type ParsedCommandStep struct {
	Index int
	// Text is the step's own command text -- a pipeline's pipe(s) stay
	// intact inside this one string, run as a single shell invocation.
	Text string
	Join CommandJoin
	// LooksLikeSecretPlaceholder flags a heuristic secret-shaped marker
	// (looksLikeSecretPlaceholder, codingloopconfig.go) -- S1 never
	// resolves or blocks on this, it only drives the Confirm screen's
	// "will run as-is" label (goal 0240 S1's own stated default; S2
	// replaces this with the real vault->env->prompt chain).
	LooksLikeSecretPlaceholder bool
}

// rawSegment is splitTopLevel's own intermediate shape, before blank
// filtering and step-index assignment.
type rawSegment struct {
	text string
	join CommandJoin
}

// ParseShellCommandBlock splits raw into its visible step structure.
// Blank lines/segments are dropped; the first real step always carries
// JoinNone, regardless of how many blank lines preceded it.
func ParseShellCommandBlock(raw string) []ParsedCommandStep {
	normalized := strings.ReplaceAll(strings.ReplaceAll(raw, "\r\n", "\n"), "\r", "\n")
	steps := make([]ParsedCommandStep, 0, 4)
	for _, seg := range splitTopLevel(normalized) {
		text := strings.TrimSpace(seg.text)
		if text == "" {
			continue
		}
		join := seg.join
		if len(steps) == 0 {
			join = JoinNone
		}
		steps = append(steps, ParsedCommandStep{
			Index:                      len(steps),
			Text:                       text,
			Join:                       join,
			LooksLikeSecretPlaceholder: looksLikeSecretPlaceholder(text),
		})
	}
	return steps
}

// splitTopLevel is the character scanner: quote-aware, paren-depth-aware,
// splitting only on a top-level newline or `&&`. pendingJoin carries
// which separator led INTO the segment currently being flushed.
func splitTopLevel(raw string) []rawSegment {
	var segments []rawSegment
	var current strings.Builder
	var inSingle, inDouble, escaped bool
	depth := 0
	pendingJoin := JoinNone

	flush := func() {
		segments = append(segments, rawSegment{text: current.String(), join: pendingJoin})
		current.Reset()
	}

	runes := []rune(raw)
	for i := 0; i < len(runes); i++ {
		ch := runes[i]
		switch {
		case escaped:
			current.WriteRune(ch)
			escaped = false
		case inSingle:
			current.WriteRune(ch)
			if ch == '\'' {
				inSingle = false
			}
		case inDouble:
			current.WriteRune(ch)
			switch ch {
			case '\\':
				escaped = true
			case '"':
				inDouble = false
			}
		case ch == '\\':
			current.WriteRune(ch)
			escaped = true
		case ch == '\'':
			current.WriteRune(ch)
			inSingle = true
		case ch == '"':
			current.WriteRune(ch)
			inDouble = true
		case ch == '(':
			depth++
			current.WriteRune(ch)
		case ch == ')':
			if depth > 0 {
				depth--
			}
			current.WriteRune(ch)
		case ch == '\n' && depth == 0:
			flush()
			pendingJoin = JoinNewline
		case ch == '&' && depth == 0 && i+1 < len(runes) && runes[i+1] == '&':
			flush()
			pendingJoin = JoinAnd
			i++
		default:
			current.WriteRune(ch)
		}
	}
	flush()
	return segments
}
