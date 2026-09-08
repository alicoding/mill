package pluginsvc

import (
	"strings"
	"testing"
)

// The manifest's VS Code recognisability contract (goal 0349 S2):
// configuration is canonical, settings is a working deprecated alias,
// declaring both refuses to load, and contributes.menus classifies
// onto Mill's own seats rather than blocking on an id it does not
// recognise.

func demoSetting() SettingContribution {
	return SettingContribution{Key: "a", Type: "string", Label: "Label", Default: "x"}
}

func TestListPlugins_ConfigurationSettingsAlias(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "uses-configuration", `{"id":"uses-configuration","name":"Uses configuration","version":"1.0.0","contributes":{"configuration":[{"key":"apiKey","type":"string","label":"API key","description":"d","default":"x"}]}}`, nil)
	writePlugin(t, root, "uses-settings", `{"id":"uses-settings","name":"Uses settings","version":"1.0.0","contributes":{"settings":[{"key":"apiKey","type":"string","label":"API key","description":"d","default":"x"}]}}`, nil)
	writePlugin(t, root, "uses-both", `{"id":"uses-both","name":"Uses both","version":"1.0.0","contributes":{"settings":[{"key":"apiKey","type":"string","label":"API key","description":"d","default":"x"}],"configuration":[{"key":"apiKey","type":"string","label":"API key","description":"d","default":"x"}]}}`, nil)

	svc := New(root, nil, "")
	infos, err := svc.ListPlugins()
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]PluginInfo{}
	for _, info := range infos {
		byID[info.Manifest.ID] = info
	}

	t.Run("configuration only loads clean", func(t *testing.T) {
		got := byID["uses-configuration"]
		if got.Error != "" {
			t.Fatalf("Error = %q, want none", got.Error)
		}
		if len(got.Warnings) != 0 {
			t.Fatalf("Warnings = %v, want none", got.Warnings)
		}
		if len(got.Manifest.Contributes.EffectiveSettings()) != 1 {
			t.Fatalf("EffectiveSettings = %v, want 1 entry", got.Manifest.Contributes.EffectiveSettings())
		}
	})

	t.Run("settings only loads with the alias warning", func(t *testing.T) {
		got := byID["uses-settings"]
		if got.Error != "" {
			t.Fatalf("Error = %q, want none", got.Error)
		}
		if len(got.Warnings) != 1 || !strings.Contains(got.Warnings[0], "Rename settings to configuration") {
			t.Fatalf("Warnings = %v, want the rename notice", got.Warnings)
		}
		if len(got.Manifest.Contributes.EffectiveSettings()) != 1 {
			t.Fatalf("EffectiveSettings = %v, want 1 entry", got.Manifest.Contributes.EffectiveSettings())
		}
	})

	t.Run("both keys present refuses to load", func(t *testing.T) {
		got := byID["uses-both"]
		if got.Error != "Use configuration or settings, not both" {
			t.Fatalf("Error = %q, want the both-keys refusal", got.Error)
		}
	})
}

func TestListPlugins_MenusLandInTheRightSeat(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "menu-demo", `{"id":"menu-demo","name":"Menu demo","version":"1.0.0","contributes":{"commands":[{"id":"menu-demo.run","label":"Run"}],"menus":{"editor/context":[{"command":"menu-demo.run"}],"some/unknown/id":[{"command":"menu-demo.run"}]}}}`, nil)

	svc := New(root, nil, "")
	infos, err := svc.ListPlugins()
	if err != nil {
		t.Fatal(err)
	}
	var info PluginInfo
	for _, i := range infos {
		if i.Manifest.ID == "menu-demo" {
			info = i
		}
	}
	if info.Error != "" {
		t.Fatalf("Error = %q, want none (an unrecognised menu id never blocks the load)", info.Error)
	}
	seated, unknown := ResolveMenus(info.Manifest.Contributes)
	if len(seated) != 1 || seated[0].Command != "menu-demo.run" || seated[0].Seat != MenuSeatCanvasContextMenu {
		t.Fatalf("ResolveMenus seated = %+v, want menu-demo.run on %q", seated, MenuSeatCanvasContextMenu)
	}
	if len(unknown) != 1 || unknown[0] != "some/unknown/id" {
		t.Fatalf("ResolveMenus unknown = %v, want [\"some/unknown/id\"]", unknown)
	}
	if len(info.Warnings) != 1 || !strings.Contains(info.Warnings[0], `"some/unknown/id"`) {
		t.Fatalf("Warnings = %v, want the unrecognised-menu notice naming it", info.Warnings)
	}
}

