package clisecrets

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fakeTools puts stub `op` and `bw` scripts first on PATH.
func fakeTools(t *testing.T, opScript, bwScript string) {
	t.Helper()
	dir := t.TempDir()
	for name, body := range map[string]string{"op": opScript, "bw": bwScript} {
		if body == "" {
			continue
		}
		if err := os.WriteFile(filepath.Join(dir, name), []byte("#!/bin/sh\n"+body), 0o700); err != nil { // #nosec G306 -- an executable test stub
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

func TestOnePassword_ListsAndReadsThroughTheCLI(t *testing.T) {
	fakeTools(t, `case "$1 $2" in
"item list") echo '[{"id":"abc123","title":"Jira PAT","vault":{"name":"Work"}},{"id":"def456","title":"Old","vault":{"name":"Personal"}}]' ;;
"read --no-newline") [ "$3" = "op://Work/abc123/password" ] && printf 'pat-value' || { echo "bad ref $3" >&2; exit 1; } ;;
*) echo "unexpected $*" >&2; exit 1 ;;
esac`, "")
	entries, err := ListOnePassword(context.Background(), "")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entries) != 2 || entries[0].ID != "Work/abc123" || entries[0].Title != "Jira PAT — Work" {
		t.Fatalf("entries = %+v", entries)
	}
	v, err := ResolveOnePassword(context.Background(), "Work/abc123")
	if err != nil || v != "pat-value" {
		t.Fatalf("resolve = %q err=%v", v, err)
	}
	if _, err := ResolveOnePassword(context.Background(), "abc123"); err == nil {
		t.Fatal("an id without a vault resolved")
	}
}

func TestOnePassword_LockedIsAStatedError(t *testing.T) {
	fakeTools(t, `echo "[ERROR] 2026/09/03 You are not currently signed in." >&2; exit 1`, "")
	if _, err := ListOnePassword(context.Background(), "Work"); err == nil || !strings.Contains(err.Error(), "not currently signed in") {
		t.Fatalf("err = %v", err)
	}
}

func TestBitwarden_StatusGatesTheListing(t *testing.T) {
	fakeTools(t, "", `case "$1" in
status) echo '{"status":"locked"}' ;;
*) echo "unexpected" >&2; exit 1 ;;
esac`)
	if _, err := ListBitwarden(context.Background()); err == nil || !strings.Contains(err.Error(), "locked") {
		t.Fatalf("locked err = %v", err)
	}
	fakeTools(t, "", `case "$1" in
status) echo '{"status":"unlocked"}' ;;
list) echo '[{"id":"11111111-2222","name":"Bank","login":{"password":"never-shown"}}]' ;;
get) [ "$2 $3" = "password 11111111-2222" ] && echo 'bw-secret' || { exit 1; } ;;
esac`)
	entries, err := ListBitwarden(context.Background())
	if err != nil || len(entries) != 1 || entries[0].ID != "11111111-2222" || entries[0].Title != "Bank" {
		t.Fatalf("entries = %+v err=%v", entries, err)
	}
	v, err := ResolveBitwarden(context.Background(), "11111111-2222")
	if err != nil || v != "bw-secret" {
		t.Fatalf("resolve = %q err=%v", v, err)
	}
}

func TestNotInstalled(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	if _, err := ListOnePassword(context.Background(), ""); !errors.Is(err, ErrNotInstalled) {
		t.Fatalf("op err = %v", err)
	}
	if _, err := ListBitwarden(context.Background()); !errors.Is(err, ErrNotInstalled) {
		t.Fatalf("bw err = %v", err)
	}
}
