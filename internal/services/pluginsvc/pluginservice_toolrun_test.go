package pluginsvc

import (
	"strings"
	"testing"
)

// The catalog and the two execution paths behind a declared tool
// (goal 0324). The run policy is the consent: a plugin the user turned
// off is still LISTED (so an agent can tell "off" from "absent") but
// contributes no callable tool, no kind and no step.

const toolPluginManifest = `{"id":"tc","name":"Text case","version":"1.0.0","contributes":{
	"canvasObjects":[{"kind":"shout"}],
	"steps":[{"id":"shout","label":"Shout","config":[{"key":"suffix","label":"Suffix","type":"text","default":"!"}]}],
	"commands":[{"id":"refresh","label":"Refresh"}],
	"tools":[
		{"name":"shout_text","description":"Upper-cases text.","inputSchema":{"type":"object","properties":{"text":{"type":"string"},"suffix":{"type":"string"}}},"effect":"read","run":{"kind":"step","stepId":"shout"}},
		{"name":"refresh_faces","description":"Draws every face again.","inputSchema":{"type":"object","properties":{}},"effect":"read","run":{"kind":"command","commandId":"refresh"}}
	]}}`

func newToolPlugin(t *testing.T) *PluginService {
	t.Helper()
	root := t.TempDir()
	writePlugin(t, root, "tc", toolPluginManifest, map[string]string{"steps.js": textcaseSteps})
	return New(root, nil, "")
}

// summaryOf picks one plugin out of a listing that always also carries
// the built-ins compiled into the binary.
func summaryOf(t *testing.T, summaries []PluginSummary, id string) PluginSummary {
	t.Helper()
	for _, s := range summaries {
		if s.ID == id {
			return s
		}
	}
	t.Fatalf("no summary for %q in %+v", id, summaries)
	return PluginSummary{}
}

func TestPluginSummaries_ReportEveryContributionAndEnablement(t *testing.T) {
	p := newToolPlugin(t)
	s := summaryOf(t, p.PluginSummaries(), "tc")
	if !s.Enabled || s.ID != "tc" || s.Name != "Text case" {
		t.Fatalf("summary = %+v", s)
	}
	if len(s.Tools) != 2 || s.Tools[0] != "shout_text" || len(s.Commands) != 1 || len(s.Steps) != 1 || len(s.CanvasObjects) != 1 {
		t.Fatalf("contributions = %+v", s)
	}

	p.SetRunPolicy(func(string, bool) bool { return false })
	off := summaryOf(t, p.PluginSummaries(), "tc")
	if off.Enabled {
		t.Fatalf("a plugin that may not run must still be listed, with enabled false: %+v", off)
	}
	if len(off.Tools) != 2 {
		t.Errorf("a turned-off plugin still DECLARES its tools: %+v", off.Tools)
	}
}

func TestDeclaredToolsAndKinds_FollowTheRunPolicy(t *testing.T) {
	p := newToolPlugin(t)
	if got := toolsOf(p, "tc"); len(got) != 2 || got[0] != "refresh_faces" || got[1] != "shout_text" {
		t.Fatalf("DeclaredTools for tc = %+v", got)
	}
	if got := kindsOf(p, "tc"); len(got) != 1 || got[0] != "shout" {
		t.Fatalf("ContributedKinds for tc = %+v", got)
	}
	var stepIDs []string
	for _, st := range p.StepNodeTypesByPlugin() {
		if st.PluginID == "tc" {
			stepIDs = append(stepIDs, st.NodeType.ID)
		}
	}
	if len(stepIDs) != 1 || stepIDs[0] != "process-tc-shout" {
		t.Fatalf("StepNodeTypesByPlugin for tc = %+v", stepIDs)
	}

	p.SetRunPolicy(func(string, bool) bool { return false })
	if got := toolsOf(p, "tc"); len(got) != 0 {
		t.Errorf("a plugin that may not run contributed %d tools", len(got))
	}
	if got := kindsOf(p, "tc"); len(got) != 0 {
		t.Errorf("a plugin that may not run contributed %d kinds", len(got))
	}
}

func TestRunToolStep_RunsThePluginsOwnStep(t *testing.T) {
	p := newToolPlugin(t)
	out, err := p.RunToolStep("tc", "shout", "hello", map[string]string{"suffix": "?"})
	if err != nil || out != "HELLO?" {
		t.Fatalf("RunToolStep = %q err=%v, want HELLO?", out, err)
	}

	p.SetRunPolicy(func(string, bool) bool { return false })
	if _, err := p.RunToolStep("tc", "shout", "hello", nil); err == nil || !strings.Contains(err.Error(), "not available") {
		t.Fatalf("a turned-off plugin's step must refuse, got %v", err)
	}
}

func TestRunToolCommand_RequiresADeclaredCommandAndAListeningPage(t *testing.T) {
	p := newToolPlugin(t)
	var asked []string
	p.runCommand = func(pluginID, commandID string) (string, error) {
		asked = append(asked, pluginID+"/"+commandID)
		return "ran " + commandID, nil
	}
	out, err := p.RunToolCommand("tc", "refresh")
	if err != nil || out != "ran refresh" {
		t.Fatalf("RunToolCommand = %q err=%v", out, err)
	}
	if len(asked) != 1 || asked[0] != "tc/refresh" {
		t.Fatalf("bridge calls = %+v", asked)
	}

	if _, err := p.RunToolCommand("tc", "vanish"); err == nil || !strings.Contains(err.Error(), "does not declare the command") {
		t.Fatalf("an undeclared command must refuse, got %v", err)
	}

	p.runCommand = nil
	if _, err := p.RunToolCommand("tc", "refresh"); err == nil || !strings.Contains(err.Error(), "the app did not answer") {
		t.Fatalf("with no page listening the call must say so, got %v", err)
	}
}

func toolsOf(p *PluginService, id string) []string {
	var out []string
	for _, d := range p.DeclaredTools() {
		if d.PluginID == id {
			out = append(out, d.Tool.Name)
		}
	}
	return out
}

func kindsOf(p *PluginService, id string) []string {
	var out []string
	for _, k := range p.ContributedKinds() {
		if k.PluginID == id {
			out = append(out, k.Kind)
		}
	}
	return out
}
