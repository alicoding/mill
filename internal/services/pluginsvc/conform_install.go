package pluginsvc

import (
	"fmt"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// The static checks an install runs over the extracted folder before
// the plugin is enabled (docs/goals/0349 S6, standard rules 24-26):
// code that builds code at run time is refused, a literal address whose
// host the manifest never declared is refused, and code Mill cannot
// read easily is flagged for the person to weigh. The same checks run
// in the command-line conformance tool, so an author meets them before
// a user does.
//
// Vendored code (a vendor/ directory) is held to the run-time-code rule
// like the plugin's own, but an address inside it warns rather than
// refuses: a bundled library's own CDN loader is reach the author did
// not write, and the standard's other code rules already treat vendor/
// as not the plugin's own copy.

// Thresholds for the obfuscation markers (rule 26).
const (
	minifiedScriptBytes = 50 << 10
	base64BlobBytes     = 8 << 10
	entropyLineChars    = 200
	entropyBitsPerChar  = 5.0
)

// unreadableCodeSentence is rule 26's one sentence, shown in the
// install prompt and on the Verification tab.
const unreadableCodeSentence = "Contains code Mill can't read easily."

var (
	newFunctionRe    = regexp.MustCompile(`\bnew\s+Function\s*\(`)
	remoteScriptRe   = regexp.MustCompile(`(?i)<script\b[^>]*\bsrc\s*=\s*["']?\s*https?:`)
	literalHostRe    = regexp.MustCompile(`(?i)\bhttps?://([A-Za-z0-9.-]+\.[A-Za-z0-9-]+|localhost|127\.0\.0\.1|\[::1\])(?::\d+)?`)
	sourceMapPragma  = "//# sourceMappingURL="
	namespaceHostSet = map[string]bool{"www.w3.org": true, "localhost": true, "127.0.0.1": true, "[::1]": true}
)

// shippedSource is one .js or .html file the folder ships.
type shippedSource struct {
	rel      string
	body     string
	vendored bool
}

// shippedSources lists every .js and .html file under dir, hidden and
// dependency directories excluded -- vendor/ INCLUDED, flagged. The
// walk PLANS and the reads follow, the same order CopyPluginFolder
// keeps: nothing is opened while the tree is still being read.
func shippedSources(dir string) []shippedSource {
	root, err := filepath.Abs(dir)
	if err != nil {
		return nil
	}
	rels := shippedRelPaths(root)
	out := make([]shippedSource, 0, len(rels))
	for _, rel := range rels {
		if src, ok := readShippedSource(root, rel); ok {
			out = append(out, src)
		}
	}
	return out
}

// shippedRelPaths is the walk's plan: the sorted relative path of
// every shipped code file, vendored or not.
func shippedRelPaths(root string) []string {
	var rels []string
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if d.IsDir() {
			if path != root && (strings.HasPrefix(d.Name(), ".") || d.Name() == "node_modules") {
				return filepath.SkipDir
			}
			return nil
		}
		ext := strings.ToLower(filepath.Ext(d.Name()))
		if ext != ".js" && ext != ".html" {
			return nil
		}
		if rel, relErr := filepath.Rel(root, path); relErr == nil {
			rels = append(rels, rel)
		}
		return nil
	})
	sort.Strings(rels)
	return rels
}

// readShippedSource reads one planned file, flagging it vendored when
// it lives under a vendor/ directory.
func readShippedSource(root, rel string) (shippedSource, bool) {
	raw, err := os.ReadFile(filepath.Join(root, rel)) // #nosec G304 -- rel came from this same folder's own walk
	if err != nil {
		return shippedSource{}, false
	}
	slash := filepath.ToSlash(rel)
	vendored := strings.HasPrefix(slash, "vendor/") || strings.Contains(slash, "/vendor/")
	return shippedSource{rel: slash, body: string(raw), vendored: vendored}, true
}

// InstallChecks runs the three rules over a folder and answers the
// refusals (rules 24 and 25) and the warnings (rule 26, and a vendored
// file's undeclared address) with the rule number each names.
func InstallChecks(dir string, m Manifest) (refusals, warnings []string) {
	for _, src := range shippedSources(dir) {
		refusals = append(refusals, runtimeCodeProblems(src)...)
		reach, vendorReach := undeclaredHosts(src, m.Contributes.Network)
		refusals = append(refusals, reach...)
		warnings = append(warnings, vendorReach...)
		if strings.HasSuffix(src.rel, ".js") && unreadableCode(src.body) {
			warnings = append(warnings, fmt.Sprintf("standard rule 26: %s: %s", src.rel, unreadableCodeSentence))
		}
	}
	sort.Strings(refusals)
	sort.Strings(warnings)
	return refusals, warnings
}

