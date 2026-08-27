package composition

import "testing"

// Exhaustive table tests for ParseShellCommandBlock (docs/goals/0240
// S1's own "GO" directive: a pure, exhaustively-tested parser so real
// captured blocks can be added as fixtures later). Each case names the
// shell shape it pins down, not a discovery story (.claude/rules/
// comments.md).
func TestParseShellCommandBlock(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  []ParsedCommandStep
	}{
		{
			name:  "single command",
			input: `curl -I https://example.com`,
			want: []ParsedCommandStep{
				{Index: 0, Text: `curl -I https://example.com`, Join: JoinNone},
			},
		},
		{
			name:  "pipeline stays one step",
			input: `curl -sS https://example.com | grep -i status`,
			want: []ParsedCommandStep{
				{Index: 0, Text: `curl -sS https://example.com | grep -i status`, Join: JoinNone},
			},
		},
		{
			name:  "newline-separated commands are separate steps",
			input: "echo one\necho two\necho three",
			want: []ParsedCommandStep{
				{Index: 0, Text: "echo one", Join: JoinNone},
				{Index: 1, Text: "echo two", Join: JoinNewline},
				{Index: 2, Text: "echo three", Join: JoinNewline},
			},
		},
		{
			name:  "&& separated commands are separate steps",
			input: `mkdir -p out && cd out && ls`,
			want: []ParsedCommandStep{
				{Index: 0, Text: "mkdir -p out", Join: JoinNone},
				{Index: 1, Text: "cd out", Join: JoinAnd},
				{Index: 2, Text: "ls", Join: JoinAnd},
			},
		},
		{
			name:  "mixed newline and &&",
			input: "echo start\nmkdir -p out && cd out\necho done",
			want: []ParsedCommandStep{
				{Index: 0, Text: "echo start", Join: JoinNone},
				{Index: 1, Text: "mkdir -p out", Join: JoinNewline},
				{Index: 2, Text: "cd out", Join: JoinAnd},
				{Index: 3, Text: "echo done", Join: JoinNewline},
			},
		},
		{
			name:  "pipeline inside a step split by &&",
			input: `curl -sS https://a | jq .status && echo ok`,
			want: []ParsedCommandStep{
				{Index: 0, Text: `curl -sS https://a | jq .status`, Join: JoinNone},
				{Index: 1, Text: "echo ok", Join: JoinAnd},
			},
		},
		{
			name:  "blank lines are dropped, first real step still JoinNone",
			input: "\n\necho a\n\n\necho b\n",
			want: []ParsedCommandStep{
				{Index: 0, Text: "echo a", Join: JoinNone},
				{Index: 1, Text: "echo b", Join: JoinNewline},
			},
		},
		{
			name:  "&& inside a single-quoted string does not split",
			input: `echo 'a && b'`,
			want: []ParsedCommandStep{
				{Index: 0, Text: `echo 'a && b'`, Join: JoinNone},
			},
		},
		{
			name:  "&& inside a double-quoted string does not split",
			input: `echo "a && b"`,
			want: []ParsedCommandStep{
				{Index: 0, Text: `echo "a && b"`, Join: JoinNone},
			},
		},
		{
			name:  "newline inside a double-quoted string does not split",
			input: "echo \"line one\nline two\"",
			want: []ParsedCommandStep{
				{Index: 0, Text: "echo \"line one\nline two\"", Join: JoinNone},
			},
		},
		{
			name:  "escaped double-quote inside a double-quoted string does not close it",
			input: `echo "a \" && b"`,
			want: []ParsedCommandStep{
				{Index: 0, Text: `echo "a \" && b"`, Join: JoinNone},
			},
		},
		{
			name:  "&& inside a subshell does not split",
			input: `echo $(true && echo inner)`,
			want: []ParsedCommandStep{
				{Index: 0, Text: `echo $(true && echo inner)`, Join: JoinNone},
			},
		},
		{
			name:  "newline inside a subshell does not split",
			input: "echo $(echo a\necho b)",
			want: []ParsedCommandStep{
				{Index: 0, Text: "echo $(echo a\necho b)", Join: JoinNone},
			},
		},
		{
			name:  "trailing backslash-newline is a line continuation, not a split",
			input: "curl -sS \\\n  -H \"Accept: json\" \\\n  https://example.com",
			want: []ParsedCommandStep{
				{Index: 0, Text: "curl -sS \\\n  -H \"Accept: json\" \\\n  https://example.com", Join: JoinNone},
			},
		},
		{
			name:  "CRLF line endings normalize to newline splits",
			input: "echo one\r\necho two",
			want: []ParsedCommandStep{
				{Index: 0, Text: "echo one", Join: JoinNone},
				{Index: 1, Text: "echo two", Join: JoinNewline},
			},
		},
		{
			name:  "semicolon is not a step separator in S1 (stays inside its segment)",
			input: `echo a; echo b`,
			want: []ParsedCommandStep{
				{Index: 0, Text: `echo a; echo b`, Join: JoinNone},
			},
		},
		{
			name:  "empty input yields no steps",
			input: "",
			want:  []ParsedCommandStep{},
		},
		{
			name:  "whitespace-only input yields no steps",
			input: "   \n  \n",
			want:  []ParsedCommandStep{},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ParseShellCommandBlock(tc.input)
			if len(got) != len(tc.want) {
				t.Fatalf("step count = %d, want %d (got %+v)", len(got), len(tc.want), got)
			}
			for i := range got {
				if got[i].Text != tc.want[i].Text {
					t.Errorf("step %d Text = %q, want %q", i, got[i].Text, tc.want[i].Text)
				}
				if got[i].Join != tc.want[i].Join {
					t.Errorf("step %d Join = %q, want %q", i, got[i].Join, tc.want[i].Join)
				}
				if got[i].Index != tc.want[i].Index {
					t.Errorf("step %d Index = %d, want %d", i, got[i].Index, tc.want[i].Index)
				}
			}
		})
	}
}

func TestLooksLikeSecretPlaceholder(t *testing.T) {
	cases := []struct {
		name string
		text string
		want bool
	}{
		{"angle-bracket token placeholder", `curl -H "Authorization: Bearer <YOUR_TOKEN>"`, true},
		{"shouty YOUR_ prefix", `export API_KEY=YOUR_API_KEY_HERE`, true},
		{"unresolved shell secret var", `curl -H "Authorization: Bearer ${API_SECRET}"`, true},
		{"a real command with no placeholder", `curl -I https://example.com`, false},
		{"lowercase token word is not flagged", `curl -H "X-Request-Token: abc123"`, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := looksLikeSecretPlaceholder(tc.text); got != tc.want {
				t.Errorf("looksLikeSecretPlaceholder(%q) = %v, want %v", tc.text, got, tc.want)
			}
		})
	}
}
