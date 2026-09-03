package pluginsvc

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
)

// The files door (goal 0310, one of goal 0308's two recorded gaps): a
// plugin lists a folder on the user's disk through Mill, never with
// its own filesystem access. The read is evaluated as a READ-class
// action (allowed unless a rule says otherwise, audited like every
// action); a rule that asks parks it in Review like any other guarded
// action; nothing is ever read before the verdict. Hidden entries and
// dependency folders never appear.

// ListFilesKind is the guardrail action kind for a folder listing.
const ListFilesKind = "files.list"

// PluginFileEntry is one listed entry.
type PluginFileEntry struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	IsDir bool   `json:"isDir"`
	Size  int64  `json:"size"`
}

// PluginListDirResult carries the verdict and, when approved, the
// entries.
type PluginListDirResult struct {
	Approved  bool              `json:"approved"`
	Effect    string            `json:"effect"`
	RuleLabel string            `json:"ruleLabel"`
	Entries   []PluginFileEntry `json:"entries"`
}

// ListDirForPlugin lists dir for pluginID under the "list-files"
// capability.
func (p *PluginService) ListDirForPlugin(pluginID, dir string) (PluginListDirResult, error) {
	plugin := p.resolvePlugin(pluginID)
	if plugin.Error != "" {
		return PluginListDirResult{}, fmt.Errorf("plugin %q: %s", pluginID, plugin.Error)
	}
	if !hasCapability(plugin.Manifest, "list-files") {
		return PluginListDirResult{}, fmt.Errorf("plugin %q does not declare the \"list-files\" capability in its manifest", pluginID)
	}
	dir = strings.TrimSpace(dir)
	if !filepath.IsAbs(dir) {
		return PluginListDirResult{}, errors.New("list-files needs an absolute folder path")
	}
	if p.guardrail == nil {
		return PluginListDirResult{}, errors.New("guardrail unavailable: a plugin file listing is always evaluated")
	}
	attrs := map[string]string{"path": dir}
	verdict := p.guardrail.EvaluateAction(ListFilesKind, attrs, guardrail.ClassRead)
	out := PluginListDirResult{Approved: verdict.Effect == guardrail.EffectAllow, Effect: string(verdict.Effect), RuleLabel: verdict.RuleLabel, Entries: []PluginFileEntry{}}
	if verdict.Effect == guardrail.EffectAsk {
		decision, err := p.guardrail.RequestGuardedAction(context.Background(), guardrailsvc.GuardedAction{
			Kind: ListFilesKind, Attributes: attrs, Description: "List " + dir, Source: "plugin:" + pluginID,
		})
		if err != nil {
			return out, err
		}
		out.Approved, out.Effect, out.RuleLabel = decision.Approved, string(decision.Effect), decision.RuleLabel
	}
	if !out.Approved {
		return out, nil
	}
	entries, err := listDir(dir)
	if err != nil {
		return out, err
	}
	out.Entries = entries
	return out, nil
}

// listDir is the pure read: direct children, hidden and dependency
// entries skipped, folders first then names.
func listDir(dir string) ([]PluginFileEntry, error) {
	raw, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("list %s: %w", dir, err)
	}
	out := []PluginFileEntry{}
	for _, e := range raw {
		if strings.HasPrefix(e.Name(), ".") || e.Name() == "node_modules" {
			continue
		}
		info, ierr := e.Info()
		if ierr != nil {
			continue
		}
		out = append(out, PluginFileEntry{Name: e.Name(), Path: filepath.Join(dir, e.Name()), IsDir: e.IsDir(), Size: info.Size()})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].IsDir != out[j].IsDir {
			return out[i].IsDir
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}
