// Package jsengine runs a plugin's step code inside the Go process
// (ADR-0051 §5's "perform" step-pack door, goal 0305 slice 4b) through
// an embedded JavaScript engine -- the converged shape for "user JS
// steps inside a Go executor" (k6's), adopted behind this seam so the
// engine stays swappable. goja: pure Go, no cgo, ES5.1 plus most of
// ES6, an interrupt for hard timeouts; no ESM, so a step pack is a
// script-mode file that registers its steps through ONE host global
// rather than exporting them.
//
// Contract at the seam (architecture.md's adopted-contract rule): a
// goja.Runtime is NOT goroutine-safe, so every call into one pack is
// serialized by its own mutex; a perform call is bounded by Timeout
// through vm.Interrupt, after which the runtime is discarded and
// reloaded from source on the next call (an interrupted VM is not
// reusable); the only globals a pack sees are registerStep and the
// language's own -- no require, no fetch, no filesystem.
package jsengine

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/dop251/goja"
)

// DefaultTimeout bounds one perform call; a step that loops forever
// fails the run instead of hanging it.
const DefaultTimeout = 5 * time.Second

// StepDecl is one step a pack registered: registerStep(id, {label,
// description, perform}).
type StepDecl struct {
	ID          string
	Label       string
	Description string
}

// Input is what perform receives: the step's payload, its authored
// config, and the run's attribute bag.
type Input struct {
	Payload    string
	Config     map[string]string
	Attributes map[string]any
}

// Output is what perform returned: a string is the new payload; an
// object with `payload` and/or `attributes` sets both.
type Output struct {
	Payload    string
	Attributes map[string]any
}

// Pack is one loaded step pack (one steps.js).
type Pack struct {
	source  string
	timeout time.Duration
	// kind selects which registration global the pack's source file
	// gets and which registry Load requires to be non-empty: the two
	// pack files a plugin may ship are separate sandboxes, so a steps
	// file can never register a secret source nor the reverse.
	kind        packKind
	mu          sync.Mutex
	vm          *goja.Runtime
	steps       map[string]goja.Callable
	decls       []StepDecl
	sources     map[string]*goja.Object
	sourceDecls []SourceDecl
}

type packKind int

const (
	packSteps packKind = iota
	packSources
)

// Load evaluates source once and collects its registered steps. A
// pack that registers nothing, registers a duplicate id, or registers
// a step without a perform function is refused by name.
func Load(source string, timeout time.Duration) (*Pack, error) {
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	p := &Pack{source: source, timeout: timeout, kind: packSteps}
	if err := p.boot(); err != nil {
		return nil, err
	}
	if len(p.decls) == 0 {
		return nil, errors.New("steps.js registers no steps (call registerStep(id, { label, perform }))")
	}
	return p, nil
}

// LoadSources evaluates a secrets.js pack: the same engine, timeout and
// sandbox Load gives a steps pack, with registerSource in place of
// registerStep. The pack reaches nothing on its own -- a source's
// functions receive their file access as host functions on the ctx
// object built per call (SourceCtx).
func LoadSources(source string, timeout time.Duration) (*Pack, error) {
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	p := &Pack{source: source, timeout: timeout, kind: packSources}
	if err := p.boot(); err != nil {
		return nil, err
	}
	if len(p.sourceDecls) == 0 {
		return nil, errors.New("secrets.js registers no sources (call registerSource(id, { list, resolve }))")
	}
	return p, nil
}

