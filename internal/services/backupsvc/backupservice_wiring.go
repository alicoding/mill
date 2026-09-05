package backupsvc

import (
	"strings"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
)

// sqliteURLPrefix is the DSN scheme main.go's own executionDatabaseURL
// uses for a local sqlite file (internal/adapters/execution.New's own
// doc comment names it as the caller's config decision).
const sqliteURLPrefix = "sqlite:"

// SQLiteDBPath returns databaseURL's own filesystem path when it uses
// the "sqlite:" scheme, or "" for any other scheme (a BYO-Postgres
// DatabaseURL, docs/goals/0065 item 6) -- New's own dbPath argument is
// deliberately never a DSN, so main.go calls this once at construction
// rather than each caller re-deriving the scheme check.
func SQLiteDBPath(databaseURL string) string {
	if !strings.HasPrefix(databaseURL, sqliteURLPrefix) {
		return ""
	}
	return strings.TrimPrefix(databaseURL, sqliteURLPrefix)
}

// Wire constructs a BackupService and wires every cross-service seam
// main.go otherwise assembled inline (New, SetFamilies, SetAtlasBundle,
// WireCompositionRunner) -- extracted to keep main.go's own wiring
// terse (the same keep-main.go-under-its-line-count reasoning
// InitUpdater's own extraction already documents).
func Wire(dbPath, settingsPath, vaultPath, dir, millVersion string, comp *compositionsvc.CompositionService, cfg *configuresvc.ConfigureService, atlasSvc *atlassvc.AtlasService) *BackupService {
	b := New(dbPath, settingsPath, vaultPath, dir, millVersion)
	b.SetFamilies(BuildFamilies(comp, cfg))
	b.SetAtlasBundle(WireAtlasBundle(atlasSvc))
	WireCompositionRunner(b)
	return b
}

// WireCompositionRunner registers b's own snapshot primitive as the
// func apply-backup-snapshot nodes call (composition.SetBackupRunner)
// -- called once from main.go, after b exists.
func WireCompositionRunner(b *BackupService) {
	composition.SetBackupRunner(b.BackupRunner())
}

// BuildFamilies wires every ADR-0036 per-id entity family's
// export-everything bundle against comp/cfg's own already-public
// Export*/Import*/list-accessor methods, unmodified -- called once
// from main.go, after both services exist. A direct service-to-
// service import here (rather than composition's own late-bound
// injected-func-var seam, e.g. SetExecEnvLookup) mirrors mcpsvc's own
// established precedent (millmcpservice.go already imports both
// compositionsvc and configuresvc directly): backupsvc genuinely needs
// each family's full method set to build this bundle, not one narrow
// callback per family.
func BuildFamilies(comp *compositionsvc.CompositionService, cfg *configuresvc.ConfigureService) []FamilyBundle {
	return []FamilyBundle{
		{
			Name: "workflows",
			IDs: func() []string {
				workflows := comp.Workflows()
				ids := make([]string, len(workflows))
				for i, w := range workflows {
					ids[i] = w.ID
				}
				return ids
			},
			Export: comp.ExportWorkflow,
			Import: func(data string) (string, error) {
				wf, err := comp.ImportWorkflow(data)
				return wf.ID, err
			},
		},
		{
			Name: "requests",
			IDs: func() []string {
				requests := cfg.HTTPRequests()
				ids := make([]string, len(requests))
				for i, r := range requests {
					ids[i] = r.ID
				}
				return ids
			},
			Export: cfg.ExportHTTPRequest,
			Import: func(data string) (string, error) {
				r, err := cfg.ImportHTTPRequest(data)
				return r.ID, err
			},
		},
		{
			Name: "lists",
			IDs: func() []string {
				lists := cfg.Lists()
				ids := make([]string, len(lists))
				for i, l := range lists {
					ids[i] = l.ID
				}
				return ids
			},
			Export: cfg.ExportList,
			Import: func(data string) (string, error) {
				l, err := cfg.ImportList(data)
				return l.ID, err
			},
		},
		{
			Name: "mcpservers",
			IDs: func() []string {
				servers := cfg.MCPServers()
				ids := make([]string, len(servers))
				for i, s := range servers {
					ids[i] = s.ID
				}
				return ids
			},
			Export: cfg.ExportMCPServer,
			Import: func(data string) (string, error) {
				s, err := cfg.ImportMCPServer(data)
				return s.ID, err
			},
		},
		{
			Name: "decisions",
			IDs: func() []string {
				decisions := cfg.Decisions()
				ids := make([]string, len(decisions))
				for i, d := range decisions {
					ids[i] = d.ID
				}
				return ids
			},
			Export: cfg.ExportDecision,
			Import: func(data string) (string, error) {
				d, err := cfg.ImportDecision(data)
				return d.ID, err
			},
		},
		{
			Name: "aiproviders",
			IDs: func() []string {
				providers := cfg.AIProviders()
				ids := make([]string, len(providers))
				for i, p := range providers {
					ids[i] = p.ID
				}
				return ids
			},
			Export: cfg.ExportAIProvider,
			Import: func(data string) (string, error) {
				p, err := cfg.ImportAIProvider(data)
				return p.ID, err
			},
		},
	}
}

// WireAtlasBundle adapts AtlasService's own single-envelope export/
// import (atlasservice_export.go, ADR-0036's whole-graph shape) into
// the (export, apply) pair SetAtlasBundle expects -- summing Atlas's
// own per-sub-family created/updated counts into the one archive-level
// "atlas" row every other family's summary already uses.
func WireAtlasBundle(atlasSvc *atlassvc.AtlasService) (export func() (string, error), apply func(string) (created, updated int, err error)) {
	export = atlasSvc.ExportAtlas
	apply = func(data string) (int, int, error) {
		summary, err := atlasSvc.ImportAtlas(data)
		if err != nil {
			return 0, 0, err
		}
		created := summary.KindsCreated + summary.LinkKindsCreated + summary.CardsCreated + summary.LinksCreated
		updated := summary.KindsUpdated + summary.LinkKindsUpdated + summary.CardsUpdated + summary.LinksUpdated
		return created, updated, nil
	}
	return export, apply
}
