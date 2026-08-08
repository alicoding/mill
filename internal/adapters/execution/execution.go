package execution

import (
	"context"
	"fmt"
	"time"

	"github.com/dbos-inc/dbos-transact-golang/dbos"
	_ "github.com/dbos-inc/dbos-transact-golang/dbos/driver/sqlite"
)

// New builds a DBOS runtime backed by a local SQLite file at dbPath --
// no Postgres, no separate daemon, satisfying docs/SPEC.md §1.2's
// embeddable-in-binary hard filter (research + spike in docs/adr/0004).
// register runs before Launch: DBOS resolves a workflow by registered
// function identity for crash recovery, so registration must happen
// before the runtime starts accepting/recovering runs -- this is the
// caller's one chance to call RegisterWorkflow.
//
// CLAUDE.md's no-phone-home rule: Conductor is the only
// outbound-network-capable code path in the SDK (docs/adr/0004's spike,
// finding #5) and only activates if ConductorAPIKey/DBOS__CLOUD is
// set -- Config below never sets either, which is the whole guard; DBOS
// itself exposes no separate flag to assert this at runtime.
func New(appName, dbPath string, register func(Context)) (Context, error) {
	ctx, err := dbos.NewContext(context.Background(), dbos.Config{
		AppName:     appName,
		DatabaseURL: "sqlite:" + dbPath,
	})
	if err != nil {
		return nil, fmt.Errorf("execution: new context: %w", err)
	}

	register(ctx)

	if err := dbos.Launch(ctx); err != nil {
		return nil, fmt.Errorf("execution: launch: %w", err)
	}
	return ctx, nil
}

// Shutdown stops the runtime, waiting up to timeout for in-flight work.
func Shutdown(ctx Context, timeout time.Duration) error {
	return dbos.Shutdown(ctx, timeout)
}
