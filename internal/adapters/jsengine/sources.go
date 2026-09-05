package jsengine

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/dop251/goja"
)

// A secrets pack is the runtime half of a plugin's declared secret
// sources: one registerSource per source the manifest declares, each
// with list/resolve and optionally discover/import. It runs in the same
// embedded engine a steps pack does, never in the webview, so a value a
// source reads never crosses into browser-reachable code.
//
// A source function reaches the filesystem only through the ctx object
// the HOST builds for the call: ctx.path is the source's configured
// path and ctx.readFile / ctx.listFiles are host functions the caller
// supplies (SourceCtx), confined by the caller to that path. The pack
// itself holds no file primitive.

// SourceDecl is one source a secrets pack registered, and which of the
// optional functions it implements -- what the host compares against
// the manifest's own declaration.
type SourceDecl struct {
	ID          string
	HasDiscover bool
	HasImport   bool
}

// SourceCtx is the per-call context a host hands one source function.
// ReadFile and ListFiles are the host's own confined readers; a nil one
// makes that door throw inside the pack rather than silently return
// nothing.
type SourceCtx struct {
	Path      string
	ReadFile  func(relative string) (string, error)
	ListFiles func(pattern string) ([]string, error)
}

// Discovered is one candidate a source's discover() found under the
// configured folder: the path to offer as a new source, and the label
// to offer it under.
type Discovered struct {
	Path  string
	Label string
}

func (p *Pack) bootSources() error {
	vm := goja.New()
	sources := map[string]*goja.Object{}
	var decls []SourceDecl
	var bootErr error
	if err := vm.Set("registerSource", func(call goja.FunctionCall) goja.Value {
		id := strings.TrimSpace(call.Argument(0).String())
		spec := call.Argument(1)
		if id == "" || spec == nil || goja.IsUndefined(spec) || goja.IsNull(spec) {
			bootErr = errors.New("registerSource needs an id and a { list, resolve } object")
			return goja.Undefined()
		}
		if _, dup := sources[id]; dup {
			bootErr = fmt.Errorf("source %q is registered twice", id)
			return goja.Undefined()
		}
		obj := spec.ToObject(vm)
		for _, required := range []string{"list", "resolve"} {
			if _, ok := goja.AssertFunction(obj.Get(required)); !ok {
				bootErr = fmt.Errorf("source %q has no %s function", id, required)
				return goja.Undefined()
			}
		}
		_, hasDiscover := goja.AssertFunction(obj.Get("discover"))
		_, hasImport := goja.AssertFunction(obj.Get("import"))
		sources[id] = obj
		decls = append(decls, SourceDecl{ID: id, HasDiscover: hasDiscover, HasImport: hasImport})
		return goja.Undefined()
	}); err != nil {
		return err
	}
	timer := time.AfterFunc(p.timeout, func() { vm.Interrupt("secrets.js took too long to load") })
	_, err := vm.RunString(p.source)
	timer.Stop()
	if err != nil {
		return fmt.Errorf("secrets.js: %w", err)
	}
	if bootErr != nil {
		return fmt.Errorf("secrets.js: %w", bootErr)
	}
	sort.Slice(decls, func(i, j int) bool { return decls[i].ID < decls[j].ID })
	p.vm, p.sources, p.sourceDecls = vm, sources, decls
	return nil
}

// Sources lists what the pack registered, sorted by id.
func (p *Pack) Sources() []SourceDecl {
	out := make([]SourceDecl, len(p.sourceDecls))
	copy(out, p.sourceDecls)
	return out
}

// SourceList returns the source's secret NAMES -- never a value.
func (p *Pack) SourceList(sourceID string, ctx SourceCtx) ([]string, error) {
	v, err := p.callSource(sourceID, "list", ctx)
	if err != nil {
		return nil, err
	}
	return stringSlice(v.Export()), nil
}

// SourceResolve reads one named secret's value.
func (p *Pack) SourceResolve(sourceID string, ctx SourceCtx, key string) (string, error) {
	v, err := p.callSource(sourceID, "resolve", ctx, key)
	if err != nil {
		return "", err
	}
	exported := v.Export()
	if exported == nil {
		return "", fmt.Errorf("source %q has no key %q", sourceID, key)
	}
	return fmt.Sprint(exported), nil
}

// SourceDiscover asks the source what it can find under its configured
// folder. A source that registered no discover function returns
// nothing rather than an error -- the capability is optional.
func (p *Pack) SourceDiscover(sourceID string, ctx SourceCtx) ([]Discovered, error) {
	if !p.implements(sourceID, "discover") {
		return nil, nil
	}
	v, err := p.callSource(sourceID, "discover", ctx)
	if err != nil {
		return nil, err
	}
	rows, _ := v.Export().([]any)
	out := make([]Discovered, 0, len(rows))
	for _, row := range rows {
		m, ok := row.(map[string]any)
		if !ok {
			continue
		}
		d := Discovered{Path: fmt.Sprint(m["path"]), Label: fmt.Sprint(m["label"])}
		if d.Path == "" || d.Path == "<nil>" {
			continue
		}
		if d.Label == "" || d.Label == "<nil>" {
			d.Label = d.Path
		}
		out = append(out, d)
	}
	return out, nil
}

