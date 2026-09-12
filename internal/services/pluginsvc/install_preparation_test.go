package pluginsvc

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/usererror"
)

func TestInstallPreparationCapacityRefusesWithoutEvictingVisibleHandles(t *testing.T) {
	service := New(t.TempDir(), nil, "")
	handles := make([]string, 0, maxInstallPreparations)
	for range maxInstallPreparations {
		reservation, err := service.ReserveInstallPreparation()
		if err != nil {
			t.Fatal(err)
		}
		handles = append(handles, reservation.Handle)
	}
	if _, err := service.ReserveInstallPreparation(); userErrorCode(err) != "install-preparation-limit" {
		t.Fatalf("ninth reservation error = %v", err)
	}
	service.preparationsMu.Lock()
	if len(service.preparations) != maxInstallPreparations {
		service.preparationsMu.Unlock()
		t.Fatalf("preparations = %d, want %d", len(service.preparations), maxInstallPreparations)
	}
	for _, handle := range handles {
		if service.preparations[handle] == nil {
			service.preparationsMu.Unlock()
			t.Fatalf("visible reservation %q was evicted", handle)
		}
	}
	service.preparationsMu.Unlock()
	for _, handle := range handles {
		if err := service.CancelInstallPreparation(handle); err != nil {
			t.Fatal(err)
		}
	}
}

func TestExpiredPreparedInstallCleansItsOwnedStage(t *testing.T) {
	service := New(t.TempDir(), nil, "")
	service.SetExampleMarketplace(exampleFS("mill-alpha"))
	reservation, err := service.ReserveInstallPreparation()
	if err != nil {
		t.Fatal(err)
	}
	prepared, err := service.PrepareInstall(reservation.Handle, bundledCandidate(t, service, "mill-alpha"))
	if err != nil {
		t.Fatal(err)
	}
	service.preparationsMu.Lock()
	owned := service.preparations[prepared.Handle]
	stage := owned.prepared.stage
	owned.expiresAt = time.Now().Add(-time.Second)
	service.preparationsMu.Unlock()
	if _, err := service.ConfirmInstall(prepared.Handle); userErrorCode(err) != "install-preparation-expired" {
		t.Fatalf("ConfirmInstall error = %v", err)
	}
	if _, err := os.Stat(stage); !os.IsNotExist(err) {
		t.Fatalf("expired preparation retained stage %q: %v", stage, err)
	}
}

func TestCancelDuringPreparationDiscardsLateResultAndStage(t *testing.T) {
	source := writeDirectPlugin(t, "late-source", "before")
	service := New(t.TempDir(), nil, "")
	stagesBefore := stageDirectories(t)
	started := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	service.sourceRead = func(string) {
		once.Do(func() { close(started) })
		<-release
	}
	reservation, err := service.ReserveInstallPreparation()
	if err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() {
		_, prepareErr := service.PrepareInstall(reservation.Handle, InstallCandidate{Kind: "link", Locator: source})
		result <- prepareErr
	}()
	<-started
	if err := service.CancelInstallPreparation(reservation.Handle); err != nil {
		t.Fatal(err)
	}
	close(release)
	if err := <-result; userErrorCode(err) != "install-preparation-cancelled" {
		t.Fatalf("PrepareInstall error = %v", err)
	}
	service.preparationsMu.Lock()
	_, retained := service.preparations[reservation.Handle]
	service.preparationsMu.Unlock()
	if retained {
		t.Fatal("late preparation registered a usable handle")
	}
	for entry := range stageDirectories(t) {
		if !stagesBefore[entry] {
			t.Fatalf("cancelled preparation retained %q", entry)
		}
	}
}

