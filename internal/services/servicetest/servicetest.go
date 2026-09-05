// Package servicetest holds the shared, leaf-level test fakes more than
// one service package's tests need: an in-memory settings.Store and a
// no-op credential.Store, and an in-memory secret store. It implements
// the adapters' interfaces structurally rather than importing them, so
// any service package's in-package tests can use it without an import
// cycle; the domain types the secret store speaks in are leaves and
// cycle back into nothing. Helpers that construct real services (a configured
// ConfigureService, a guarded execution harness) stay in the one test
// package that uses them -- putting those here would cycle back into
// the packages under test.
package servicetest

import (
	"fmt"
	"sync"

	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/domain/secret"
	"github.com/alicoding/mill/internal/domain/vaultref"
)

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

// FakeSecretStore is an in-memory stand-in for Mill's secret store,
// for tests that need a Configure entity's secret REFERENCES to
// resolve (goal 0306) without standing up a real KDBX vault. It
// satisfies both seams ConfigureService needs: Create is
// SetSecretCreator's door, Resolve is SetSecretResolver's.
type FakeSecretStore struct {
	mu     sync.Mutex
	next   int
	values map[string]string
	titles map[string]string
	kinds  map[string]secret.Kind
}

func NewFakeSecretStore() *FakeSecretStore {
	return &FakeSecretStore{values: map[string]string{}, titles: map[string]string{}, kinds: map[string]secret.Kind{}}
}

// Create stores value under a fresh id and returns it.
func (f *FakeSecretStore) Create(title, value string, kind secret.Kind) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.next++
	id := fmt.Sprintf("entry-%d", f.next)
	f.values[id], f.titles[id], f.kinds[id] = value, title, kind
	return id, nil
}

// Resolve returns id's value, or an error when nothing is stored under
// it -- the same distinction a real locked-or-missing entry makes.
func (f *FakeSecretStore) Resolve(id string, _ secretaudit.AccessContext) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	value, ok := f.values[id]
	if !ok {
		return "", fmt.Errorf("no secret entry with id %q", id)
	}
	return value, nil
}

// Put stores value and returns the REFERENCE a Configure entity's
// field would hold -- the one-liner most tests want.
func (f *FakeSecretStore) Put(title, value string) string {
	id, _ := f.Create(title, value, secret.KindText)
	return vaultref.Ref(vaultref.ProviderVault, id)
}

// TitleOf and KindOf report what an entry was created as, so an
// adoption test can assert the entry it produced is named and
// classified the way the contract says.
func (f *FakeSecretStore) TitleOf(id string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.titles[id]
}

func (f *FakeSecretStore) KindOf(id string) secret.Kind {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.kinds[id]
}

// Len is how many entries exist.
func (f *FakeSecretStore) Len() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.values)
}
