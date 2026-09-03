package pluginsvc

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/adapters/jsengine"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// The "perform" step-pack door (ADR-0051 §5, goal 0305 slice 4b): a
// plugin DECLARES its steps in the manifest (id, label, config fields
// -- declare-first, so the Extensions row and the conformance suite
// see them without running code) and IMPLEMENTS them in steps.js, a
// script-mode file Mill loads into the embedded engine
// (internal/adapters/jsengine) inside the workflow executor. Each step
// becomes a composition.ExternalNodeType: a process step, text in /
// text out, pure (it reaches nothing -- the engine exposes no host
// function beyond registerStep), so its guardrail class is none.

// StepContribution is one declared step.
type StepContribution struct {
	ID          string                   `json:"id"`
	Label       string                   `json:"label"`
	Description string                   `json:"description"`
	Config      []StepConfigContribution `json:"config"`
}

// StepConfigContribution is one authored field of a declared step --
// text or a fixed option list, the two shapes a no-build plugin can
// state as data.
type StepConfigContribution struct {
	Key         string   `json:"key"`
	Label       string   `json:"label"`
	Description string   `json:"description"`
	Type        string   `json:"type"`
	Default     string   `json:"default"`
	Options     []string `json:"options"`
}

// StepNodeTypeID is the catalog id of a plugin's step: the process
// prefix every process step carries, then the plugin id, then the
// step id -- unique by construction (plugin ids are unique folders).
func StepNodeTypeID(pluginID, stepID string) string {
	return "process-" + pluginID + "-" + stepID
}

func validateSteps(steps []StepContribution) string {
	seen := map[string]bool{}
	for _, st := range steps {
		if !pluginIDPattern.MatchString(st.ID) {
			return fmt.Sprintf("contributed step id %q must be lowercase letters, digits, and hyphens", st.ID)
		}
		if seen[st.ID] {
			return fmt.Sprintf("contributed step %q is declared twice", st.ID)
		}
		seen[st.ID] = true
		if strings.TrimSpace(st.Label) == "" {
			return fmt.Sprintf("contributed step %q needs a label", st.ID)
		}
		if problem := validateStepConfig(st); problem != "" {
			return problem
		}
	}
	return ""
}

func validateStepConfig(st StepContribution) string {
	keys := map[string]bool{}
	for _, f := range st.Config {
		if strings.TrimSpace(f.Key) == "" || strings.TrimSpace(f.Label) == "" {
			return fmt.Sprintf("contributed step %q has a config field without a key and label", st.ID)
		}
		if keys[f.Key] {
			return fmt.Sprintf("contributed step %q declares config %q twice", st.ID, f.Key)
		}
		keys[f.Key] = true
		switch f.Type {
		case "", "text":
		case "options":
			if len(f.Options) == 0 {
				return fmt.Sprintf("contributed step %q config %q needs options", st.ID, f.Key)
			}
		default:
			return fmt.Sprintf("contributed step %q config %q has type %q; use \"text\" or \"options\"", st.ID, f.Key, f.Type)
		}
	}
	return ""
}

// stepsFileProblem checks that a plugin declaring steps ships steps.js.
func stepsFileProblem(dir string, m Manifest) string {
	if len(m.Contributes.Steps) == 0 {
		return ""
	}
	if _, err := os.Stat(filepath.Join(dir, "steps.js")); err != nil { // #nosec G703 -- dir is this service's own plugins root joined with a validated id
		return "steps.js is missing (the manifest declares steps)"
	}
	return ""
}

// loadedPack caches one plugin's evaluated steps.js, keyed by the
// file's size and modification time so an edited pack reloads on the
// next lookup without a restart.
type loadedPack struct {
	size    int64
	modTime time.Time
	pack    *jsengine.Pack
	err     error
}

// SetRunPolicy installs the run-policy predicate (the composition
// root's settingsTrust.mayRun): a plugin that may not run contributes
// no steps, so a blocked or unreviewed plugin's step never appears in
// the catalog nor executes.
//
//wails:ignore
func (p *PluginService) SetRunPolicy(mayRun func(id string, builtin bool) bool) {
	p.mayRun = mayRun
}

// stepPack returns the plugin's loaded pack, (re)loading when the
// file changed. Concurrency: the cache map is guarded; a pack's own
// calls are serialized inside jsengine.
func (p *PluginService) stepPack(info PluginInfo) (*jsengine.Pack, error) {
	path := filepath.Join(info.Dir, "steps.js")
	st, err := os.Stat(path) // #nosec G304 G703 -- the plugin's own folder
	if err != nil {
		return nil, fmt.Errorf("steps.js is missing")
	}
	p.packsMu.Lock()
	defer p.packsMu.Unlock()
	if p.packs == nil {
		p.packs = map[string]loadedPack{}
	}
	if cached, ok := p.packs[info.Manifest.ID]; ok && cached.size == st.Size() && cached.modTime.Equal(st.ModTime()) {
		return cached.pack, cached.err
	}
	raw, err := os.ReadFile(path) // #nosec G304 -- the plugin's own folder
	if err != nil {
		return nil, err
	}
	pack, err := jsengine.Load(string(raw), jsengine.DefaultTimeout)
	p.packs[info.Manifest.ID] = loadedPack{size: st.Size(), modTime: st.ModTime(), pack: pack, err: err}
	return pack, err
}

