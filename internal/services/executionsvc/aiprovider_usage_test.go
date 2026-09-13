package executionsvc

import (
	"strconv"
	"testing"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

func TestProviderDependencyUsesRegisteredNodeDescriptor(t *testing.T) {
	e := &ExecutionService{}
	dependency := e.providerDependency(runInput{
		WorkflowID: "workflow-1",
		Nodes: []composition.Node{{
			ID: "ai", NodeTypeID: "process-ai-completion",
			Config: map[string]string{"aiproviderId": "provider-1"},
		}},
		Kind: RunKindTest,
	}, "provider-1", newProviderDependencyCatalog())
	if !dependency.usesProvider || dependency.indeterminate {
		t.Fatalf("dependency = %+v, want confirmed provider use", dependency)
	}
	if _, ok := dependency.workflows["workflow-1"]; !ok {
		t.Fatalf("workflows = %v, want workflow-1", dependency.workflows)
	}
}

func TestProviderDependencyPinnedChildScansImmutableVersion(t *testing.T) {
	comp := compositionsvc.NewCompositionService(servicetest.NewFakeStore())
	child, err := comp.CreateWorkflow("Pinned AI child", "", []composition.Node{
		{ID: "trigger", NodeTypeID: "trigger-callable"},
		{ID: "ai", NodeTypeID: "process-ai-completion", Config: map[string]string{"aiproviderId": "provider-1"}},
	}, []composition.Edge{{ID: "edge", Source: "trigger", Target: "ai"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	published, err := comp.PublishWorkflow(child.ID)
	if err != nil {
		t.Fatalf("PublishWorkflow: %v", err)
	}

	e := &ExecutionService{comp: comp}
	dependency := e.providerDependency(runInput{
		WorkflowID: "parent",
		Nodes: []composition.Node{{
			ID: "child", NodeTypeID: "child-workflow",
			Config: map[string]string{
				"workflowId": child.ID,
				"version":    strconv.Itoa(published.PublishedVersion),
			},
		}},
		Kind: RunKindTest,
	}, "provider-1", newProviderDependencyCatalog())
	if !dependency.usesProvider || dependency.indeterminate {
		t.Fatalf("dependency = %+v, want confirmed pinned-child provider use", dependency)
	}
	if _, ok := dependency.workflows[child.ID]; !ok {
		t.Fatalf("workflows = %v, want child workflow %q", dependency.workflows, child.ID)
	}
}

func TestProviderDependencyDynamicChildIsIndeterminate(t *testing.T) {
	e := &ExecutionService{}
	dependency := e.providerDependency(runInput{
		WorkflowID: "parent",
		Nodes: []composition.Node{{
			ID: "child", NodeTypeID: "child-workflow",
			Config: map[string]string{"workflowId": "future-child", "version": ""},
		}},
		Kind: RunKindTest,
	}, "provider-1", newProviderDependencyCatalog())
	if !dependency.indeterminate || dependency.usesProvider {
		t.Fatalf("dependency = %+v, want indeterminate dynamic child", dependency)
	}
}

func TestProviderDependencyDeclaredChildIsIndeterminateWhenBindingIsHidden(t *testing.T) {
	composition.SetDeclaredNodeTypeLookup(func() []composition.DeclaredStepBinding {
		return []composition.DeclaredStepBinding{{
			ID: "declared-child", Label: "Declared child", PaletteGroup: "flow",
			EngineNodeTypeID: "child-workflow",
			PinnedConfig:     map[string]string{"workflowId": "hidden-child", "version": "1"},
			HiddenFields:     []string{"workflowId", "version"},
		}}
	})
	t.Cleanup(func() { composition.SetDeclaredNodeTypeLookup(nil) })

	e := &ExecutionService{}
	dependency := e.providerDependency(runInput{
		WorkflowID: "parent",
		Nodes:      []composition.Node{{ID: "declared", NodeTypeID: "declared-child", Config: map[string]string{}}},
		Kind:       RunKindTest,
	}, "provider-1", newProviderDependencyCatalog())
	if !dependency.indeterminate {
		t.Fatalf("dependency = %+v, want hidden declared binding to be indeterminate", dependency)
	}
}

func TestProviderDependencyUnknownNodeTypeIsIndeterminate(t *testing.T) {
	e := &ExecutionService{}
	dependency := e.providerDependency(runInput{
		WorkflowID: "legacy",
		Nodes:      []composition.Node{{ID: "unknown", NodeTypeID: "future-provider-step"}},
		Kind:       RunKindTest,
	}, "provider-1", newProviderDependencyCatalog())
	if !dependency.indeterminate {
		t.Fatalf("dependency = %+v, want an unknown node shape to be indeterminate", dependency)
	}
}

func TestValidPersistedRunInputRejectsUnreadableLegacyShapes(t *testing.T) {
	valid := runInput{
		WorkflowID: "workflow-1", Kind: RunKindTest,
		Nodes: []composition.Node{{ID: "step-1", NodeTypeID: "process-inject-text"}},
	}
	tests := map[string]runInput{
		"empty object":        {},
		"missing workflow ID": {Kind: valid.Kind, Nodes: valid.Nodes},
		"missing graph":       {WorkflowID: valid.WorkflowID, Kind: valid.Kind},
		"unknown run kind":    {WorkflowID: valid.WorkflowID, Kind: "legacy", Nodes: valid.Nodes},
		"missing node ID":     {WorkflowID: valid.WorkflowID, Kind: valid.Kind, Nodes: []composition.Node{{NodeTypeID: "process-inject-text"}}},
		"missing node type":   {WorkflowID: valid.WorkflowID, Kind: valid.Kind, Nodes: []composition.Node{{ID: "step-1"}}},
		"negative version":    {WorkflowID: valid.WorkflowID, Kind: valid.Kind, Nodes: valid.Nodes, Version: -1},
	}
	if !validPersistedRunInput(valid) {
		t.Fatal("valid current run input was rejected")
	}
	for name, input := range tests {
		t.Run(name, func(t *testing.T) {
			if validPersistedRunInput(input) {
				t.Fatalf("validPersistedRunInput(%+v) = true, want false", input)
			}
		})
	}
}
