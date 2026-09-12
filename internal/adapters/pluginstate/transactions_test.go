package pluginstate

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"testing"
)

func TestTransactionReadsDoNotCreateOrMigrateState(t *testing.T) {
	dir := t.TempDir()
	store := New(dir)
	if payload, revision, present, err := store.LoadApproval(context.Background()); err != nil || present || revision != 0 || payload != nil {
		t.Fatalf("LoadApproval = %q, %d, %v, %v", payload, revision, present, err)
	}
	if records, err := store.ListInstallTransactions(context.Background()); err != nil || len(records) != 0 {
		t.Fatalf("ListInstallTransactions = %+v, %v", records, err)
	}
	if _, err := os.Stat(Path(dir)); !os.IsNotExist(err) {
		t.Fatalf("read-only ports created state: %v", err)
	}
}

func TestTransactionWriteMigratesSchemaOneAndPreservesCatalog(t *testing.T) {
	ctx := context.Background()
	store := New(t.TempDir())
	if _, _, err := store.Update(ctx, bytesInitializer("catalog"), identityChange); err != nil {
		t.Fatal(err)
	}
	catalogInitializerCalls := 0
	payload, revision, err := store.UpdateApproval(ctx, func() ([]byte, error) {
		catalogInitializerCalls++
		return []byte("wrong"), nil
	}, bytesInitializer("approval"), func(current []byte) ([]byte, error) {
		return append(current, '!'), nil
	})
	if err != nil || revision != 1 || string(payload) != "approval!" {
		t.Fatalf("UpdateApproval = %q, %d, %v", payload, revision, err)
	}
	if catalogInitializerCalls != 0 {
		t.Fatalf("schema-one migration called catalog initializer %d times", catalogInitializerCalls)
	}
	catalog, catalogRevision, present, err := store.Load(ctx)
	if err != nil || !present || catalogRevision != 1 || string(catalog) != "catalog" {
		t.Fatalf("catalog after migration = %q, %d, %v, %v", catalog, catalogRevision, present, err)
	}
	loaded, loadedRevision, present, err := store.LoadApproval(ctx)
	if err != nil || !present || loadedRevision != 1 || string(loaded) != "approval!" {
		t.Fatalf("approval after migration = %q, %d, %v, %v", loaded, loadedRevision, present, err)
	}
}

func TestInstallTransactionCompareAndSwapAndDelete(t *testing.T) {
	ctx := context.Background()
	store := New(t.TempDir())
	initializer := bytesInitializer("catalog")
	revision, err := store.CompareAndSwapInstallTransaction(ctx, initializer, "bbb", 0, []byte("one"))
	if err != nil || revision != 1 {
		t.Fatalf("insert = %d, %v", revision, err)
	}
	if _, err := store.CompareAndSwapInstallTransaction(ctx, initializer, "bbb", 0, []byte("duplicate")); err == nil {
		t.Fatal("insert-only compare-and-swap replaced an existing row")
	}
	if _, err := store.CompareAndSwapInstallTransaction(ctx, initializer, "bbb", 2, []byte("stale")); err == nil {
		t.Fatal("stale compare-and-swap succeeded")
	}
	revision, err = store.CompareAndSwapInstallTransaction(ctx, initializer, "bbb", 1, []byte("two"))
	if err != nil || revision != 2 {
		t.Fatalf("replace = %d, %v", revision, err)
	}
	if _, err := store.CompareAndSwapInstallTransaction(ctx, initializer, "aaa", 0, []byte("other")); err != nil {
		t.Fatal(err)
	}
	records, err := store.ListInstallTransactions(ctx)
	if err != nil || len(records) != 2 || records[0].ID != "aaa" || records[1].ID != "bbb" || records[1].Revision != 2 || string(records[1].Payload) != "two" {
		t.Fatalf("records = %+v, %v", records, err)
	}
	records[1].Payload[0] = 'X'
	again, err := store.ListInstallTransactions(ctx)
	if err != nil || string(again[1].Payload) != "two" {
		t.Fatalf("payload was not detached: %+v, %v", again, err)
	}
	if err := store.DeleteInstallTransaction(ctx, "bbb", 1); err == nil {
		t.Fatal("stale delete succeeded")
	}
	if err := store.DeleteInstallTransaction(ctx, "bbb", 2); err != nil {
		t.Fatal(err)
	}
	after, err := store.ListInstallTransactions(ctx)
	if err != nil || len(after) != 1 || after[0].ID != "aaa" {
		t.Fatalf("after delete = %+v, %v", after, err)
	}
}

