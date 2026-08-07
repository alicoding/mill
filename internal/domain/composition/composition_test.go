package composition

import (
	"errors"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/capabilities"
)

func withFakeClipboard(t *testing.T, read func() (string, error), writeHTML, writeText func(string) error) {
	t.Helper()
	origRead, origWriteHTML, origWriteText := readClipboardHTML, writeClipboardHTML, writeClipboardText
	if read != nil {
		readClipboardHTML = read
	}
	if writeHTML != nil {
		writeClipboardHTML = writeHTML
	}
	if writeText != nil {
		writeClipboardText = writeText
	}
	t.Cleanup(func() {
		readClipboardHTML = origRead
		writeClipboardHTML = origWriteHTML
		writeClipboardText = origWriteText
	})
}

func TestNodeTypes(t *testing.T) {
	types := NodeTypes()
	if len(types) == 0 {
		t.Fatal("NodeTypes() returned no node types")
	}
	seen := make(map[string]bool)
	for _, nt := range types {
		if nt.ID == "" || nt.Label == "" || nt.Description == "" {
			t.Errorf("node type %+v has an empty ID/Label/Description", nt)
		}
		if seen[nt.ID] {
			t.Errorf("duplicate node type ID %q", nt.ID)
		}
		seen[nt.ID] = true
		for _, f := range nt.ConfigFields {
			if f.Key == "" || f.Label == "" {
				t.Errorf("node type %q has a config field with an empty Key/Label: %+v", nt.ID, f)
			}
		}
	}
}

func TestBuiltInWorkflows_AllStepsFullyResolved(t *testing.T) {
	for _, wf := range BuiltInWorkflows() {
		if !wf.BuiltIn {
			t.Errorf("workflow %q from BuiltInWorkflows() has BuiltIn=false", wf.ID)
		}
		if len(wf.Steps) == 0 {
			t.Errorf("workflow %q has no steps", wf.ID)
		}
		for _, step := range wf.Steps {
			nt, ok := nodeType(step.NodeTypeID)
			if !ok {
				t.Errorf("workflow %q references unknown node type %q", wf.ID, step.NodeTypeID)
				continue
			}
			for _, field := range nt.ConfigFields {
				if _, ok := step.Config[field.Key]; !ok {
					t.Errorf("workflow %q step %q missing resolved config key %q", wf.ID, step.NodeTypeID, field.Key)
				}
			}
		}
	}
}

func TestResolveStepDefaults_FillsMissingKeysWithDefaults(t *testing.T) {
	resolved, err := ResolveStepDefaults([]Step{{NodeTypeID: "apply-clipboard-write-html"}})
	if err != nil {
		t.Fatalf("ResolveStepDefaults returned error: %v", err)
	}
	if resolved[0].Config["html"] != sampleHTML {
		t.Errorf("resolved config[html] = %q, want the field's default", resolved[0].Config["html"])
	}
}

func TestResolveStepDefaults_PreservesExplicitValue(t *testing.T) {
	resolved, err := ResolveStepDefaults([]Step{
		{NodeTypeID: "apply-clipboard-write-html", Config: map[string]string{"html": "<p>custom</p>"}},
	})
	if err != nil {
		t.Fatalf("ResolveStepDefaults returned error: %v", err)
	}
	if resolved[0].Config["html"] != "<p>custom</p>" {
		t.Errorf("resolved config[html] = %q, want the explicit value preserved, not overwritten by the default", resolved[0].Config["html"])
	}
}

func TestResolveStepDefaults_UnknownNodeType(t *testing.T) {
	if _, err := ResolveStepDefaults([]Step{{NodeTypeID: "does-not-exist"}}); err == nil {
		t.Fatal("ResolveStepDefaults(unknown node type) returned nil error, want an error")
	}
}

func TestExecuteWorkflow_UnknownNodeType(t *testing.T) {
	if _, err := ExecuteWorkflow([]Step{{NodeTypeID: "does-not-exist"}}); err == nil {
		t.Fatal("ExecuteWorkflow(unknown node type) returned nil error, want an error")
	}
}

func TestExecuteWorkflow_LoadSampleHTML_UsesDefault(t *testing.T) {
	var written string
	withFakeClipboard(t, nil, func(html string) error {
		written = html
		return nil
	}, nil)

	steps, err := ResolveStepDefaults([]Step{{NodeTypeID: "apply-clipboard-write-html"}})
	if err != nil {
		t.Fatalf("ResolveStepDefaults returned error: %v", err)
	}
	result, err := ExecuteWorkflow(steps)
	if err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if written != sampleHTML {
		t.Errorf("apply-clipboard-write-html was called with %q, want the sample HTML", written)
	}
	if !strings.Contains(result, "Quarterly update") {
		t.Errorf("ExecuteWorkflow result = %q, want it to contain the sample HTML", result)
	}
}

