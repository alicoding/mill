package declaredsteptype

import "testing"

func validHTTP() DeclaredStepType {
	return DeclaredStepType{
		Label: "Check httpbin", PaletteGroup: GroupActions,
		Engine: EngineHTTP, RequestID: "example-none-httpbin",
	}
}

func TestValidate_ValidHTTPEngine_Accepted(t *testing.T) {
	if err := Validate(validHTTP()); err != nil {
		t.Errorf("Validate(valid http-engine declared step type) = %v, want nil", err)
	}
}

func TestValidate_ValidMCPEngine_Accepted(t *testing.T) {
	d := DeclaredStepType{
		Label: "Ping tool", PaletteGroup: GroupActions,
		Engine: EngineMCP, MCPServerID: "example-server", ToolName: "ping",
	}
	if err := Validate(d); err != nil {
		t.Errorf("Validate(valid mcp-engine declared step type) = %v, want nil", err)
	}
}

func TestValidate_ValidWorkflowEngine_Accepted(t *testing.T) {
	d := DeclaredStepType{
		Label: "Run child", PaletteGroup: GroupFlow,
		Engine: EngineWorkflow, WorkflowID: "example-child",
	}
	if err := Validate(d); err != nil {
		t.Errorf("Validate(valid workflow-engine declared step type) = %v, want nil", err)
	}
}

func TestValidate_EmptyLabel_Rejected(t *testing.T) {
	d := validHTTP()
	d.Label = "  "
	if err := Validate(d); err == nil {
		t.Error("Validate(empty label) = nil, want an error")
	}
}

func TestValidate_InvalidPaletteGroup_Rejected(t *testing.T) {
	d := validHTTP()
	d.PaletteGroup = "not-a-real-group"
	if err := Validate(d); err == nil {
		t.Error("Validate(invalid palette group) = nil, want an error")
	}
}

func TestValidate_InvalidEngine_Rejected(t *testing.T) {
	d := validHTTP()
	d.Engine = "not-a-real-engine"
	if err := Validate(d); err == nil {
		t.Error("Validate(invalid engine) = nil, want an error")
	}
}

func TestValidate_HTTPEngine_MissingRequestID_Rejected(t *testing.T) {
	d := validHTTP()
	d.RequestID = ""
	if err := Validate(d); err == nil {
		t.Error("Validate(http engine with no requestId) = nil, want an error")
	}
}

func TestValidate_HTTPEngine_AlsoCarryingMCPFields_Rejected(t *testing.T) {
	d := validHTTP()
	d.MCPServerID = "should-not-be-set"
	if err := Validate(d); err == nil {
		t.Error("Validate(http engine also carrying mcpServerId) = nil, want an error -- exactly one binding may be set")
	}
}

func TestValidate_MCPEngine_MissingToolName_Rejected(t *testing.T) {
	d := DeclaredStepType{Label: "x", PaletteGroup: GroupActions, Engine: EngineMCP, MCPServerID: "s"}
	if err := Validate(d); err == nil {
		t.Error("Validate(mcp engine with no toolName) = nil, want an error")
	}
}

func TestValidate_WorkflowEngine_MissingWorkflowID_Rejected(t *testing.T) {
	d := DeclaredStepType{Label: "x", PaletteGroup: GroupFlow, Engine: EngineWorkflow}
	if err := Validate(d); err == nil {
		t.Error("Validate(workflow engine with no workflowId) = nil, want an error")
	}
}

func TestEngineNodeTypeID_MapsEachEngineToItsRealNodeType(t *testing.T) {
	cases := []struct {
		engine Engine
		want   string
	}{
		{EngineHTTP, "integration-http"},
		{EngineMCP, "mcp-tool-call"},
		{EngineWorkflow, "child-workflow"},
	}
	for _, tc := range cases {
		got := DeclaredStepType{Engine: tc.engine}.EngineNodeTypeID()
		if got != tc.want {
			t.Errorf("EngineNodeTypeID() for %q = %q, want %q", tc.engine, got, tc.want)
		}
	}
}

func TestEngineFields_ReturnsTheEngineSpecificBindingKeys(t *testing.T) {
	http := DeclaredStepType{Engine: EngineHTTP, RequestID: "r1"}.EngineFields()
	if http["requestId"] != "r1" || len(http) != 1 {
		t.Errorf("EngineFields() for http engine = %v, want {requestId: r1}", http)
	}

	mcp := DeclaredStepType{Engine: EngineMCP, MCPServerID: "s1", ToolName: "t1"}.EngineFields()
	if mcp["mcpServerId"] != "s1" || mcp["toolName"] != "t1" || len(mcp) != 2 {
		t.Errorf("EngineFields() for mcp engine = %v, want {mcpServerId: s1, toolName: t1}", mcp)
	}

	wf := DeclaredStepType{Engine: EngineWorkflow, WorkflowID: "w1"}.EngineFields()
	if wf["workflowId"] != "w1" || len(wf) != 1 {
		t.Errorf("EngineFields() for workflow engine = %v, want {workflowId: w1}", wf)
	}
}

func TestBuiltIn_SeededExample_IsValid(t *testing.T) {
	for _, d := range BuiltIn() {
		if err := Validate(d); err != nil {
			t.Errorf("BuiltIn() example %q fails Validate: %v", d.ID, err)
		}
		if !d.BuiltIn {
			t.Errorf("BuiltIn() example %q has BuiltIn=false", d.ID)
		}
		if !d.Seed.IsSeeded() {
			t.Errorf("BuiltIn() example %q has no Seed provenance stamped", d.ID)
		}
	}
}
