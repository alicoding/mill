package execution

import (
	"context"
	"fmt"
	"time"

	"github.com/dbos-inc/dbos-transact-golang/dbos"
	_ "github.com/dbos-inc/dbos-transact-golang/dbos/driver/sqlite"
)

// New builds a DBOS runtime backed by databaseURL -- a DBOS-native DSN
// string (dbos.Config's own DatabaseURL field). The default caller
// (main.go) passes a "sqlite:"-prefixed local file path, satisfying
// docs/SPEC.md §1.2's embeddable-in-binary hard filter with zero
// external dependency (research + spike in docs/adr/0004) -- but DBOS
// itself also accepts Postgres/CockroachDB DSNs (confirmed directly
// against dbos.Config's own doc comment), so a regulated deployment
// that needs an externally-managed audit database gets there by
// passing a different URL, not by swapping this adapter. The scheme
// choice deliberately isn't made in this package: it's the caller's
// config decision, same layering this repo already uses for every
// other adapter (.claude/rules/backend.md).
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
func New(appName, databaseURL string, register func(Context)) (Context, error) {
	ctx, err := dbos.NewContext(context.Background(), dbos.Config{
		AppName:     appName,
		DatabaseURL: databaseURL,
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
