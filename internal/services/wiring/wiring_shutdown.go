package wiring

import (
	"context"
	"log/slog"

	"github.com/alicoding/mill/internal/services/backupsvc"
	"github.com/alicoding/mill/internal/services/mcpsvc"
	"github.com/alicoding/mill/internal/services/pluginsvc"
)

func shutdownSnapshotServices(logger *slog.Logger, backupService *backupsvc.BackupService, millMCPService *mcpsvc.MillMCPService, pluginService *pluginsvc.PluginService) {
	// docs/goals/0065 item 4: one last snapshot on a clean shutdown,
	// skipped if a recent one already ran.
	if err := backupService.BackupOnCleanShutdown(); err != nil {
		logger.Error("clean-shutdown backup", "error", err)
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := millMCPService.Shutdown(shutdownCtx); err != nil {
		logger.Error("mill MCP server shutdown", "error", err)
	}
	if err := pluginService.CloseState(); err != nil {
		logger.Error("extension source state shutdown", "error", err)
	}
	if err := pluginService.CloseAudit(); err != nil {
		logger.Error("plugin audit service shutdown", "error", err)
	}
}
