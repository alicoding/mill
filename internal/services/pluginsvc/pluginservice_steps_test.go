package pluginsvc

import (
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/composition"
)

const textcaseManifest = `{"id":"tc","name":"Text case","version":"1.0.0","contributes":{"steps":[{"id":"shout","label":"Shout","description":"Upper-cases.","config":[{"key":"suffix","label":"Suffix","type":"text","default":"!"}]}]}}`
const textcaseSteps = `registerStep('shout', { perform: function (i) { return { payload: i.payload.toUpperCase() + i.config.suffix, attributes: { shouted: true } } } })`

// A plugin's declared steps become process node types with the
// declared config, run through steps.js, and obey the run policy.
func TestStepNodeTypes_SynthesizeRunAndObeyPolicy(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "tc", textcaseManifest, map[string]string{"steps.js": textcaseSteps})
	p := New(root, nil, "")
	types := p.StepNodeTypes()
	if len(types) != 1 {
		t.Fatalf("StepNodeTypes = %d types, want 1", len(types))
	}
	nt := types[0].NodeType
	if nt.ID != "process-tc-shout" || nt.Kind != composition.KindProcess || nt.Label != "Shout" || nt.PaletteGroup != "transform" || nt.Complexity != composition.ComplexityBasic {
		t.Fatalf("node type = %+v", nt)
	}
	if len(nt.ConfigFields) != 1 || nt.ConfigFields[0].Key != "suffix" || nt.ConfigFields[0].Default != "!" {
		t.Fatalf("config fields = %+v", nt.ConfigFields)
	}
	if !strings.Contains(nt.Description, "Text case plugin") {
		t.Fatalf("description = %q, want the plugin named", nt.Description)
	}
	out, err := types[0].Exec(composition.Node{ID: "n", NodeTypeID: nt.ID, Config: map[string]string{"suffix": "?"}}, composition.ExecContext{Payload: "hi", Attributes: map[string]any{"count": 1.0}})
	if err != nil || out.Payload != "HI?" || out.Attributes["shouted"] != true || out.Attributes["count"] != 1.0 {
		t.Fatalf("exec = %+v err=%v", out, err)
	}
	if problem := p.StepPackProblem("tc"); problem != "" {
		t.Fatalf("StepPackProblem = %q, want none", problem)
	}

	p.SetRunPolicy(func(id string, builtin bool) bool { return false })
	if got := p.StepNodeTypes(); len(got) != 0 {
		t.Fatalf("a plugin that may not run contributed %d steps", len(got))
	}
}

// Declaring steps without steps.js, or steps.js disagreeing with the
// manifest, is a stated problem -- never a silently empty catalog.
func TestSteps_ProblemsAreStated(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "nofile", `{"id":"nofile","name":"N","version":"1","contributes":{"steps":[{"id":"a","label":"A"}]}}`, nil)
	writePlugin(t, root, "mismatch", `{"id":"mismatch","name":"M","version":"1","contributes":{"steps":[{"id":"a","label":"A"}]}}`, map[string]string{"steps.js": `registerStep('b', { perform: function () { return '' } })`})
	writePlugin(t, root, "badtype", `{"id":"badtype","name":"B","version":"1","contributes":{"steps":[{"id":"a","label":"A","config":[{"key":"k","label":"K","type":"number"}]}]}}`, map[string]string{"steps.js": `registerStep('a', { perform: function () { return '' } })`})
	p := New(root, nil, "")
	infos, err := p.ListPlugins()
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]PluginInfo{}
	for _, i := range infos {
		byID[i.Manifest.ID] = i
	}
	if !strings.Contains(byID["nofile"].Error, "steps.js is missing") {
		t.Fatalf("nofile error = %q", byID["nofile"].Error)
	}
	if !strings.Contains(byID["badtype"].Error, `type "number"`) {
		t.Fatalf("badtype error = %q", byID["badtype"].Error)
	}
	if byID["mismatch"].Error != "" {
		t.Fatalf("mismatch is a conformance problem, not a load error: %q", byID["mismatch"].Error)
	}
	if got := p.StepPackProblem("mismatch"); !strings.Contains(got, `does not register the declared step "a"`) {
		t.Fatalf("StepPackProblem(mismatch) = %q", got)
	}
	problems := ConformDir(root+"/mismatch", "")
	joined := strings.Join(problems, "\n")
	if !strings.Contains(joined, `registers "b"`) || !strings.Contains(joined, `declares step "a"`) {
		t.Fatalf("ConformDir(mismatch) = %v", problems)
	}
}