func TestConfirmUsesReviewedFolderBytesOnce(t *testing.T) {
	source := writeDirectPlugin(t, "reviewed-source", "reviewed bytes")
	destination := t.TempDir()
	service := New(destination, nil, "")
	reads := 0
	service.sourceRead = func(string) { reads++ }
	reservation, err := service.ReserveInstallPreparation()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.PrepareInstall(reservation.Handle, InstallCandidate{Kind: "link", Locator: source}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "main.js"), []byte("changed upstream"), 0o600); err != nil {
		t.Fatal(err)
	}
	result, err := service.ConfirmInstall(reservation.Handle)
	if err != nil {
		t.Fatal(err)
	}
	if result.PluginID != "reviewed-source" {
		t.Fatalf("PluginID = %q", result.PluginID)
	}
	installed, err := os.ReadFile(filepath.Join(destination, "reviewed-source", "main.js")) // #nosec G304 -- destination is a test-owned temporary plugin root
	if err != nil {
		t.Fatal(err)
	}
	if string(installed) != "reviewed bytes" {
		t.Fatalf("installed bytes = %q", installed)
	}
	if reads != 1 {
		t.Fatalf("source reads = %d, want one preparation acquisition", reads)
	}
	if _, err := service.ConfirmInstall(reservation.Handle); userErrorCode(err) != "install-preparation-invalid" {
		t.Fatalf("second ConfirmInstall error = %v", err)
	}
}

func TestClosePreparationsCancelsInFlightOwnerAndIsIdempotent(t *testing.T) {
	source := writeDirectPlugin(t, "closing-source", "before")
	service := New(t.TempDir(), nil, "")
	started := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	service.sourceRead = func(string) {
		once.Do(func() { close(started) })
		<-release
	}
	reservation, err := service.ReserveInstallPreparation()
	if err != nil {
		t.Fatal(err)
	}
	prepared := make(chan error, 1)
	go func() {
		_, prepareErr := service.PrepareInstall(reservation.Handle, InstallCandidate{Kind: "link", Locator: source})
		prepared <- prepareErr
	}()
	<-started
	closed := make(chan error, 1)
	go func() { closed <- ClosePreparations(service) }()
	deadline := time.Now().Add(time.Second)
	for {
		service.preparationsMu.Lock()
		closing := service.preparationsClosed
		service.preparationsMu.Unlock()
		if closing {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("ClosePreparations did not mark the service closed")
		}
		runtime.Gosched()
	}
	close(release)
	if err := <-prepared; userErrorCode(err) != "install-preparation-cancelled" {
		t.Fatalf("PrepareInstall error = %v", err)
	}
	if err := <-closed; err != nil {
		t.Fatal(err)
	}
	if err := ClosePreparations(service); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ReserveInstallPreparation(); userErrorCode(err) != "install-preparation-invalid" {
		t.Fatalf("reservation after close error = %v", err)
	}
}

func bundledCandidate(t *testing.T, service *PluginService, id string) InstallCandidate {
	t.Helper()
	resolved, err := service.resolveMarketplaceEntry(ReservedMarketplaceName, id)
	if err != nil {
		t.Fatal(err)
	}
	return InstallCandidate{Kind: "marketplace", Marketplace: ReservedMarketplaceName, Incarnation: resolved.Source.Incarnation, ID: id, Version: resolved.Entry.Version}
}

func writeDirectPlugin(t *testing.T, id, main string) string {
	t.Helper()
	root := t.TempDir()
	manifest := `{"id":"` + id + `","name":"Direct","version":"1.0.0"}`
	if err := os.WriteFile(filepath.Join(root, "manifest.json"), []byte(manifest), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "main.js"), []byte(main), 0o600); err != nil {
		t.Fatal(err)
	}
	return root
}

func userErrorCode(err error) string {
	var userErr *usererror.Error
	if errors.As(err, &userErr) {
		return userErr.Code
	}
	return ""
}

func stageDirectories(t *testing.T) map[string]bool {
	t.Helper()
	entries, err := filepath.Glob(filepath.Join(os.TempDir(), "mill-plugin-stage-*"))
	if err != nil {
		t.Fatal(err)
	}
	out := make(map[string]bool, len(entries))
	for _, entry := range entries {
		out[entry] = true
	}
	return out
}