// SourceImport reads several named secrets at once, for the one case a
// key-by-key read would be wasteful (an import moves a whole file).
func (p *Pack) SourceImport(sourceID string, ctx SourceCtx, keys []string) (map[string]string, error) {
	if !p.implements(sourceID, "import") {
		return nil, fmt.Errorf("source %q cannot import", sourceID)
	}
	v, err := p.callSource(sourceID, "import", ctx, keys)
	if err != nil {
		return nil, err
	}
	raw, _ := v.Export().(map[string]any)
	out := make(map[string]string, len(raw))
	for k, val := range raw {
		if val == nil {
			continue
		}
		out[k] = fmt.Sprint(val)
	}
	return out, nil
}

func (p *Pack) implements(sourceID, fn string) bool {
	for _, d := range p.sourceDecls {
		if d.ID != sourceID {
			continue
		}
		return (fn == "discover" && d.HasDiscover) || (fn == "import" && d.HasImport)
	}
	return false
}

// callSource is every source call's one body: rebuild an interrupted
// runtime, build the ctx object with the host's own readers, run under
// the pack timeout. Serialized on the pack's mutex like Perform, since
// one goja runtime is not reentrant.
func (p *Pack) callSource(sourceID, fn string, ctx SourceCtx, extra ...any) (goja.Value, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.vm == nil {
		if err := p.boot(); err != nil {
			return nil, err
		}
	}
	obj, ok := p.sources[sourceID]
	if !ok {
		return nil, fmt.Errorf("secrets.js registers no source %q", sourceID)
	}
	callable, ok := goja.AssertFunction(obj.Get(fn))
	if !ok {
		return nil, fmt.Errorf("source %q has no %s function", sourceID, fn)
	}
	args := make([]goja.Value, 0, 1+len(extra))
	args = append(args, p.sourceCtxValue(ctx))
	for _, e := range extra {
		args = append(args, p.vm.ToValue(e))
	}
	timedOut := false
	timer := time.AfterFunc(p.timeout, func() { timedOut = true; p.vm.Interrupt("a secret source took too long") })
	result, err := callable(obj, args...)
	timer.Stop()
	if timedOut {
		p.vm, p.sources = nil, nil // an interrupted runtime is not reusable
		return nil, fmt.Errorf("source %q exceeded %s", sourceID, p.timeout)
	}
	if err != nil {
		var jsErr *goja.Exception
		if errors.As(err, &jsErr) {
			return nil, fmt.Errorf("source %q threw: %s", sourceID, jsErr.Value().String())
		}
		return nil, fmt.Errorf("source %q: %w", sourceID, err)
	}
	if result == nil {
		return goja.Undefined(), nil
	}
	return result, nil
}

// sourceCtxValue builds the one object a source function receives. A
// door the host did not supply throws when called, so a pack can never
// mistake "not allowed here" for "empty".
func (p *Pack) sourceCtxValue(ctx SourceCtx) goja.Value {
	obj := p.vm.NewObject()
	_ = obj.Set("path", ctx.Path)
	_ = obj.Set("readFile", func(call goja.FunctionCall) goja.Value {
		if ctx.ReadFile == nil {
			panic(p.vm.NewTypeError("this source may not read files"))
		}
		content, err := ctx.ReadFile(argString(call, 0))
		if err != nil {
			panic(p.vm.NewGoError(err))
		}
		return p.vm.ToValue(content)
	})
	_ = obj.Set("listFiles", func(call goja.FunctionCall) goja.Value {
		if ctx.ListFiles == nil {
			panic(p.vm.NewTypeError("this source may not list files"))
		}
		names, err := ctx.ListFiles(argString(call, 0))
		if err != nil {
			panic(p.vm.NewGoError(err))
		}
		return p.vm.ToValue(names)
	})
	return obj
}

func argString(call goja.FunctionCall, i int) string {
	v := call.Argument(i)
	if v == nil || goja.IsUndefined(v) || goja.IsNull(v) {
		return ""
	}
	return v.String()
}

// stringSlice normalizes what a source's list() returned: a JavaScript
// array exports as []any, while an array the host itself handed in
// (ctx.listFiles' result, returned unchanged) exports as []string.
func stringSlice(v any) []string {
	rows, ok := v.([]any)
	if !ok {
		if names, isStrings := v.([]string); isStrings {
			rows = make([]any, len(names))
			for i, n := range names {
				rows[i] = n
			}
		} else {
			return nil
		}
	}
	out := make([]string, 0, len(rows))
	for _, row := range rows {
		if row == nil {
			continue
		}
		s := strings.TrimSpace(fmt.Sprint(row))
		if s != "" {
			out = append(out, s)
		}
	}
	sort.Strings(out)
	return out
}
