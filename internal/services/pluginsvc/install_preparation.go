package pluginsvc

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"time"

	"github.com/alicoding/mill/internal/domain/usererror"
)

const (
	maxInstallPreparations = 8
	installReservationTTL  = 60 * time.Second
	preparedInstallTTL     = 15 * time.Minute
)

type InstallReservation struct {
	Handle    string
	ExpiresAt string
}

type InstallCandidate struct {
	Kind        string
	Marketplace string
	Incarnation string
	ID          string
	Version     string
	Locator     string
	Encoded     string
	Basename    string
	DisplayName string
	Family      string
}

type PreparedInstall struct {
	Handle         string
	ExpiresAt      string
	Preview        InstallPreview
	RequiresReview bool
}

type InstallCommitResult struct {
	Record             InstallRecord
	PluginID           string
	NeedsAllow         bool
	CatalogWarningCode string
	RecoveryRequired   bool
}

type preparationPhase uint8

const (
	preparationReserved preparationPhase = iota
	preparationPreparing
	preparationReady
	preparationCommitting
	preparationCancelled
)

type installPreparation struct {
	handle    string
	phase     preparationPhase
	expiresAt time.Time
	ctx       context.Context
	cancel    context.CancelFunc
	timer     *time.Timer
	prepared  preparedArtifact
}

type preparedArtifact struct {
	candidate                 InstallCandidate
	stage                     string
	root                      string
	preview                   InstallPreview
	record                    InstallRecord
	expectedSource            *MarketplaceSource
	artifactIdentity          string
	installedPresent          bool
	installedArtifactIdentity string
	requiresReview            bool
	update                    bool
}

func (p *PluginService) ReserveInstallPreparation() (InstallReservation, error) {
	now := time.Now().UTC()
	handle, err := randomInstallID()
	if err != nil {
		return InstallReservation{}, err
	}
	p.preparationsMu.Lock()
	defer p.preparationsMu.Unlock()
	p.prunePreparationFailuresLocked(now)
	if p.preparationsClosed {
		return InstallReservation{}, preparationInvalidError()
	}
	if len(p.preparations) >= maxInstallPreparations {
		return InstallReservation{}, usererror.New("install-preparation-limit", "Too many extension previews are open. Close one and try again.")
	}
	ctx, cancel := context.WithCancel(context.Background())
	prep := &installPreparation{handle: handle, phase: preparationReserved, expiresAt: now.Add(installReservationTTL), ctx: ctx, cancel: cancel}
	prep.timer = time.AfterFunc(installReservationTTL, func() { p.expirePreparation(handle, prep) })
	p.preparations[handle] = prep
	return InstallReservation{Handle: handle, ExpiresAt: prep.expiresAt.Format(time.RFC3339)}, nil
}

func (p *PluginService) PrepareInstall(handle string, candidate InstallCandidate) (PreparedInstall, error) {
	p.preparationsMu.Lock()
	prep := p.preparations[handle]
	if prep == nil || p.preparationsClosed {
		failure := p.preparationFailures[handle]
		p.preparationsMu.Unlock()
		if failure == "expired" {
			return PreparedInstall{}, preparationExpiredError()
		}
		return PreparedInstall{}, preparationInvalidError()
	}
	if !time.Now().Before(prep.expiresAt) {
		delete(p.preparations, handle)
		p.preparationFailures[handle] = "expired"
		prep.phase = preparationCancelled
		prep.cancel()
		if prep.timer != nil {
			prep.timer.Stop()
		}
		p.preparationsMu.Unlock()
		cleanupPreparedArtifact(prep.prepared)
		return PreparedInstall{}, preparationExpiredError()
	}
	if prep.phase != preparationReserved {
		phase := prep.phase
		p.preparationsMu.Unlock()
		if phase == preparationCancelled {
			return PreparedInstall{}, preparationCancelledError()
		}
		return PreparedInstall{}, preparationInvalidError()
	}
	prep.timer.Stop()
	prep.phase = preparationPreparing
	p.preparationWG.Add(1)
	p.preparationsMu.Unlock()

	artifact, err := p.prepareCandidate(prep.ctx, candidate)
	p.preparationsMu.Lock()
	if err != nil || p.preparationsClosed || prep.phase != preparationPreparing {
		cancelled := errors.Is(prep.ctx.Err(), context.Canceled) || prep.phase == preparationCancelled || p.preparationsClosed
		delete(p.preparations, handle)
		prep.phase = preparationCancelled
		prep.cancel()
		p.preparationsMu.Unlock()
		cleanupPreparedArtifact(artifact)
		p.preparationWG.Done()
		if cancelled {
			return PreparedInstall{}, preparationCancelledError()
		}
		return PreparedInstall{}, err
	}
	prep.prepared = artifact
	prep.phase = preparationReady
	prep.expiresAt = time.Now().UTC().Add(preparedInstallTTL)
	prep.timer = time.AfterFunc(preparedInstallTTL, func() { p.expirePreparation(handle, prep) })
	result := PreparedInstall{
		Handle: handle, ExpiresAt: prep.expiresAt.Format(time.RFC3339), Preview: artifact.preview,
		RequiresReview: artifact.requiresReview,
	}
	p.preparationsMu.Unlock()
	p.preparationWG.Done()
	return result, nil
}