func TestValidateContributes_SettingsAliasAndMenus(t *testing.T) {
	tests := []struct {
		name       string
		contribute ManifestContributes
		want       string
	}{
		{
			name:       "configuration alone passes",
			contribute: ManifestContributes{Configuration: []SettingContribution{demoSetting()}},
		},
		{
			name:       "settings alone passes (the deprecated alias still loads)",
			contribute: ManifestContributes{Settings: []SettingContribution{demoSetting()}},
		},
		{
			name:       "declaring both is refused",
			contribute: ManifestContributes{Configuration: []SettingContribution{demoSetting()}, Settings: []SettingContribution{demoSetting()}},
			want:       "Use configuration or settings, not both",
		},
		{
			name:       "an empty configuration array with no settings key is not \"both\"",
			contribute: ManifestContributes{Configuration: []SettingContribution{}},
		},
		{
			name:       "a menu item with no command is refused",
			contribute: ManifestContributes{Menus: map[string][]MenuItemContribution{"editor/context": {{Command: ""}}}},
			want:       `contributed menu "editor/context" has an item with no command`,
		},
		{
			name:       "a menu id Mill has no seat for is a valid, inert manifest",
			contribute: ManifestContributes{Menus: map[string][]MenuItemContribution{"scm/title": {{Command: "demo.run"}}}},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := validateContributes("demo", nil, tc.contribute)
			if tc.want == "" {
				if got != "" {
					t.Fatalf("validateContributes = %q, want no problem", got)
				}
				return
			}
			if !strings.Contains(got, tc.want) {
				t.Fatalf("validateContributes = %q, want it to state %q", got, tc.want)
			}
		})
	}
}

func TestResolveMenus_KnownSeats(t *testing.T) {
	c := ManifestContributes{Menus: map[string][]MenuItemContribution{
		"commandPalette": {{Command: "demo.a"}},
		"editor/context": {{Command: "demo.b", When: "boardSelection", Group: "1_actions"}},
		"view/title":     {{Command: "demo.c"}},
	}}
	seated, unknown := ResolveMenus(c)
	if len(unknown) != 0 {
		t.Fatalf("unknown = %v, want none", unknown)
	}
	want := map[string]string{"demo.a": MenuSeatCommandPalette, "demo.b": MenuSeatCanvasContextMenu, "demo.c": MenuSeatViewTitle}
	if len(seated) != 3 {
		t.Fatalf("seated = %+v, want 3 entries", seated)
	}
	for _, s := range seated {
		if want[s.Command] != s.Seat {
			t.Fatalf("command %q seated on %q, want %q", s.Command, s.Seat, want[s.Command])
		}
	}
	for _, s := range seated {
		if s.Command == "demo.b" {
			if s.When != "boardSelection" || s.Group != "1_actions" {
				t.Fatalf("demo.b when/group = %q/%q, want boardSelection/1_actions", s.When, s.Group)
			}
		}
	}
}

func TestManifestContributes_SeatedCommandIDs_MergesWithoutDuplicates(t *testing.T) {
	c := ManifestContributes{
		Commands: []CommandContribution{{ID: "demo.run", Label: "Run", Menu: &CommandMenuContribution{Path: "workflow"}}},
		Menus:    map[string][]MenuItemContribution{"commandPalette": {{Command: "demo.run"}}, "editor/context": {{Command: "demo.other"}}},
	}
	ids := c.SeatedCommandIDs()
	if len(ids) != 2 {
		t.Fatalf("SeatedCommandIDs = %v, want 2 (demo.run counted once despite two seats)", ids)
	}
	seen := map[string]bool{}
	for _, id := range ids {
		seen[id] = true
	}
	if !seen["demo.run"] || !seen["demo.other"] {
		t.Fatalf("SeatedCommandIDs = %v, want demo.run and demo.other", ids)
	}
}
