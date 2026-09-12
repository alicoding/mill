package executionsvc

import (
	"sort"
	"strconv"

	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/domain/composition"
)

type providerUsageScan struct {
	runs          map[string]struct{}
	workflows     map[string]struct{}
	indeterminate bool
	queryErr      error
}

func newProviderUsageScan() providerUsageScan {
	return providerUsageScan{runs: make(map[string]struct{}), workflows: make(map[string]struct{})}
}

func (s providerUsageScan) confirmed() bool { return len(s.runs) > 0 }

func (s providerUsageScan) runIDs() []string      { return sortedKeys(s.runs) }
func (s providerUsageScan) workflowIDs() []string { return sortedKeys(s.workflows) }

func sortedKeys(values map[string]struct{}) []string {
	out := make([]string, 0, len(values))
	for value := range values {
		if value != "" {
			out = append(out, value)
		}
	}
	sort.Strings(out)
	return out
}

func (e *ExecutionService) scanAIProviderUsage(providerID string) providerUsageScan {
	scan := newProviderUsageScan()
	catalog := newProviderDependencyCatalog()
	statuses, err := execution.ListWorkflows(e.ctx,
		execution.WithFilterStatus(
			execution.WorkflowStatusPending,
			execution.WorkflowStatusEnqueued,
			execution.WorkflowStatusDelayed,
		),
		execution.WithFilterLoadInput(true),
		execution.WithFilterLoadOutput(false),
	)
	if err != nil {
		scan.queryErr = err
	} else {
		for _, status := range statuses {
			input, ok := decodeAny[runInput](status.Input)
			if !ok || !validPersistedRunInput(input) {
				scan.indeterminate = true
				continue
			}
			scan.add(status.ID, e.providerDependency(input, providerID, catalog))
		}
	}

	e.aiProviderMutation.mu.Lock()
	live := make(map[string]runInput, len(e.aiProviderMutation.live))
	for runID, body := range e.aiProviderMutation.live {
		live[runID] = body.input
	}
	e.aiProviderMutation.mu.Unlock()
	for runID, input := range live {
		scan.add(runID, e.providerDependency(input, providerID, catalog))
	}
	return scan
}

func validPersistedRunInput(input runInput) bool {
	if input.WorkflowID == "" || len(input.Nodes) == 0 || input.Version < 0 {
		return false
	}
	switch input.Kind {
	case RunKindTest, RunKindTriggered, RunKindMCP:
	default:
		return false
	}
	for _, node := range input.Nodes {
		if node.ID == "" || node.NodeTypeID == "" {
			return false
		}
	}
	return true
}

func (s *providerUsageScan) add(runID string, dependency providerDependency) {
	if dependency.usesProvider {
		s.runs[runID] = struct{}{}
		for workflowID := range dependency.workflows {
			s.workflows[workflowID] = struct{}{}
		}
	}
	s.indeterminate = s.indeterminate || dependency.indeterminate
}

type providerDependency struct {
	usesProvider  bool
	indeterminate bool
	workflows     map[string]struct{}
}

func newProviderDependency() providerDependency {
	return providerDependency{workflows: make(map[string]struct{})}
}

func (d *providerDependency) merge(other providerDependency) {
	d.usesProvider = d.usesProvider || other.usesProvider
	d.indeterminate = d.indeterminate || other.indeterminate
	for workflowID := range other.workflows {
		d.workflows[workflowID] = struct{}{}
	}
}

type providerDependencyCatalog struct {
	types     map[string]composition.NodeType
	ambiguous map[string]struct{}
}

func newProviderDependencyCatalog() providerDependencyCatalog {
	catalog := providerDependencyCatalog{
		types: make(map[string]composition.NodeType), ambiguous: make(map[string]struct{}),
	}
	for _, nodeType := range composition.NodeTypes() {
		if _, exists := catalog.types[nodeType.ID]; exists {
			catalog.ambiguous[nodeType.ID] = struct{}{}
			continue
		}
		catalog.types[nodeType.ID] = nodeType
	}
	return catalog
}

func (e *ExecutionService) providerDependency(input runInput, providerID string, catalog providerDependencyCatalog) providerDependency {
	return e.providerDependencyInNodes(input.WorkflowID, input.Nodes, providerID, catalog, make(map[string]struct{}))
}

func (e *ExecutionService) providerDependencyInNodes(
	workflowID string,
	nodes []composition.Node,
	providerID string,
	catalog providerDependencyCatalog,
	visited map[string]struct{},
) providerDependency {
	result := newProviderDependency()
	for _, node := range nodes {
		result.merge(e.providerDependencyForNode(workflowID, node, providerID, catalog, visited))
	}
	return result
}

func (e *ExecutionService) providerDependencyForNode(
	workflowID string,
	node composition.Node,
	providerID string,
	catalog providerDependencyCatalog,
	visited map[string]struct{},
) providerDependency {
	result := newProviderDependency()
	nodeType, known := catalog.types[node.NodeTypeID]
	_, duplicate := catalog.ambiguous[node.NodeTypeID]
	if !known || duplicate {
		result.indeterminate = true
		return result
	}
	// A declared type may hide its pinned engine reference from the public
	// ConfigFields projection, so its stored node is not complete evidence.
	result.indeterminate = nodeType.Declared
	for _, field := range nodeType.ConfigFields {
		value := node.Config[field.Key]
		if _, present := node.Config[field.Key]; !present {
			value = field.Default
		}
		result.merge(e.providerDependencyForField(
			workflowID, node, nodeType, field.Key, field.RefKind, value, providerID, catalog, visited,
		))
	}
	return result
}

func (e *ExecutionService) providerDependencyForField(
	workflowID string,
	node composition.Node,
	nodeType composition.NodeType,
	fieldKey, refKind, value, providerID string,
	catalog providerDependencyCatalog,
	visited map[string]struct{},
) providerDependency {
	result := newProviderDependency()
	switch refKind {
	case "aiprovider":
		if value == providerID && value != "" {
			result.usesProvider = true
			if workflowID != "" {
				result.workflows[workflowID] = struct{}{}
			}
		}
	case "workflow":
		result = e.pinnedChildProviderDependency(node, nodeType, fieldKey, value, providerID, catalog, visited)
	}
	return result
}

func (e *ExecutionService) pinnedChildProviderDependency(
	node composition.Node,
	nodeType composition.NodeType,
	fieldKey, workflowID, providerID string,
	catalog providerDependencyCatalog,
	visited map[string]struct{},
) providerDependency {
	result := newProviderDependency()
	// Only today's child-workflow descriptor has a source-proven version
	// pin. A future workflow-bearing node may resolve its target dynamically.
	if nodeType.ID != "child-workflow" || fieldKey != "workflowId" || workflowID == "" {
		result.indeterminate = true
		return result
	}
	pinnedVersion, err := strconv.Atoi(node.Config["version"])
	if err != nil || pinnedVersion <= 0 {
		result.indeterminate = true
		return result
	}
	visitKey := workflowID + "@" + strconv.Itoa(pinnedVersion)
	if _, seen := visited[visitKey]; seen {
		return result
	}
	visited[visitKey] = struct{}{}

	wf, ok := e.findWorkflow(workflowID)
	if !ok {
		result.indeterminate = true
		return result
	}
	nodes, _, _, _, err := composition.ResolveRunnable(wf, false, pinnedVersion)
	if err != nil {
		result.indeterminate = true
		return result
	}
	return e.providerDependencyInNodes(workflowID, nodes, providerID, catalog, visited)
}
