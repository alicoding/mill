package mcpserver

import "testing"

func valid() MCPServer {
	return MCPServer{ID: "s1", Label: "My MCP Server", Command: "my-mcp-server", Args: []string{"--flag"}}
}

func TestValidate_Accepts(t *testing.T) {
	if err := Validate(valid()); err != nil {
		t.Errorf("Validate(valid server) returned error: %v", err)
	}
}

func TestValidate_EmptyLabel_Rejected(t *testing.T) {
	s := valid()
	s.Label = "  "
	if err := Validate(s); err == nil {
		t.Error("Validate with an empty label returned nil error, want an error")
	}
}

func TestValidate_EmptyCommand_Rejected(t *testing.T) {
	s := valid()
	s.Command = ""
	if err := Validate(s); err == nil {
		t.Error("Validate with an empty command returned nil error, want an error")
	}
}

func TestValidate_NoArgs_Accepted(t *testing.T) {
	s := valid()
	s.Args = nil
	if err := Validate(s); err != nil {
		t.Errorf("Validate with no args returned error: %v, want nil -- args are optional", err)
	}
}
