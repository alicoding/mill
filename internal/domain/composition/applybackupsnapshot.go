package composition

import (
	"fmt"
	"strconv"

	"github.com/alicoding/mill/internal/domain/guardrail"
)

// defaultBackupKeepN is the seeded "Backup Mill data" workflow's own
// default retention (docs/goals/0065) -- also the fallback applied
// when a workflow's keepN field is left empty.
const defaultBackupKeepN = 10

// runBackupSnapshotFn defaults to erroring so a run before main.go
// wires the real adapter (SetBackupRunner) fails loudly instead of
// silently no-op'ing -- same defaulting-to-error shape as every other
// lookup*Fn/run*Fn seam in this package (e.g. lookupExecEnvFn).
var runBackupSnapshotFn = func(keepN int) (string, error) {
	return "", fmt.Errorf("no backup runner registered (yet)")
}

// SetBackupRunner wires the function apply-backup-snapshot nodes use
// to actually take a snapshot -- called once from main.go against the
// real internal/adapters/backup.Snapshot primitive, the same
// late-bound-injection shape as SetCodeRunner/SetExecEnvLookup. Also
// the shutdown hook's own entry point (main.go calls the wired
// adapter directly, bypassing the node, since no trigger exists for
// process shutdown). The function takes keepN and returns the backup
// directory it wrote, or an error.
func SetBackupRunner(fn func(keepN int) (string, error)) {
	runBackupSnapshotFn = fn
}

func init() {
	RegisterNodeType(NodeType{
		ID: "apply-backup-snapshot", Kind: KindApply,
		Effect:      guardrail.ClassLocal,
		Complexity:  ComplexityBasic,
		Consumes:    []PayloadKind{PayloadAny},
		Produces:    PayloadProduce{Passthrough: true},
		Output:      "the payload it received, unchanged",
		Label:       "Back up Mill data",
		Description: "Takes a safe snapshot of your workflow history and settings, deleting older snapshots beyond how many you keep.",
		ConfigFields: []ConfigField{
			{
				Key: "keepN", Label: "Snapshots to keep", Type: FieldNumber,
				Description: "How many recent backups to keep -- older ones are deleted automatically.",
				Default:     strconv.Itoa(defaultBackupKeepN),
			},
		},
	}, execApplyBackupSnapshot)
}

func execApplyBackupSnapshot(node Node, ctx ExecContext) (ExecContext, error) {
	keepN := defaultBackupKeepN
	if raw := node.Config["keepN"]; raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			keepN = n
		}
	}
	if _, err := runBackupSnapshotFn(keepN); err != nil {
		return ctx, fmt.Errorf("apply-backup-snapshot: %w", err)
	}
	return ctx, nil
}
