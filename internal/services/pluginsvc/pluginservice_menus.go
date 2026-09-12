package pluginsvc

import (
	"fmt"
	"sort"
	"strings"
)

// The manifest's VS Code recognisability half (docs/goals/0349 S2,
// docs/goals/0386's tier-2 mapping): `configuration` is the canonical
// settings key with `settings` kept working as a deprecated alias, and
// `contributes.menus` (VS Code's menu-id -> command list) is accepted
// and classified onto Mill's own seats. Both are declare-time
// contract shape, not activate()-time behaviour, so they live beside
// pluginservice_contributes.go's other fail-closed validation.

// MenuItemContribution is one entry in a contributes.menus array: the
// command to seat, VS Code's `when` clause -- evaluated since
// docs/goals/0380 against facts the host computes about the
// right-clicked object and the selection -- and an optional group
// band.
type MenuItemContribution struct {
	Command string `json:"command"`
	When    string `json:"when"`
	Group   string `json:"group"`
}

// The three Mill seats a VS Code menu id may resolve onto. Every
// other value is accepted at load and named once in the plugin's
// status instead of blocking it (userdocs/reference/port-a-vscode-extension.md).
const (
	MenuSeatCommandPalette    = "commandPalette"
	MenuSeatCanvasContextMenu = "canvasContextMenu"
	MenuSeatViewTitle         = "viewTitle"
)

// menuSeatByVSCodeID is the ONE table a VS Code menu id maps through:
// commandPalette needs no seat of its own (every declared or
// registered command already lists there); editor/context is Mill's
// per-object canvas context menu (CanvasObjectDecl.menuItems);
// view/title is the work tab's title seat. Landing here is a
// classification only -- which slice picks each seat up at runtime is
// tracked by the porting guide, not decided by this table.
var menuSeatByVSCodeID = map[string]string{
	"commandPalette": MenuSeatCommandPalette,
	"editor/context": MenuSeatCanvasContextMenu,
	"view/title":     MenuSeatViewTitle,
}

// EffectiveSettings resolves the canonical/alias pair to the one list
// every non-validation consumer reads: Configuration when the key was
// present in the manifest JSON, Settings otherwise. validateContributes
// has already refused a manifest declaring both, so this never has to
// choose between conflicting lists.
func (c ManifestContributes) EffectiveSettings() []SettingContribution {
	if c.Configuration != nil {
		return c.Configuration
	}
	return c.Settings
}

// settingsAliasProblem is the load-blocking half: both keys present is
// an author mistake, never a silent pick.
func settingsAliasProblem(c ManifestContributes) string {
	if c.Configuration != nil && c.Settings != nil {
		return "Use configuration or settings, not both (standard rule 1)"
	}
	return ""
}

// settingsAliasWarning is the non-blocking half: the deprecated key
// loads, but says once that it will stop.
func settingsAliasWarning(c ManifestContributes) string {
	if c.Configuration == nil && c.Settings != nil {
		return "Rename settings to configuration; settings stops loading in a future version (standard rule 1)"
	}
	return ""
}

// validateMenus fail-closes contributes.menus the same shallow way
// every other contribution is checked: an item naming no command is a
// malformed manifest, never a silently-dropped entry. Which menu ids
// Mill recognises is not part of this check -- an unrecognised id is
// a valid, if inert, manifest (see ResolveMenus).
func validateMenus(menus map[string][]MenuItemContribution) string {
	ids := sortedMenuIDs(menus)
	for _, id := range ids {
		for _, item := range menus[id] {
			if strings.TrimSpace(item.Command) == "" {
				return fmt.Sprintf("contributed menu %q has an item with no command", id)
			}
		}
	}
	return ""
}

func sortedMenuIDs(menus map[string][]MenuItemContribution) []string {
	ids := make([]string, 0, len(menus))
	for id := range menus {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// MenuSeatContribution is one contributes.menus entry resolved onto a
// Mill seat.
type MenuSeatContribution struct {
	Command string
	Seat    string
	When    string
	Group   string
}

// ResolveMenus classifies a manifest's contributes.menus against
// menuSeatByVSCodeID: seated carries every entry whose VS Code menu id
// Mill recognises (in sorted-id order, for a deterministic report);
// unknownMenuIDs names every id it does not, also sorted, so the
// status note reads the same regardless of map iteration order.
func ResolveMenus(c ManifestContributes) (seated []MenuSeatContribution, unknownMenuIDs []string) {
	for _, id := range sortedMenuIDs(c.Menus) {
		seat, ok := menuSeatByVSCodeID[id]
		if !ok {
			unknownMenuIDs = append(unknownMenuIDs, id)
			continue
		}
		for _, item := range c.Menus[id] {
			seated = append(seated, MenuSeatContribution{Command: item.Command, Seat: seat, When: item.When, Group: item.Group})
		}
	}
	return seated, unknownMenuIDs
}

// SeatedCommandIDs is every command id carrying at least one menu
// seat, from EITHER Mill's own commands[].menu (the native menu bar,
// goal 0335) or a recognised contributes.menus entry (goal 0349 S2) --
// the two shapes merge here, deduplicated by command id, so a command
// declared both ways is never counted twice.
func (c ManifestContributes) SeatedCommandIDs() []string {
	seen := map[string]bool{}
	var ids []string
	add := func(id string) {
		if id == "" || seen[id] {
			return
		}
		seen[id] = true
		ids = append(ids, id)
	}
	for _, cmd := range c.Commands {
		if cmd.Menu != nil {
			add(cmd.ID)
		}
	}
	seated, _ := ResolveMenus(c)
	for _, s := range seated {
		add(s.Command)
	}
	return ids
}

// manifestWarnings collects every non-blocking manifest notice: the
// deprecated settings alias in use, and any contributes.menus id Mill
// has no seat for. Independent of Error -- a plugin that fails to
// load may still have something worth naming once it is fixed.
func manifestWarnings(m Manifest) []string {
	var warnings []string
	if w := settingsAliasWarning(m.Contributes); w != "" {
		warnings = append(warnings, w)
	}
	if _, unknown := ResolveMenus(m.Contributes); len(unknown) > 0 {
		warnings = append(warnings, unknownMenuWarning(unknown))
	}
	return warnings
}

func unknownMenuWarning(ids []string) string {
	quoted := make([]string, len(ids))
	for i, id := range ids {
		quoted[i] = fmt.Sprintf("%q", id)
	}
	if len(ids) == 1 {
		return fmt.Sprintf("Menu %s is not one Mill has a seat for, so it is ignored", quoted[0])
	}
	return fmt.Sprintf("Menus %s are not ones Mill has a seat for, so they are ignored", strings.Join(quoted, ", "))
}

// conformMenusWithoutWhen is standard rule 34 (docs/goals/0380
// Decision 4): a seated menu item with no `when` shows everywhere, and
// an author who meant that says so with `when: "true"` rather than
// leaving the next reader unable to tell an always-on item from a
// forgotten predicate. Advisory, never a load refusal -- an item
// without one still works exactly as it reads.
func conformMenusWithoutWhen(m Manifest) []string {
	var warnings []string
	for _, id := range sortedMenuIDs(m.Contributes.Menus) {
		if _, seated := menuSeatByVSCodeID[id]; !seated {
			continue
		}
		for _, item := range m.Contributes.Menus[id] {
			if strings.TrimSpace(item.When) != "" {
				continue
			}
			warnings = append(warnings, fmt.Sprintf("standard rule 34: menu %q item %q declares no when clause; say when: \"true\" if it should always show", id, item.Command))
		}
	}
	return warnings
}
