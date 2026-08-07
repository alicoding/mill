// Package expression wraps expr-lang/expr behind Mill's own names, per
// CLAUDE.md's ports/adapters rule for commodity libraries. Callers never
// import the underlying expression-evaluation library directly. Already
// named as the pick for Decision-node condition evaluation in
// docs/SPEC.md §3.3 (MIT, sandboxed/side-effect-free/loop-bounded by
// design) before this adapter existed to wrap it.
package expression

import "github.com/expr-lang/expr"

// Compile checks that source is a valid boolean expression against env
// (a realistic, zero-valued sample of the variables it may reference) --
// used at save time, so a bad condition is caught before it's ever run.
func Compile(source string, env map[string]any) error {
	_, err := expr.Compile(source, expr.Env(env), expr.AsBool())
	return err
}

// Eval compiles and runs source against env, returning its boolean
// result -- used at run time, once per Decision edge evaluated.
func Eval(source string, env map[string]any) (bool, error) {
	program, err := expr.Compile(source, expr.Env(env), expr.AsBool())
	if err != nil {
		return false, err
	}
	result, err := expr.Run(program, env)
	if err != nil {
		return false, err
	}
	matched, _ := result.(bool)
	return matched, nil
}