func TestExecuteWorkflow_LoadSampleHTML_UsesConfiguredValue(t *testing.T) {
	var written string
	withFakeClipboard(t, nil, func(html string) error {
		written = html
		return nil
	}, nil)

	steps, err := ResolveStepDefaults([]Step{
		{NodeTypeID: "apply-clipboard-write-html", Config: map[string]string{"html": "<p>custom configured value</p>"}},
	})
	if err != nil {
		t.Fatalf("ResolveStepDefaults returned error: %v", err)
	}
	result, err := ExecuteWorkflow(steps)
	if err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	// The point of configuration: a step's own value flows through
	// execution, not just the default -- proves compose-with-configure
	// isn't cosmetic.
	if written != "<p>custom configured value</p>" {
		t.Errorf("apply-clipboard-write-html was called with %q, want the configured (non-default) value", written)
	}
	if !strings.Contains(result, "custom configured value") {
		t.Errorf("ExecuteWorkflow result = %q, want the configured value", result)
	}
}

func TestExecuteWorkflow_ClipboardHTMLToMarkdown(t *testing.T) {
	var written string
	withFakeClipboard(t, func() (string, error) {
		return "<h2>Hi</h2><p>the <strong>bit</strong></p>", nil
	}, nil, func(md string) error {
		written = md
		return nil
	})

	steps, err := ResolveStepDefaults([]Step{
		{NodeTypeID: "capture-clipboard-html"},
		{NodeTypeID: "process-html-to-markdown"},
		{NodeTypeID: "apply-clipboard-write-text"},
	})
	if err != nil {
		t.Fatalf("ResolveStepDefaults returned error: %v", err)
	}
	result, err := ExecuteWorkflow(steps)
	if err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if !strings.Contains(result, "## Hi") || !strings.Contains(result, "**bit**") {
		t.Errorf("ExecuteWorkflow result = %q, want converted markdown", result)
	}
	if written != result {
		t.Errorf("apply-clipboard-write-text was called with %q, want it to match the returned markdown %q", written, result)
	}
}

func TestExecuteWorkflow_ClipboardHTMLToMarkdown_NoHTMLOnClipboard(t *testing.T) {
	withFakeClipboard(t, func() (string, error) {
		return "", errors.New("no HTML on clipboard")
	}, nil, nil)

	steps, err := ResolveStepDefaults([]Step{
		{NodeTypeID: "capture-clipboard-html"},
		{NodeTypeID: "process-html-to-markdown"},
		{NodeTypeID: "apply-clipboard-write-text"},
	})
	if err != nil {
		t.Fatalf("ResolveStepDefaults returned error: %v", err)
	}
	// Unlike internal/domain/runbook's soft-failure path (nil error,
	// friendly explanation), this prototype's executor surfaces a plain
	// error -- documented as a deliberate simplification in
	// ExecuteWorkflow's doc comment, confirmed here so it isn't mistaken
	// for a bug later.
	if _, err := ExecuteWorkflow(steps); err == nil {
		t.Fatal("ExecuteWorkflow with no clipboard HTML returned nil error, want an error (plain-error prototype behavior, unlike runbook's soft-failure)")
	}
}

func TestCapabilityMap(t *testing.T) {
	entries := CapabilityMap()
	if len(entries) == 0 {
		t.Fatal("CapabilityMap() returned no entries")
	}
	seen := make(map[string]bool)
	validApproach := map[Approach]bool{ApproachAdopt: true, ApproachBuild: true, ApproachMixed: true}
	validStatus := map[capabilities.Status]bool{
		capabilities.StatusLocked: true, capabilities.StatusOpen: true, capabilities.StatusParked: true,
	}
	for _, e := range entries {
		if e.ID == "" || e.Name == "" || e.WhatItDoes == "" {
			t.Errorf("capability map entry %+v has an empty ID/Name/WhatItDoes", e)
		}
		if seen[e.ID] {
			t.Errorf("duplicate capability map entry ID %q", e.ID)
		}
		seen[e.ID] = true
		if !validApproach[e.Approach] {
			t.Errorf("entry %q has invalid Approach %q", e.ID, e.Approach)
		}
		if !validStatus[e.Status] {
			t.Errorf("entry %q has invalid Status %q", e.ID, e.Status)
		}
		if e.ApproachDetail == "" || e.StatusDetail == "" {
			t.Errorf("entry %q has an empty ApproachDetail/StatusDetail", e.ID)
		}
	}
}
