package composition

import (
	"fmt"
	"sort"
	"strings"

	"github.com/alicoding/mill/internal/domain/environment"
)

// {{var}} interpolation (goal 0306 S5). One grammar, converged with
// the API clients this borrows from: a reference is "{{" + optional
// whitespace + an identifier + optional whitespace + "}}", and a
// backslash immediately before the opening braces makes them literal.
// Anything else -- an unclosed "{{", braces around something that is
// not an identifier -- is ordinary text and is left exactly as
// written, so a JSON body full of braces is never mangled by a feature
// it does not use.
//
// This file is pure: strings and maps in, strings and key names out.
// Which Environment a run selected, and what its secret variables
// resolve to, are the resolver's business one layer up
// (ResolvedEnvironment below is only the shape that crosses that
// seam).

const (
	varOpen  = "{{"
	varClose = "}}"
	varEsc   = `\{{`
)

// ResolvedEnvironment is an Environment's variables with every secret
// reference already resolved to its real value by whatever owns the
// secret store -- the same "composition never resolves a secret
// itself" boundary ResolvedMCPServer.Env and ResolvedHTTPRequest.
// Headers already state. Injected via SetEnvironmentLookup.
type ResolvedEnvironment struct {
	ID    string
	Label string
	// Vars is keyed by variable name; a secret variable with no
	// reference yet resolves to the empty string, never an error --
	// preflight is where a missing value is reported, not the send.
	Vars map[string]string
}

var lookupEnvironmentFn = func(environmentID string, _ SecretAccessRun) (ResolvedEnvironment, error) {
	return ResolvedEnvironment{}, fmt.Errorf("no environment lookup registered (yet) for id %q", environmentID)
}

// SetEnvironmentLookup wires the function a step uses to resolve the
// run's selected Environment into its variables. Called once from the
// composition root, same seam shape as SetHTTPRequestLookup.
func SetEnvironmentLookup(fn func(environmentID string, run SecretAccessRun) (ResolvedEnvironment, error)) {
	lookupEnvironmentFn = fn
}

// VarRefs lists, in first-appearance order and deduplicated, the
// variable names s references. An escaped `\{{NAME}}` is not a
// reference and is not listed.
func VarRefs(s string) []string {
	var out []string
	seen := map[string]bool{}
	scanVars(s, func(key string) string {
		if !seen[key] {
			seen[key] = true
			out = append(out, key)
		}
		return ""
	})
	return out
}

// Interpolate substitutes every {{name}} reference in s with vars[name]
// and returns the result plus the names it could not resolve, in
// first-appearance order and deduplicated. An unresolved reference is
// left in place verbatim so the caller can show what was written.
func Interpolate(s string, vars map[string]string) (string, []string) {
	var missing []string
	seen := map[string]bool{}
	out := scanVars(s, func(key string) string {
		if value, ok := vars[key]; ok {
			return value
		}
		if !seen[key] {
			seen[key] = true
			missing = append(missing, key)
		}
		return varOpen + key + varClose
	})
	return out, missing
}

// scanVars walks s once, handing each well-formed reference's name to
// replace and writing what it returns in the reference's place. It is
// the single definition of the grammar both VarRefs and Interpolate
// answer to -- two scanners would be two grammars.
func scanVars(s string, replace func(key string) string) string {
	var b strings.Builder
	for i := 0; i < len(s); {
		if strings.HasPrefix(s[i:], varEsc) {
			b.WriteString(varOpen)
			i += len(varEsc)
			continue
		}
		if !strings.HasPrefix(s[i:], varOpen) {
			b.WriteByte(s[i])
			i++
			continue
		}
		end := strings.Index(s[i+len(varOpen):], varClose)
		if end < 0 {
			// No closing braces anywhere after this point: the rest of
			// the string is literal, and re-scanning it would only find
			// the same non-reference again.
			b.WriteString(s[i:])
			break
		}
		inner := s[i+len(varOpen) : i+len(varOpen)+end]
		key := strings.TrimSpace(inner)
		if !environment.ValidKey(key) {
			b.WriteString(varOpen)
			i += len(varOpen)
			continue
		}
		b.WriteString(replace(key))
		i += len(varOpen) + end + len(varClose)
	}
	return b.String()
}

