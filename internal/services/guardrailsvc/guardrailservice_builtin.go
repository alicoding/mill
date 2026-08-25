package guardrailsvc

import (
	"log/slog"
	"time"

	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/services/entitystore"
	"github.com/alicoding/mill/internal/services/seeding"
)

// guardrailRuleDescriptor is Rule's entitystore.Descriptor (goal 0165's
// pattern, goal 0203 S2's own first user of it for guardrail rules):
// the small per-kind shape Reconcile/DeleteWithTombstone key off,
// mirroring every Configure entity's own *Descriptor (e.g.
// configuremcpserver.go's mcpServerDescriptor). StampNew is a no-op
// (Rule carries no CreatedAt/UpdatedAt to stamp, unlike a Configure
// entity); Upgrade replaces existing's content with golden's, same
// "preserve identity, stamp a fresh Seed" shape every other Upgrade
// function already uses.
var guardrailRuleDescriptor = entitystore.Descriptor[guardrail.Rule]{
	Label:     "guardrail rule",
	GetID:     func(r guardrail.Rule) string { return r.ID },
	IsBuiltIn: func(r guardrail.Rule) bool { return r.BuiltIn },
	GetSeed:   func(r guardrail.Rule) seedorigin.Origin { return r.Seed },
	SetSeed:   func(r guardrail.Rule, o seedorigin.Origin) guardrail.Rule { r.Seed = o; return r },
	StampNew:  func(golden guardrail.Rule, _ time.Time) guardrail.Rule { return golden },
	Upgrade: func(_, golden guardrail.Rule, _ time.Time) guardrail.Rule {
		golden.Seed = seedorigin.Stamp(golden.Seed.SeedRevision)
		return golden
	},
	BuiltIn: guardrail.BuiltIn,
}

// reconcileBuiltInRules mirrors reconcileBuiltInMCPServers/
// reconcileBuiltInExecEnvs (configureservice_builtin.go): insert/
// upgrade/leave-alone/skip per golden (docs/goals/0037), never
// insert-only -- the seeded "Uses a stored secret" rule (goal 0203 S2)
// reaches an existing install on upgrade, not just a fresh one
// (.claude/rules/testing.md).
func (g *GuardrailService) reconcileBuiltInRules() {
	tombstones := seeding.LoadTombstones(g.store)
	if _, changed := entitystore.Reconcile(&g.mu, &g.rules, tombstones, guardrailRuleDescriptor); changed {
		if err := g.persist(); err != nil {
			slog.Error("failed to reconcile built-in guardrail rules", "error", err)
		}
	}
}