func TestSchemaTwoRefusesUnexpectedObjectsBeforeCallbacks(t *testing.T) {
	ctx := context.Background()
	path := Path(t.TempDir())
	db, err := sql.Open("sqlite", sqliteDSN(path))
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		catalogSchema,
		installTransactionsSchema,
		approvalSchema,
		"CREATE TABLE unexpected(value TEXT)",
		"PRAGMA user_version=2",
	} {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	callbacks := 0
	store := NewAt(path)
	_, _, err = store.UpdateApproval(ctx, func() ([]byte, error) {
		callbacks++
		return []byte("catalog"), nil
	}, func() ([]byte, error) {
		callbacks++
		return []byte("approval"), nil
	}, func(current []byte) ([]byte, error) {
		callbacks++
		return current, nil
	})
	if err == nil || !strings.Contains(err.Error(), "unexpected objects") {
		t.Fatalf("UpdateApproval error = %v", err)
	}
	if callbacks != 0 {
		t.Fatalf("callbacks = %d, want none", callbacks)
	}
}

func TestSchemaTwoCommitReadbackClassifiesIntendedPriorAndInterveningState(t *testing.T) {
	ctx := context.Background()
	commitErr := errors.New("injected commit acknowledgement failure")
	store := New(t.TempDir())
	if _, _, err := store.UpdateApproval(ctx, bytesInitializer("catalog"), bytesInitializer("prior"), identityChange); err != nil {
		t.Fatal(err)
	}
	if got, revision, err := store.resolveApprovalCommit(ctx, []byte("prior"), 1, nil, 0, false, commitErr); err != nil || revision != 1 || string(got) != "prior" {
		t.Fatalf("approval intended readback = %q, %d, %v", got, revision, err)
	}
	if _, _, err := store.resolveApprovalCommit(ctx, []byte("intended"), 2, []byte("prior"), 1, true, commitErr); err == nil || publicationWasUncertain(err) {
		t.Fatalf("approval prior readback = %v", err)
	}
	if _, _, err := store.UpdateApproval(ctx, nil, nil, func([]byte) ([]byte, error) { return []byte("intervening"), nil }); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.resolveApprovalCommit(ctx, []byte("intended"), 2, []byte("prior"), 1, true, commitErr); err == nil || !publicationWasUncertain(err) {
		t.Fatalf("approval intervening readback = %v", err)
	}

	if _, err := store.CompareAndSwapInstallTransaction(ctx, bytesInitializer("catalog"), "tx", 0, []byte("prior")); err != nil {
		t.Fatal(err)
	}
	if revision, err := store.resolveTransactionCommit(ctx, "tx", []byte("prior"), 1, nil, 0, false, commitErr); err != nil || revision != 1 {
		t.Fatalf("transaction intended readback = %d, %v", revision, err)
	}
	if _, err := store.resolveTransactionCommit(ctx, "tx", []byte("intended"), 2, []byte("prior"), 1, true, commitErr); err == nil || publicationWasUncertain(err) {
		t.Fatalf("transaction prior readback = %v", err)
	}
	if _, err := store.CompareAndSwapInstallTransaction(ctx, nil, "tx", 1, []byte("intervening")); err != nil {
		t.Fatal(err)
	}
	if _, err := store.resolveTransactionCommit(ctx, "tx", []byte("intended"), 2, []byte("prior"), 1, true, commitErr); err == nil || !publicationWasUncertain(err) {
		t.Fatalf("transaction intervening readback = %v", err)
	}
}

func TestConcurrentApprovalWritersSerializeOverCommittedState(t *testing.T) {
	ctx := context.Background()
	store := New(t.TempDir())
	entered := make(chan struct{})
	release := make(chan struct{})
	firstDone := make(chan error, 1)
	go func() {
		_, revision, err := store.UpdateApproval(ctx, bytesInitializer("catalog"), bytesInitializer("base"), func(current []byte) ([]byte, error) {
			if string(current) != "base" {
				return nil, errors.New("first writer did not receive initializer")
			}
			close(entered)
			<-release
			return []byte("first"), nil
		})
		if err == nil && revision != 1 {
			err = errors.New("first approval revision was not one")
		}
		firstDone <- err
	}()
	<-entered
	secondDone := make(chan error, 1)
	go func() {
		_, revision, err := store.UpdateApproval(ctx, bytesInitializer("wrong"), bytesInitializer("wrong"), func(current []byte) ([]byte, error) {
			if string(current) != "first" {
				return nil, errors.New("second writer did not observe first committed state")
			}
			return []byte("second"), nil
		})
		if err == nil && revision != 2 {
			err = errors.New("second approval revision was not two")
		}
		secondDone <- err
	}()
	close(release)
	if err := <-firstDone; err != nil {
		t.Fatal(err)
	}
	if err := <-secondDone; err != nil {
		t.Fatal(err)
	}
	payload, revision, present, err := store.LoadApproval(ctx)
	if err != nil || !present || revision != 2 || string(payload) != "second" {
		t.Fatalf("final approval = %q, %d, %v, %v", payload, revision, present, err)
	}
}

func publicationWasUncertain(err error) bool {
	var uncertain interface{ PublicationUncertain() bool }
	return errors.As(err, &uncertain) && uncertain.PublicationUncertain()
}

func bytesInitializer(value string) Initializer {
	return func() ([]byte, error) { return []byte(value), nil }
}

func identityChange(current []byte) ([]byte, error) { return current, nil }