// InterpolateMap applies Interpolate across a map's VALUES, leaving
// keys untouched -- a header name is part of the request's contract,
// its value is the part a stage changes. nil in, nil out.
func InterpolateMap(m map[string]string, vars map[string]string) (map[string]string, []string) {
	if len(m) == 0 {
		return m, nil
	}
	out := make(map[string]string, len(m))
	var missing []string
	seen := map[string]bool{}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	// Sorted so the reported gap order is the same on every run: a map
	// walk is randomized in Go, and a preflight message that reorders
	// itself between two identical runs reads as a changing problem.
	sort.Strings(keys)
	for _, k := range keys {
		value, gaps := Interpolate(m[k], vars)
		out[k] = value
		for _, g := range gaps {
			if !seen[g] {
				seen[g] = true
				missing = append(missing, g)
			}
		}
	}
	return out, missing
}

// InterpolateRequest substitutes vars into every field of a resolved
// request that names WHERE or HOW a call goes out, and into nothing
// else. What is covered: the URL, the static body, every custom header
// value, and the plain-text half of the auth config (a token endpoint,
// a client id, a scope, a signature header name). What is deliberately
// not: any secret reference or resolved secret -- a secret is chosen
// through the store, and letting a variable name one would put a
// second, unaudited door on the same material.
//
// Auth and JOSE are copied before any field is written: the resolver
// on the other side of the lookup seam may hand back pointers into its
// own stored entity, and a run must never edit configuration.
func InterpolateRequest(rc ResolvedHTTPRequest, vars map[string]string) (ResolvedHTTPRequest, []string) {
	gaps := newGapSet()
	rc.BaseURL = gaps.apply(rc.BaseURL, vars)
	rc.Body = gaps.apply(rc.Body, vars)
	headers, missing := InterpolateMap(rc.Headers, vars)
	rc.Headers = headers
	gaps.add(missing)
	if rc.Auth != nil {
		auth := *rc.Auth
		if auth.OAuth2 != nil {
			o := *auth.OAuth2
			o.TokenURL = gaps.apply(o.TokenURL, vars)
			o.ClientID = gaps.apply(o.ClientID, vars)
			o.Scope = gaps.apply(o.Scope, vars)
			auth.OAuth2 = &o
		}
		if auth.HMAC != nil {
			h := *auth.HMAC
			h.HeaderName = gaps.apply(h.HeaderName, vars)
			auth.HMAC = &h
		}
		if auth.OAuth1 != nil {
			o := *auth.OAuth1
			o.ConsumerKey = gaps.apply(o.ConsumerKey, vars)
			o.Token = gaps.apply(o.Token, vars)
			auth.OAuth1 = &o
		}
		rc.Auth = &auth
	}
	return rc, gaps.list
}

// RequestVarRefs lists every variable name a resolved request
// references, across exactly the fields InterpolateRequest
// substitutes -- the preflight check and the send must agree on which
// text is templated, so both read this one answer.
func RequestVarRefs(rc ResolvedHTTPRequest) []string {
	gaps := newGapSet()
	gaps.add(VarRefs(rc.BaseURL))
	gaps.add(VarRefs(rc.Body))
	for _, v := range rc.Headers {
		gaps.add(VarRefs(v))
	}
	if rc.Auth != nil {
		if o := rc.Auth.OAuth2; o != nil {
			gaps.add(VarRefs(o.TokenURL))
			gaps.add(VarRefs(o.ClientID))
			gaps.add(VarRefs(o.Scope))
		}
		if h := rc.Auth.HMAC; h != nil {
			gaps.add(VarRefs(h.HeaderName))
		}
		if o := rc.Auth.OAuth1; o != nil {
			gaps.add(VarRefs(o.ConsumerKey))
			gaps.add(VarRefs(o.Token))
		}
	}
	return gaps.list
}

// gapSet accumulates unresolved (or referenced) variable names in
// first-appearance order without repeating one.
type gapSet struct {
	seen map[string]bool
	list []string
}

func newGapSet() *gapSet { return &gapSet{seen: map[string]bool{}} }

func (g *gapSet) add(keys []string) {
	for _, k := range keys {
		if g.seen[k] {
			continue
		}
		g.seen[k] = true
		g.list = append(g.list, k)
	}
}

func (g *gapSet) apply(s string, vars map[string]string) string {
	out, missing := Interpolate(s, vars)
	g.add(missing)
	return out
}

// runEnvironmentVars resolves the run's selected Environment into its
// variables. No environment selected is not an error here: pre-flight
// owns that refusal, and a step whose request references nothing has
// nothing to resolve.
func runEnvironmentVars(ctx ExecContext) (map[string]string, error) {
	if strings.TrimSpace(ctx.EnvironmentID) == "" {
		return nil, nil
	}
	env, err := lookupEnvironmentFn(ctx.EnvironmentID, secretAccessRunFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	return env.Vars, nil
}
