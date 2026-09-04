package usererror_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/usererror"
)

func TestNew_KeepsCodeAndSentence(t *testing.T) {
	err := usererror.New("no-vault-key", "There's no key for this vault on this device.")
	if err.Code != "no-vault-key" {
		t.Fatalf("Code = %q, want no-vault-key", err.Code)
	}
	if err.Error() != "There's no key for this vault on this device." {
		t.Fatalf("Error() = %q, want the sentence alone", err.Error())
	}
	if err.Unwrap() != nil {
		t.Fatalf("Unwrap() = %v, want nil for a causeless error", err.Unwrap())
	}
}

func TestError_NeverPrintsTheChain(t *testing.T) {
	cause := fmt.Errorf("github: download: %w", errors.New("no release asset"))
	err := usererror.Wrap("download-failed", "The update couldn't be downloaded.", cause)
	if strings.Contains(err.Error(), ":") {
		t.Fatalf("Error() = %q, want no chain", err.Error())
	}
	if !errors.Is(err, cause) {
		t.Fatal("the cause must stay reachable through errors.Is")
	}
}

func TestConstructors_RejectAChainedMessage(t *testing.T) {
	cases := map[string]string{
		"a chain":          "key-mismatch: the stored key does not open this vault file",
		"no terminator":    "The key on this device doesn't open this vault file",
		"lowercase opener": "the key on this device doesn't open this vault file.",
		"empty":            "",
	}
	for name, message := range cases {
		t.Run(name, func(t *testing.T) {
			if usererror.ValidMessage(message) {
				t.Fatalf("ValidMessage(%q) = true, want false", message)
			}
			assertPanics(t, func() { _ = usererror.New("some-code", message) })
			assertPanics(t, func() { _ = usererror.Wrap("some-code", message, errors.New("cause")) })
		})
	}
}

func assertPanics(t *testing.T, call func()) {
	t.Helper()
	defer func() {
		if recover() == nil {
			t.Fatal("want a panic on a message that is not one user-facing sentence")
		}
	}()
	call()
}

func TestMarshalJSON_OmitsTheCause(t *testing.T) {
	encoded, err := json.Marshal(usererror.Wrap("run-recovering", "Try again in a moment.", errors.New("dbos: row 41 still enqueued")))
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if string(encoded) != `{"code":"run-recovering","message":"Try again in a moment."}` {
		t.Fatalf("Marshal = %s, want code and message only", encoded)
	}
}

func TestOf_FindsTheUserErrorThroughAWrapper(t *testing.T) {
	wrapped := fmt.Errorf("unlocking the vault: %w", usererror.New("no-vault-key", "There's no key for this vault on this device."))
	found, ok := usererror.Of(wrapped)
	if !ok || found.Code != "no-vault-key" {
		t.Fatalf("Of = %v, %v; want the no-vault-key error", found, ok)
	}
	if _, ok := usererror.Of(errors.New("plain")); ok {
		t.Fatal("Of must not claim a plain error")
	}
}

func TestIs_MatchesASentinelByCode(t *testing.T) {
	sentinel := usererror.New("key-mismatch", "The key on this device doesn't open this vault file.")
	withCause := usererror.Wrap("key-mismatch", "The key on this device doesn't open this vault file.", errors.New("cipher: message authentication failed"))
	if !errors.Is(withCause, sentinel) {
		t.Fatal("a wrapped error sharing the sentinel's code must satisfy errors.Is")
	}
	if errors.Is(withCause, usererror.New("no-vault-key", "There's no key for this vault on this device.")) {
		t.Fatal("a different code must not satisfy errors.Is")
	}
}

func TestMarshalForWails_TypedErrorCrossesWholeAndIsNotLogged(t *testing.T) {
	var log bytes.Buffer
	marshal := usererror.MarshalForWails(slog.New(slog.NewTextHandler(&log, nil)))
	encoded := marshal(usererror.Wrap("run-not-waiting", "This run is no longer waiting.", errors.New("run abc is not waiting on a decision")))
	if string(encoded) != `{"code":"run-not-waiting","message":"This run is no longer waiting."}` {
		t.Fatalf("marshal = %s, want the typed code and sentence", encoded)
	}
	if log.Len() != 0 {
		t.Fatalf("a declared user error must not be logged as unhandled, got %q", log.String())
	}
}

func TestMarshalForWails_UntypedErrorBecomesGenericAndLogsTheChain(t *testing.T) {
	var log bytes.Buffer
	marshal := usererror.MarshalForWails(slog.New(slog.NewTextHandler(&log, nil)))
	encoded := marshal(fmt.Errorf("github: download: %w", errors.New("no release asset in test mode")))
	if string(encoded) != `{"code":"unexpected","message":"Something went wrong. Try again."}` {
		t.Fatalf("marshal = %s, want the generic sentence", encoded)
	}
	logged := log.String()
	if !strings.Contains(logged, "unhandled error at the boundary") {
		t.Fatalf("log = %q, want the boundary warning", logged)
	}
	if !strings.Contains(logged, "github: download: no release asset in test mode") {
		t.Fatalf("log = %q, want the full chain", logged)
	}
}

func TestMarshalForWails_NeverReturnsNil(t *testing.T) {
	marshal := usererror.MarshalForWails(nil)
	if marshal(nil) == nil || marshal(errors.New("boom")) == nil {
		t.Fatal("a nil return would fall back to the library default, which marshals a plain error to {}")
	}
}
