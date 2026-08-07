package composition

import "fmt"

// ResolvedList is a List's entries, assembled by whatever owns List
// storage at request time. Same shape and same reasoning as
// ResolvedConnector (integration.go): composition.go doesn't own List
// persistence (ConfigureService does), so this is injected once via
// SetListLookup rather than composition depending on ConfigureService
// directly.
type ResolvedList struct {
	Entries map[string]string
}

// lookupListFn defaults to erroring so a list-lookup node run before
// ConfigureService exists (or before SetListLookup wires it) fails
// loudly instead of silently no-op'ing.
var lookupListFn = func(listID string) (ResolvedList, error) {
	return ResolvedList{}, fmt.Errorf("no list lookup registered (yet) for id %q", listID)
}

// SetListLookup wires the function list-lookup nodes use to resolve a
// listId into its entries. Called once from main.go once ConfigureService
// exists.
func SetListLookup(fn func(listID string) (ResolvedList, error)) {
	lookupListFn = fn
}