// runtimeCodeProblems is rule 24: eval, new Function, import() of an
// address, and a script tag loading from the web.
func runtimeCodeProblems(src shippedSource) []string {
	var problems []string
	if strings.HasSuffix(src.rel, ".js") {
		if countBareCalls(src.body, evalTokenRe, "") > 0 {
			problems = append(problems, fmt.Sprintf("standard rule 24: %s: builds code at run time with eval", src.rel))
		}
		if newFunctionRe.MatchString(src.body) {
			problems = append(problems, fmt.Sprintf("standard rule 24: %s: builds code at run time with new Function", src.rel))
		}
		if dynImportURLRe.MatchString(src.body) {
			problems = append(problems, fmt.Sprintf("standard rule 24: %s: loads code from the web with import()", src.rel))
		}
	}
	if remoteScriptRe.MatchString(src.body) {
		problems = append(problems, fmt.Sprintf("standard rule 24: %s: loads a script from the web", src.rel))
	}
	return problems
}

// undeclaredHosts is rule 25: every literal http(s) address in code
// whose host the manifest's contributes.network does not cover. An
// address in a comment is documentation, not reach, and is skipped;
// the XML namespace host and loopback are identifiers, not reach.
func undeclaredHosts(src shippedSource, declared []NetworkContribution) (refusals, warnings []string) {
	seen := map[string]bool{}
	inBlock := false
	for _, line := range strings.Split(src.body, "\n") {
		var commented []bool
		commented, inBlock = commentMask(line, inBlock)
		for _, loc := range literalHostRe.FindAllStringSubmatchIndex(line, -1) {
			if commented[loc[0]] {
				continue
			}
			host := strings.ToLower(line[loc[2]:loc[3]])
			if seen[host] || namespaceHostSet[host] || hostDeclared(host, declared) {
				continue
			}
			seen[host] = true
			if src.vendored {
				warnings = append(warnings, fmt.Sprintf("standard rule 25: %s: its bundled code names %s", src.rel, host))
			} else {
				refusals = append(refusals, fmt.Sprintf("standard rule 25: %s: reaches %s without declaring it", src.rel, host))
			}
		}
	}
	return refusals, warnings
}

// commentMask marks which positions of a line sit inside a comment --
// after a // that is not a scheme's (the ":" before it tells the two
// apart), or inside a /* */ block, which may have opened on an earlier
// line. Answers the block state the next line starts in.
func commentMask(line string, inBlock bool) ([]bool, bool) {
	mask := make([]bool, len(line)+1)
	for i := 0; i < len(line); i++ {
		switch {
		case inBlock:
			mask[i] = true
			if line[i] == '*' && i+1 < len(line) && line[i+1] == '/' {
				mask[i+1] = true
				i++
				inBlock = false
			}
		case line[i] == '/' && i+1 < len(line) && line[i+1] == '*':
			inBlock = true
			mask[i] = true
		case line[i] == '/' && i+1 < len(line) && line[i+1] == '/' && (i == 0 || line[i-1] != ':'):
			for j := i; j <= len(line); j++ {
				mask[j] = true
			}
			return mask, inBlock
		}
	}
	return mask, inBlock
}

// hostDeclared honours the manifest's declaration: "*" covers every
// host, an exact host covers itself, and a "*.example.com" wildcard
// covers its subdomains.
func hostDeclared(host string, declared []NetworkContribution) bool {
	bare, _, _ := strings.Cut(host, ":")
	for _, n := range declared {
		d := strings.ToLower(strings.TrimSpace(n.Host))
		dBare, _, _ := strings.Cut(d, ":")
		switch {
		case d == AnyHost:
			return true
		case dBare == bare:
			return true
		case strings.HasPrefix(dBare, "*."):
			suffix := dBare[1:]
			if strings.HasSuffix(bare, suffix) || bare == dBare[2:] {
				return true
			}
		}
	}
	return false
}

// unreadableCode is rule 26's three markers, any one of which flags
// the file: a large script with no source map, a base64 blob, or a
// long line of near-random characters.
func unreadableCode(body string) bool {
	if len(body) > minifiedScriptBytes && !strings.Contains(body, sourceMapPragma) {
		return true
	}
	if longestBase64Run(body) >= base64BlobBytes {
		return true
	}
	for _, line := range strings.Split(body, "\n") {
		if len(line) >= entropyLineChars && shannonEntropy(line) > entropyBitsPerChar {
			return true
		}
	}
	return false
}

// longestBase64Run is the length of the longest unbroken run of
// base64-alphabet bytes -- an embedded blob's signature.
func longestBase64Run(body string) int {
	longest, run := 0, 0
	for i := 0; i < len(body); i++ {
		c := body[i]
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '+' || c == '/' {
			run++
			if run > longest {
				longest = run
			}
			continue
		}
		run = 0
	}
	return longest
}

// shannonEntropy is the bits per byte of the string's byte
// distribution.
func shannonEntropy(s string) float64 {
	if s == "" {
		return 0
	}
	var counts [256]int
	for i := 0; i < len(s); i++ {
		counts[s[i]]++
	}
	total := float64(len(s))
	entropy := 0.0
	for _, c := range counts {
		if c == 0 {
			continue
		}
		p := float64(c) / total
		entropy -= p * math.Log2(p)
	}
	return entropy
}