func (p *PluginService) ConfirmInstall(handle string) (InstallCommitResult, error) {
	p.preparationsMu.Lock()
	prep := p.preparations[handle]
	if prep == nil || p.preparationsClosed {
		failure := p.preparationFailures[handle]
		p.preparationsMu.Unlock()
		if failure == "expired" {
			return InstallCommitResult{}, preparationExpiredError()
		}
		return InstallCommitResult{}, preparationInvalidError()
	}
	if !time.Now().Before(prep.expiresAt) {
		delete(p.preparations, handle)
		p.preparationFailures[handle] = "expired"
		prep.phase = preparationCancelled
		prep.cancel()
		if prep.timer != nil {
			prep.timer.Stop()
		}
		p.preparationsMu.Unlock()
		cleanupPreparedArtifact(prep.prepared)
		return InstallCommitResult{}, preparationExpiredError()
	}
	switch prep.phase {
	case preparationReserved, preparationPreparing:
		p.preparationsMu.Unlock()
		return InstallCommitResult{}, usererror.New("install-preparation-not-ready", "This extension is still being prepared.")
	case preparationCommitting:
		p.preparationsMu.Unlock()
		return InstallCommitResult{}, alreadyConfirmingError()
	case preparationReady:
		prep.timer.Stop()
		prep.phase = preparationCommitting
		p.preparationWG.Add(1)
	default:
		p.preparationsMu.Unlock()
		return InstallCommitResult{}, preparationInvalidError()
	}
	artifact := prep.prepared
	p.preparationsMu.Unlock()

	result, err := p.commitPreparedArtifact(artifact)
	p.preparationsMu.Lock()
	delete(p.preparations, handle)
	prep.phase = preparationCancelled
	prep.cancel()
	p.preparationsMu.Unlock()
	cleanupPreparedArtifact(artifact)
	p.preparationWG.Done()
	return result, err
}

func (p *PluginService) CancelInstallPreparation(handle string) error {
	var artifact preparedArtifact
	p.preparationsMu.Lock()
	prep := p.preparations[handle]
	if prep == nil {
		delete(p.preparationFailures, handle)
		p.preparationsMu.Unlock()
		return nil
	}
	if prep.phase == preparationCommitting {
		p.preparationsMu.Unlock()
		return alreadyConfirmingError()
	}
	originalPhase := prep.phase
	prep.phase = preparationCancelled
	prep.cancel()
	if prep.timer != nil {
		prep.timer.Stop()
	}
	if prep.prepared.stage != "" {
		artifact = prep.prepared
	}
	if originalPhase == preparationReserved || originalPhase == preparationReady {
		delete(p.preparations, handle)
	}
	p.preparationsMu.Unlock()
	if originalPhase == preparationReady {
		cleanupPreparedArtifact(artifact)
	}
	return nil
}

func ClosePreparations(p *PluginService) error {
	var cleanup []preparedArtifact
	p.preparationsMu.Lock()
	p.preparationsClosed = true
	p.preparationFailures = make(map[string]string)
	for handle, prep := range p.preparations {
		if prep.phase == preparationCommitting {
			continue
		}
		originalPhase := prep.phase
		prep.phase = preparationCancelled
		prep.cancel()
		if prep.timer != nil {
			prep.timer.Stop()
		}
		if prep.prepared.stage != "" {
			cleanup = append(cleanup, prep.prepared)
		}
		if originalPhase == preparationReserved || originalPhase == preparationReady {
			delete(p.preparations, handle)
		}
	}
	p.preparationsMu.Unlock()
	for _, artifact := range cleanup {
		cleanupPreparedArtifact(artifact)
	}
	p.preparationWG.Wait()
	return nil
}

func (p *PluginService) expirePreparation(handle string, expected *installPreparation) {
	var artifact preparedArtifact
	p.preparationsMu.Lock()
	prep := p.preparations[handle]
	if prep != expected || (prep.phase != preparationReserved && prep.phase != preparationReady) || time.Now().Before(prep.expiresAt) {
		p.preparationsMu.Unlock()
		return
	}
	delete(p.preparations, handle)
	p.preparationFailures[handle] = "expired"
	prep.phase = preparationCancelled
	prep.cancel()
	artifact = prep.prepared
	p.preparationsMu.Unlock()
	cleanupPreparedArtifact(artifact)
}

func (p *PluginService) prunePreparationFailuresLocked(_ time.Time) {
	if len(p.preparationFailures) <= maxInstallPreparations*4 {
		return
	}
	// Failure tombstones exist only to preserve a precise expired response.
	// Once bounded, old opaque handles may safely collapse to invalid.
	p.preparationFailures = make(map[string]string)
}

func cleanupPreparedArtifact(artifact preparedArtifact) {
	if artifact.stage != "" {
		_ = os.RemoveAll(artifact.stage)
	}
}

func randomInstallID() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw[:]), nil
}

func preparationInvalidError() error {
	return usererror.New("install-preparation-invalid", "This extension preview is no longer available. Prepare it again to continue.")
}

func preparationExpiredError() error {
	return usererror.New("install-preparation-expired", "This preview has expired. Prepare the extension again to continue.")
}

func preparationCancelledError() error {
	return usererror.New("install-preparation-cancelled", "Extension preparation was cancelled.")
}

func alreadyConfirmingError() error {
	return usererror.New("install-already-confirming", "This extension is already being installed.")
}