func (p *Pack) boot() error {
	if p.kind == packSources {
		return p.bootSources()
	}
	vm := goja.New()
	steps := map[string]goja.Callable{}
	var decls []StepDecl
	var bootErr error
	if err := vm.Set("registerStep", func(call goja.FunctionCall) goja.Value {
		id := strings.TrimSpace(call.Argument(0).String())
		spec := call.Argument(1)
		if id == "" || spec == nil || goja.IsUndefined(spec) || goja.IsNull(spec) {
			bootErr = errors.New("registerStep needs an id and a { label, perform } object")
			return goja.Undefined()
		}
		if _, dup := steps[id]; dup {
			bootErr = fmt.Errorf("step %q is registered twice", id)
			return goja.Undefined()
		}
		obj := spec.ToObject(vm)
		perform, ok := goja.AssertFunction(obj.Get("perform"))
		if !ok {
			bootErr = fmt.Errorf("step %q has no perform function", id)
			return goja.Undefined()
		}
		decl := StepDecl{ID: id, Label: stringProp(obj, "label"), Description: stringProp(obj, "description")}
		if decl.Label == "" {
			decl.Label = id
		}
		steps[id] = perform
		decls = append(decls, decl)
		return goja.Undefined()
	}); err != nil {
		return err
	}
	timer := time.AfterFunc(p.timeout, func() { vm.Interrupt("steps.js took too long to load") })
	_, err := vm.RunString(p.source)
	timer.Stop()
	if err != nil {
		return fmt.Errorf("steps.js: %w", err)
	}
	if bootErr != nil {
		return fmt.Errorf("steps.js: %w", bootErr)
	}
	sort.Slice(decls, func(i, j int) bool { return decls[i].ID < decls[j].ID })
	p.vm, p.steps, p.decls = vm, steps, decls
	return nil
}

func stringProp(obj *goja.Object, key string) string {
	v := obj.Get(key)
	if v == nil || goja.IsUndefined(v) || goja.IsNull(v) {
		return ""
	}
	return strings.TrimSpace(v.String())
}

// Steps lists the registered steps, sorted by id.
func (p *Pack) Steps() []StepDecl {
	out := make([]StepDecl, len(p.decls))
	copy(out, p.decls)
	return out
}

// Perform runs one step on in. A thrown error, an unknown step, or the
// timeout is an error; the runtime is rebuilt after a timeout.
func (p *Pack) Perform(stepID string, in Input) (Output, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.vm == nil {
		if err := p.boot(); err != nil {
			return Output{}, err
		}
	}
	fn, ok := p.steps[stepID]
	if !ok {
		return Output{}, fmt.Errorf("steps.js registers no step %q", stepID)
	}
	arg := p.vm.NewObject()
	_ = arg.Set("payload", in.Payload)
	_ = arg.Set("config", cloneStringMap(in.Config))
	_ = arg.Set("attributes", cloneAnyMap(in.Attributes))
	timedOut := false
	timer := time.AfterFunc(p.timeout, func() { timedOut = true; p.vm.Interrupt("step took too long") })
	result, err := fn(goja.Undefined(), arg)
	timer.Stop()
	if timedOut {
		p.vm, p.steps = nil, nil // an interrupted runtime is not reusable
		return Output{}, fmt.Errorf("step %q exceeded %s", stepID, p.timeout)
	}
	if err != nil {
		var jsErr *goja.Exception
		if errors.As(err, &jsErr) {
			return Output{}, fmt.Errorf("step %q threw: %s", stepID, jsErr.Value().String())
		}
		return Output{}, fmt.Errorf("step %q: %w", stepID, err)
	}
	return p.decode(stepID, result)
}

func (p *Pack) decode(stepID string, v goja.Value) (Output, error) {
	if v == nil || goja.IsUndefined(v) || goja.IsNull(v) {
		return Output{}, fmt.Errorf("step %q returned nothing (return a string, or { payload, attributes })", stepID)
	}
	exported := v.Export()
	switch x := exported.(type) {
	case string:
		return Output{Payload: x}, nil
	case map[string]any:
		out := Output{}
		if pl, ok := x["payload"]; ok && pl != nil {
			out.Payload = fmt.Sprint(pl)
		}
		if attrs, ok := x["attributes"].(map[string]any); ok {
			out.Attributes = normalizeNumbers(attrs).(map[string]any)
		}
		return out, nil
	default:
		return Output{Payload: fmt.Sprint(exported)}, nil
	}
}

func cloneStringMap(m map[string]string) map[string]string {
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

func cloneAnyMap(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// normalizeNumbers turns the engine's int64 exports into float64 so an
// attribute written by a step reads like every other attribute value
// (the run's attribute env is float64 for every number).
func normalizeNumbers(v any) any {
	switch x := v.(type) {
	case int64:
		return float64(x)
	case int:
		return float64(x)
	case map[string]any:
		for k, inner := range x {
			x[k] = normalizeNumbers(inner)
		}
		return x
	case []any:
		for i, inner := range x {
			x[i] = normalizeNumbers(inner)
		}
		return x
	}
	return v
}
