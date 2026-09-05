package jsengine

import (
	"errors"
	"strings"
	"testing"
	"time"
)

const sourcePack = `
registerSource('one', {
  list: function (ctx) { return ctx.readFile().split('\n') },
  resolve: function (ctx, key) { return key + '=' + ctx.path },
})
registerSource('two', {
  list: function (ctx) { return ctx.listFiles('*.env') },
  resolve: function () { return 'v' },
  discover: function (ctx) { return [{ path: ctx.path + '/a', label: 'A' }, { nope: 1 }] },
  import: function (ctx, keys) { return { first: keys[0], count: keys.length } },
})
registerSource('bad', {
  list: function () { throw new Error('nope') },
  resolve: function () { while (true) {} },
})
`

func testCtx() SourceCtx {
	return SourceCtx{
		Path:      "/tmp/here",
		ReadFile:  func(rel string) (string, error) { return "A\nB", nil },
		ListFiles: func(pattern string) ([]string, error) { return []string{"x.env", "y.env"}, nil },
	}
}

func TestLoadSources_RegistersAndCalls(t *testing.T) {
	p, err := LoadSources(sourcePack, time.Second)
	if err != nil {
		t.Fatalf("LoadSources: %v", err)
	}
	decls := p.Sources()
	if len(decls) != 3 || decls[0].ID != "bad" || decls[2].ID != "two" {
		t.Fatalf("decls = %+v", decls)
	}
	if decls[2].HasDiscover != true || decls[2].HasImport != true || decls[1].HasDiscover {
		t.Fatalf("optional functions = %+v", decls)
	}
	keys, err := p.SourceList("one", testCtx())
	if err != nil || strings.Join(keys, ",") != "A,B" {
		t.Fatalf("list = %v %v", keys, err)
	}
	v, err := p.SourceResolve("one", testCtx(), "K")
	if err != nil || v != "K=/tmp/here" {
		t.Fatalf("resolve = %q %v", v, err)
	}
	found, err := p.SourceDiscover("two", testCtx())
	if err != nil || len(found) != 1 || found[0].Path != "/tmp/here/a" || found[0].Label != "A" {
		t.Fatalf("discover = %+v %v", found, err)
	}
	imported, err := p.SourceImport("two", testCtx(), []string{"a", "b"})
	if err != nil || imported["first"] != "a" || imported["count"] != "2" {
		t.Fatalf("import = %v %v", imported, err)
	}
}

// A door the host did not supply throws inside the pack, so a source
// can never mistake "not allowed here" for "the file is empty".
func TestSourceCtx_AbsentDoorsThrow(t *testing.T) {
	p, err := LoadSources(sourcePack, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.SourceList("one", SourceCtx{Path: "/x"}); err == nil || !strings.Contains(err.Error(), "may not read files") {
		t.Fatalf("readFile with no door: %v", err)
	}
	if _, err := p.SourceList("two", SourceCtx{Path: "/x"}); err == nil || !strings.Contains(err.Error(), "may not list files") {
		t.Fatalf("listFiles with no door: %v", err)
	}
}

// A host reader's refusal reaches the pack as a JS exception, and comes
// back out named -- the confinement error is never swallowed.
func TestSourceCtx_HostRefusalSurfaces(t *testing.T) {
	p, err := LoadSources(sourcePack, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	ctx := testCtx()
	ctx.ReadFile = func(string) (string, error) { return "", errors.New("outside its own folder") }
	if _, err := p.SourceList("one", ctx); err == nil || !strings.Contains(err.Error(), "outside its own folder") {
		t.Fatalf("refusal = %v", err)
	}
}

func TestSourceCalls_ErrorsAreNamed(t *testing.T) {
	p, err := LoadSources(sourcePack, 200*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.SourceList("bad", testCtx()); err == nil || !strings.Contains(err.Error(), "threw") {
		t.Fatalf("throwing list: %v", err)
	}
	if _, err := p.SourceList("missing", testCtx()); err == nil || !strings.Contains(err.Error(), "no source") {
		t.Fatalf("missing source: %v", err)
	}
	if _, err := p.SourceResolve("bad", testCtx(), "k"); err == nil || !strings.Contains(err.Error(), "exceeded") {
		t.Fatalf("spinning resolve: %v", err)
	}
	// The interrupted runtime rebuilds on the next call.
	if v, err := p.SourceResolve("one", testCtx(), "again"); err != nil || v != "again=/tmp/here" {
		t.Fatalf("after timeout: %q %v", v, err)
	}
	if _, err := p.SourceImport("one", testCtx(), nil); err == nil || !strings.Contains(err.Error(), "cannot import") {
		t.Fatalf("import on a source without one: %v", err)
	}
	if found, err := p.SourceDiscover("one", testCtx()); err != nil || found != nil {
		t.Fatalf("discover on a source without one: %v %v", found, err)
	}
}

func TestLoadSources_RefusesBadPacks(t *testing.T) {
	for name, src := range map[string]string{
		"empty":       `var x = 1`,
		"no resolve":  `registerSource('a', { list: function(){} })`,
		"no list":     `registerSource('a', { resolve: function(){} })`,
		"duplicate":   `registerSource('a', { list: function(){}, resolve: function(){} }); registerSource('a', { list: function(){}, resolve: function(){} })`,
		"syntax":      `registerSource('a', { list: function( {} })`,
		"steps only":  `registerStep('a', { perform: function(){} })`,
		"no registry": `var fs = require('fs')`,
	} {
		if _, err := LoadSources(src, time.Second); err == nil {
			t.Errorf("%s: loaded", name)
		}
	}
}