// StepNodeTypes synthesizes every runnable plugin's declared steps as
// external node types -- the provider composition reads through
// SetExternalNodeTypeLookup. A plugin whose steps.js fails to load
// contributes nothing (its Extensions row states the load error via
// StepPackProblem).
func (p *PluginService) StepNodeTypes() []composition.ExternalNodeType {
	infos, err := p.ListPlugins()
	if err != nil {
		return nil
	}
	var out []composition.ExternalNodeType
	for _, info := range infos {
		out = append(out, p.pluginStepTypes(info)...)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].NodeType.ID < out[j].NodeType.ID })
	return out
}

// pluginStepTypes is one plugin's contribution: nothing unless it
// declares steps, may run, and its pack loads; then every declared
// step the pack actually registers.
func (p *PluginService) pluginStepTypes(info PluginInfo) []composition.ExternalNodeType {
	if info.Error != "" || len(info.Manifest.Contributes.Steps) == 0 {
		return nil
	}
	if p.mayRun != nil && !p.mayRun(info.Manifest.ID, info.Builtin) {
		return nil
	}
	pack, err := p.stepPack(info)
	if err != nil {
		return nil
	}
	registered := map[string]bool{}
	for _, d := range pack.Steps() {
		registered[d.ID] = true
	}
	var out []composition.ExternalNodeType
	for _, st := range info.Manifest.Contributes.Steps {
		if registered[st.ID] {
			out = append(out, externalNodeType(info, st, pack))
		}
	}
	return out
}

func stepConfigFields(st StepContribution) []typedfield.Field {
	fields := make([]typedfield.Field, 0, len(st.Config))
	for _, f := range st.Config {
		field := typedfield.Field{Key: f.Key, Label: f.Label, Description: f.Description, Type: typedfield.TypeText, Default: f.Default}
		if f.Type == "options" {
			field.Type = typedfield.TypeOptions
			field.Options = append([]string{}, f.Options...)
		}
		if field.Description == "" {
			field.Description = f.Label
		}
		fields = append(fields, field)
	}
	return fields
}

func externalNodeType(info PluginInfo, st StepContribution, pack *jsengine.Pack) composition.ExternalNodeType {
	pluginName := info.Manifest.Name
	if pluginName == "" {
		pluginName = info.Manifest.ID
	}
	description := st.Description
	if description == "" {
		description = st.Label
	}
	nt := composition.NodeType{
		ID:           StepNodeTypeID(info.Manifest.ID, st.ID),
		Kind:         composition.KindProcess,
		Label:        st.Label,
		Description:  description + " (" + pluginName + " plugin)",
		ConfigFields: stepConfigFields(st),
		Output:       "Text",
		Consumes:     []composition.PayloadKind{composition.PayloadText},
		Produces:     composition.PayloadProduce{Kind: composition.PayloadText},
		PaletteGroup: "transform",
		Complexity:   composition.ComplexityBasic,
	}
	return composition.ExternalNodeType{NodeType: nt, Exec: stepExec(pack, st.ID)}
}

// stepExec runs the pack's step on the node's config and the run's
// context; attributes the step returns merge over the run's bag.
func stepExec(pack *jsengine.Pack, stepID string) composition.ExecFunc {
	return func(node composition.Node, ctx composition.ExecContext) (composition.ExecContext, error) {
		out, err := pack.Perform(stepID, jsengine.Input{Payload: ctx.Payload, Config: node.Config, Attributes: ctx.Attributes})
		if err != nil {
			return ctx, err
		}
		ctx.Payload = out.Payload
		if len(out.Attributes) > 0 {
			merged := make(map[string]any, len(ctx.Attributes)+len(out.Attributes))
			for k, v := range ctx.Attributes {
				merged[k] = v
			}
			for k, v := range out.Attributes {
				merged[k] = v
			}
			ctx.Attributes = merged
		}
		return ctx, nil
	}
}

// StepPackProblem reports why a plugin's declared steps are not
// available ("" when they are): the Extensions row's honest line.
func (p *PluginService) StepPackProblem(id string) string {
	info := p.resolvePlugin(id)
	if info.Error != "" || len(info.Manifest.Contributes.Steps) == 0 {
		return ""
	}
	pack, err := p.stepPack(info)
	if err != nil {
		return err.Error()
	}
	registered := map[string]bool{}
	for _, d := range pack.Steps() {
		registered[d.ID] = true
	}
	for _, st := range info.Manifest.Contributes.Steps {
		if !registered[st.ID] {
			return fmt.Sprintf("steps.js does not register the declared step %q", st.ID)
		}
	}
	return ""
}

// conformStepPack is the conformance suite's half: the declared steps
// and steps.js must agree both ways.
func conformStepPack(dir string, m Manifest) []string {
	if len(m.Contributes.Steps) == 0 {
		return nil
	}
	raw, err := os.ReadFile(filepath.Join(dir, "steps.js")) // #nosec G304 -- the caller's own plugin folder
	if err != nil {
		return []string{"steps.js is missing (the manifest declares steps)"}
	}
	pack, err := jsengine.Load(string(raw), jsengine.DefaultTimeout)
	if err != nil {
		return []string{err.Error()}
	}
	var problems []string
	declared := map[string]bool{}
	for _, st := range m.Contributes.Steps {
		declared[st.ID] = true
	}
	registered := map[string]bool{}
	for _, d := range pack.Steps() {
		registered[d.ID] = true
		if !declared[d.ID] {
			problems = append(problems, fmt.Sprintf("steps.js registers %q, which the manifest does not declare", d.ID))
		}
	}
	for id := range declared {
		if !registered[id] {
			problems = append(problems, fmt.Sprintf("the manifest declares step %q, which steps.js does not register", id))
		}
	}
	return problems
}
