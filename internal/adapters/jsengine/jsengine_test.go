package jsengine

import (
	"strings"
	"testing"
	"time"
)

const pack = `
registerStep('shout', { label: 'Shout', description: 'Upper-cases the text.', perform: function (input) { return input.payload.toUpperCase() } })
registerStep('tag', { label: 'Tag', perform: function (input) {
  return { payload: input.config.prefix + input.payload, attributes: { tagged: true, seen: input.attributes.count } }
} })
registerStep('boom', { perform: function () { throw new Error('nope') } })
registerStep('spin', { perform: function () { while (true) {} } })
`

func TestLoad_RegistersStepsAndPerformsThem(t *testing.T) {
	p, err := Load(pack, time.Second)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	ids := make([]string, 0, len(p.Steps()))
	for _, d := range p.Steps() {
		ids = append(ids, d.ID)
	}
	if strings.Join(ids, ",") != "boom,shout,spin,tag" {
		t.Fatalf("steps = %v", ids)
	}
	if p.Steps()[1].Label != "Shout" || p.Steps()[1].Description != "Upper-cases the text." || p.Steps()[0].Label != "boom" {
		t.Fatalf("decls = %+v", p.Steps())
	}
	out, err := p.Perform("shout", Input{Payload: "hi"})
	if err != nil || out.Payload != "HI" {
		t.Fatalf("shout = %+v err=%v", out, err)
	}
	out, err = p.Perform("tag", Input{Payload: "x", Config: map[string]string{"prefix": "#"}, Attributes: map[string]any{"count": 2.0}})
	if err != nil || out.Payload != "#x" || out.Attributes["tagged"] != true || out.Attributes["seen"] != 2.0 {
		t.Fatalf("tag = %+v err=%v", out, err)
	}
}

func TestPerform_ErrorsAreNamed(t *testing.T) {
	p, err := Load(pack, 200*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.Perform("boom", Input{}); err == nil || !strings.Contains(err.Error(), "threw") || !strings.Contains(err.Error(), "nope") {
		t.Fatalf("boom err = %v", err)
	}
	if _, err := p.Perform("missing", Input{}); err == nil || !strings.Contains(err.Error(), "no step") {
		t.Fatalf("missing err = %v", err)
	}
	if _, err := p.Perform("spin", Input{}); err == nil || !strings.Contains(err.Error(), "exceeded") {
		t.Fatalf("spin err = %v", err)
	}
	// The pack recovers after a timeout: the runtime is rebuilt.
	out, err := p.Perform("shout", Input{Payload: "again"})
	if err != nil || out.Payload != "AGAIN" {
		t.Fatalf("after timeout: %+v err=%v", out, err)
	}
}

func TestLoad_RefusesBadPacks(t *testing.T) {
	for name, src := range map[string]string{
		"empty":      `var x = 1`,
		"no perform": `registerStep('a', { label: 'A' })`,
		"duplicate":  `registerStep('a', { perform: function(){} }); registerStep('a', { perform: function(){} })`,
		"syntax":     `registerStep('a', { perform: function( {} })`,
		"no require": `var fs = require('fs')`,
	} {
		if _, err := Load(src, time.Second); err == nil {
			t.Errorf("%s: loaded", name)
		}
	}
}
