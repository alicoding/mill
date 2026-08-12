// Package servicetest holds the shared, leaf-level test fakes more than
// one service package's tests need: an in-memory settings.Store and a
// no-op credential.Store. Deliberately dependency-free (it implements
// those adapters' interfaces structurally, importing neither), so any
// service package's in-package tests can use it without an import
// cycle. Helpers that construct real services (a configured
// ConfigureService, a guarded execution harness) stay in the one test
// package that uses them -- putting those here would cycle back into
// the packages under test.
package servicetest

// FakeStore is an in-memory settings.Store, so a service's
// persist/restore plumbing can be tested without a real file on disk.
type FakeStore struct {
	data map[string]any
	// SetErr, when non-nil, is returned by Set instead of actually
	// storing the value -- failure injection for docs/goals/0025's
	// persistence-error-propagation class, which was structurally
	// untestable before this (every persist() call site swallowed its
	// error with `_ =`, so there was no way to make Set fail and observe
	// what a caller did about it).
	SetErr error
}

// NewFakeStore returns an empty in-memory store.
func NewFakeStore() *FakeStore {
	return &FakeStore{data: make(map[string]any)}
}

// Get returns the stored value for key, or nil.
func (f *FakeStore) Get(key string) any {
	return f.data[key]
}

// Set stores value under key, or returns SetErr without storing anything
// if it's set -- see SetErr's own doc comment.
func (f *FakeStore) Set(key string, value any) error {
	if f.SetErr != nil {
		return f.SetErr
	}
	f.data[key] = value
	return nil
}

// FakeCredentialStore is a no-op credential.Store for tests that
// construct ConfigureService directly and have no need to exercise real
// keychain behavior.
type FakeCredentialStore struct{}

// Set is a no-op.
func (FakeCredentialStore) Set(string, string) error { return nil }

// Get always returns an empty secret.
func (FakeCredentialStore) Get(string) (string, error) { return "", nil }

// Delete is a no-op.
func (FakeCredentialStore) Delete(string) error { return nil }
