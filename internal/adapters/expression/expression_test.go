package expression

import "testing"

func TestCompile_ValidExpression(t *testing.T) {
	if err := Compile("count > 5", map[string]any{"count": 0.0}); err != nil {
		t.Errorf("Compile() error = %v, want nil", err)
	}
}

func TestCompile_InvalidSyntax(t *testing.T) {
	if err := Compile("count >", map[string]any{"count": 0.0}); err == nil {
		t.Error("Compile() with invalid syntax: want error, got nil")
	}
}

func TestCompile_UnknownVariable(t *testing.T) {
	if err := Compile("missing > 5", map[string]any{"count": 0.0}); err == nil {
		t.Error("Compile() referencing a variable not in env: want error, got nil")
	}
}

func TestCompile_TypeMismatch(t *testing.T) {
	// count is declared as a string in env; comparing it with > should
	// fail to compile, not just fail at run time.
	if err := Compile("count > 5", map[string]any{"count": ""}); err == nil {
		t.Error("Compile() comparing a string field with '>': want error, got nil")
	}
}

func TestEval_True(t *testing.T) {
	matched, err := Eval("count > 5", map[string]any{"count": 10.0})
	if err != nil {
		t.Fatalf("Eval() error: %v", err)
	}
	if !matched {
		t.Error("Eval() = false, want true")
	}
}

func TestEval_False(t *testing.T) {
	matched, err := Eval("count > 5", map[string]any{"count": 1.0})
	if err != nil {
		t.Fatalf("Eval() error: %v", err)
	}
	if matched {
		t.Error("Eval() = true, want false")
	}
}

func TestEval_StringComparison(t *testing.T) {
	matched, err := Eval(`status == "active"`, map[string]any{"status": "active"})
	if err != nil {
		t.Fatalf("Eval() error: %v", err)
	}
	if !matched {
		t.Error("Eval() = false, want true")
	}
}

func TestEval_InvalidExpression(t *testing.T) {
	if _, err := Eval("not valid ]]", map[string]any{}); err == nil {
		t.Error("Eval() with invalid expression: want error, got nil")
	}
}
