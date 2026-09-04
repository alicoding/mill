// Package usererror carries the one sentence a failure shows the person
// using Mill, next to a stable code the UI keys its own wording on.
//
// A bound method's error reaches JavaScript as text. Without a typed
// shape that text is the whole `%w` chain, and the chain is the
// system's vocabulary, not the reader's (.claude/rules/ux-writing.md).
// An Error therefore carries two things and shows only one: Code, which
// never changes and is what a caller branches on, and Message, the one
// sentence the reader sees. The cause stays wrapped for errors.Is/As
// and for the log; it is never marshalled and never rendered.
//
// The shape is the converged one: a machine code plus a human sentence,
// the cause logged rather than shown.
package usererror

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// CodeUnexpected is the code every error that never declared one
// reaches the frontend as.
const CodeUnexpected = "unexpected"

// UnexpectedMessage is the sentence shown for an error that carries no
// user-facing wording of its own.
const UnexpectedMessage = "Something went wrong. Try again."

// Error is a failure with a stable code and one user-facing sentence.
// The zero value is not valid; build one with New or Wrap.
type Error struct {
	// Code is the stable handle callers branch on. It never changes
	// once a UI keys wording on it.
	Code string
	// Message is what the reader sees: one sentence, sentence case,
	// ending in terminal punctuation, carrying no ": " chain.
	Message string
	cause   error
}

// ValidMessage reports whether message satisfies the one-sentence rule
// Error.Message must hold: non-empty, starting with a capital, ending
// in terminal punctuation, and carrying no ": " chain (a chain is the
// system explaining itself, which is what this type exists to stop).
func ValidMessage(message string) bool {
	if message == "" || strings.Contains(message, ": ") {
		return false
	}
	if !strings.HasSuffix(message, ".") && !strings.HasSuffix(message, "!") && !strings.HasSuffix(message, "?") {
		return false
	}
	first := message[0]
	return first >= 'A' && first <= 'Z'
}

// mustMessage panics on a message that breaks the one-sentence rule.
// Every construction site passes a constant, so a break is a source
// defect the constructor's own test catches, never a runtime input.
func mustMessage(code, message string) {
	if !ValidMessage(message) {
		panic(fmt.Sprintf("usererror: code %q carries a message that is not one user-facing sentence: %q", code, message))
	}
}

// New builds an error with no cause to carry.
func New(code, message string) *Error {
	mustMessage(code, message)
	return &Error{Code: code, Message: message}
}

// Wrap builds an error whose cause stays reachable through errors.Is,
// errors.As and the boundary log, and unreachable from the UI.
func Wrap(code, message string, cause error) *Error {
	mustMessage(code, message)
	return &Error{Code: code, Message: message, cause: cause}
}

// Error returns the user-facing sentence alone, so a caller that
// stringifies the error still never prints the chain.
func (e *Error) Error() string { return e.Message }

// Unwrap exposes the cause to errors.Is/errors.As and to the log.
func (e *Error) Unwrap() error { return e.cause }

// Is treats two user errors sharing a Code as the same failure, so a
// package's exported sentinel keeps matching after a call site wrapped
// a cause onto it.
func (e *Error) Is(target error) bool {
	other, ok := target.(*Error)
	return ok && other.Code == e.Code
}

// MarshalJSON emits the code and the sentence only. The cause is
// deliberately absent: this value crosses to the frontend.
func (e *Error) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}{Code: e.Code, Message: e.Message})
}

// Of finds the user-facing error anywhere in err's chain.
func Of(err error) (*Error, bool) {
	var target *Error
	ok := errors.As(err, &target)
	return target, ok
}
