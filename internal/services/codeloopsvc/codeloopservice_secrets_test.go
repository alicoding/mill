package codeloopsvc

import "testing"

func TestTypedSecretsStore_TakeIsSingleUse(t *testing.T) {
	store := newTypedSecretsStore()
	token := store.Stash(map[string]string{"GITHUB_TOKEN": "typed-fixture"})

	got, ok := store.Take(token, "GITHUB_TOKEN")
	if !ok || got != "typed-fixture" {
		t.Fatalf("first Take = (%q, %v), want (typed-fixture, true)", got, ok)
	}

	if _, ok := store.Take(token, "GITHUB_TOKEN"); ok {
		t.Error("second Take for the same var succeeded -- a typed secret must be readable exactly once")
	}
}

func TestTypedSecretsStore_UnknownTokenNotFound(t *testing.T) {
	store := newTypedSecretsStore()
	if _, ok := store.Take("no-such-token", "VAR"); ok {
		t.Error("Take on an unknown token: want ok=false")
	}
}

func TestTypedSecretsStore_EmptyTokenNotFound(t *testing.T) {
	store := newTypedSecretsStore()
	if _, ok := store.Take("", "VAR"); ok {
		t.Error("Take with an empty token (every run with no typed secrets): want ok=false")
	}
}

func TestTypedSecretsStore_IndependentVarsInOneToken(t *testing.T) {
	store := newTypedSecretsStore()
	token := store.Stash(map[string]string{"A": "va", "B": "vb"})

	if got, ok := store.Take(token, "A"); !ok || got != "va" {
		t.Fatalf("Take(A) = (%q, %v), want (va, true)", got, ok)
	}
	// B must still be readable -- consuming A must not clear the whole
	// token's entry, only the one var read.
	if got, ok := store.Take(token, "B"); !ok || got != "vb" {
		t.Fatalf("Take(B) = (%q, %v), want (vb, true)", got, ok)
	}
}

func TestTypedSecretsStore_DistinctTokensPerStash(t *testing.T) {
	store := newTypedSecretsStore()
	t1 := store.Stash(map[string]string{"VAR": "one"})
	t2 := store.Stash(map[string]string{"VAR": "two"})
	if t1 == t2 {
		t.Fatal("two Stash calls returned the same token")
	}
	if got, _ := store.Take(t1, "VAR"); got != "one" {
		t.Errorf("Take(t1) = %q, want one", got)
	}
	if got, _ := store.Take(t2, "VAR"); got != "two" {
		t.Errorf("Take(t2) = %q, want two", got)
	}
}
