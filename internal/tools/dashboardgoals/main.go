// Package main emits dashboard goal records from the local goal directory.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

type goalRecord struct {
	ID          string  `json:"id"`
	Status      *string `json:"status"`
	Date        *string `json:"date"`
	DefectClass *string `json:"defect_class"`
	Title       string  `json:"title"`
	Path        string  `json:"path"`
	Archived    bool    `json:"archived"`
	PRs         []any   `json:"prs"`
	Proof       []any   `json:"proof"`
	SpecRefs    []any   `json:"spec_refs"`
}

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintf(os.Stderr, "dashboardgoals: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string, out io.Writer) error {
	if len(args) != 1 {
		return errors.New("usage: dashboardgoals <goals-directory>")
	}

	goals, err := loadGoals(args[0])
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(out)
	encoder.SetEscapeHTML(false)
	return encoder.Encode(goals)
}

func loadGoals(goalsDir string) ([]goalRecord, error) {
	paths := make([]string, 0)
	err := filepath.WalkDir(goalsDir, func(path string, entry fs.DirEntry, walkErr error) error { // #nosec G703 -- the operator selects this read-only local records directory
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || entry.Name() == "BACKLOG.md" || filepath.Ext(entry.Name()) != ".md" {
			return nil
		}
		paths = append(paths, path)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("walk %s: %w", goalsDir, err)
	}
	sort.Strings(paths)

	goals := make([]goalRecord, 0, len(paths))
	for _, path := range paths {
		rel, err := filepath.Rel(goalsDir, path)
		if err != nil {
			return nil, fmt.Errorf("relative path for %s: %w", path, err)
		}
		rel = filepath.ToSlash(rel)
		raw, err := os.ReadFile(path) // #nosec G304 -- paths come from walking the operator-supplied goals directory
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", rel, err)
		}
		goal, err := parseGoal(rel, raw)
		if err != nil {
			return nil, err
		}
		goals = append(goals, goal)
	}
	return goals, nil
}

func parseGoal(path string, raw []byte) (goalRecord, error) {
	goal := goalRecord{
		Path:     path,
		Archived: strings.HasPrefix(path, "archive/"),
		PRs:      []any{},
		Proof:    []any{},
		SpecRefs: []any{},
	}

	frontmatter, body, declared, err := splitFrontmatter(string(raw))
	if err != nil {
		return goalRecord{}, fmt.Errorf("%s: %w", path, err)
	}
	goal.Title = firstTitle(body)
	if !declared {
		goal.ID = fallbackID(path)
		return goal, nil
	}

	fields, err := decodeFrontmatter(frontmatter)
	if err != nil {
		return goalRecord{}, fmt.Errorf("%s: parse frontmatter: %w", path, err)
	}
	goal.ID, err = scalarField(fields, "id")
	if err != nil {
		return goalRecord{}, fmt.Errorf("%s: %w", path, err)
	}
	if goal.ID == "" {
		goal.ID = fallbackID(path)
	}
	if goal.Status, err = optionalScalarField(fields, "status"); err != nil {
		return goalRecord{}, fmt.Errorf("%s: %w", path, err)
	}
	if goal.Date, err = optionalScalarField(fields, "date"); err != nil {
		return goalRecord{}, fmt.Errorf("%s: %w", path, err)
	}
	if goal.DefectClass, err = optionalScalarField(fields, "defect_class"); err != nil {
		return goalRecord{}, fmt.Errorf("%s: %w", path, err)
	}
	if goal.PRs, err = listField(fields, "prs"); err != nil {
		return goalRecord{}, fmt.Errorf("%s: %w", path, err)
	}
	if goal.Proof, err = listField(fields, "proof"); err != nil {
		return goalRecord{}, fmt.Errorf("%s: %w", path, err)
	}
	if goal.SpecRefs, err = listField(fields, "spec_refs"); err != nil {
		return goalRecord{}, fmt.Errorf("%s: %w", path, err)
	}
	return goal, nil
}

func splitFrontmatter(source string) (frontmatter, body string, declared bool, err error) {
	normalized := strings.ReplaceAll(source, "\r\n", "\n")
	lines := strings.Split(normalized, "\n")
	if len(lines) == 0 || lines[0] != "---" {
		return "", normalized, false, nil
	}
	for i := 1; i < len(lines); i++ {
		if lines[i] == "---" {
			return strings.Join(lines[1:i], "\n"), strings.Join(lines[i+1:], "\n"), true, nil
		}
	}
	return "", "", true, errors.New("frontmatter opened with --- but never closed")
}

func decodeFrontmatter(source string) (map[string]yaml.Node, error) {
	if strings.TrimSpace(source) == "" {
		return map[string]yaml.Node{}, nil
	}

	var document yaml.Node
	if err := yaml.NewDecoder(strings.NewReader(source)).Decode(&document); err != nil {
		return nil, err
	}
	if len(document.Content) != 1 {
		return nil, errors.New("frontmatter must be a mapping")
	}
	root := dereference(document.Content[0])
	if root.Kind != yaml.MappingNode {
		return nil, errors.New("frontmatter must be a mapping")
	}

	fields := make(map[string]yaml.Node, len(root.Content)/2)
	if err := root.Decode(&fields); err != nil {
		return nil, err
	}
	return fields, nil
}

func scalarField(fields map[string]yaml.Node, key string) (string, error) {
	value, err := optionalScalarField(fields, key)
	if err != nil || value == nil {
		return "", err
	}
	return *value, nil
}

func optionalScalarField(fields map[string]yaml.Node, key string) (*string, error) {
	node, ok := fields[key]
	if !ok {
		return nil, nil
	}
	resolved := dereference(&node)
	if resolved.Tag == "!!null" {
		return nil, nil
	}
	if resolved.Kind != yaml.ScalarNode {
		return nil, fmt.Errorf("field %q must be a scalar or null", key)
	}
	value := resolved.Value
	return &value, nil
}

func listField(fields map[string]yaml.Node, key string) ([]any, error) {
	node, ok := fields[key]
	if !ok {
		return []any{}, nil
	}
	resolved := dereference(&node)
	if resolved.Tag == "!!null" {
		return []any{}, nil
	}
	if resolved.Kind != yaml.SequenceNode {
		return nil, fmt.Errorf("field %q must be a list or null", key)
	}
	values := make([]any, 0, len(resolved.Content))
	for _, item := range resolved.Content {
		item = dereference(item)
		if item.Kind != yaml.ScalarNode {
			return nil, fmt.Errorf("field %q list items must be scalars", key)
		}
		var value any
		if err := item.Decode(&value); err != nil {
			return nil, fmt.Errorf("decode field %q list item: %w", key, err)
		}
		values = append(values, value)
	}
	return values, nil
}

func dereference(node *yaml.Node) *yaml.Node {
	for node != nil && node.Kind == yaml.AliasNode {
		node = node.Alias
	}
	return node
}

func fallbackID(path string) string {
	base := filepath.Base(path)
	if dash := strings.IndexByte(base, '-'); dash >= 0 {
		return base[:dash]
	}
	return base
}

func firstTitle(body string) string {
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSuffix(line, "\r")
		if strings.HasPrefix(line, "# ") {
			return strings.TrimPrefix(line, "# ")
		}
	}
	return ""
}
