package composition

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
)

const aiProviderTextSampleOutputContract = "mill.ai.text-output.v1"

// AIProviderSampleOutputContractDigest hashes the exact output contract used
// by one sample AI node. Structured nodes reuse their existing schema builders
// so this cannot drift into a second schema implementation.
func AIProviderSampleOutputContractDigest(node Node) (string, error) {
	var contract []byte
	switch node.NodeTypeID {
	case "process-ai-completion":
		contract = []byte(aiProviderTextSampleOutputContract)
	case "process-ai-extract-structured":
		fields, err := parseAIExtractFields(node.Config["outputFields"])
		if err != nil {
			return "", fmt.Errorf("process-ai-extract-structured: %w", err)
		}
		if len(fields) == 0 {
			return "", fmt.Errorf("process-ai-extract-structured: no output fields configured")
		}
		contract, err = buildExtractSchema(fields)
		if err != nil {
			return "", fmt.Errorf("process-ai-extract-structured: build schema: %w", err)
		}
	case "process-ai-classify":
		categories := parseAIClassifyCategories(node.Config["categories"])
		if len(categories) == 0 {
			return "", fmt.Errorf("process-ai-classify: no categories configured")
		}
		contract = buildClassifySchema(categories)
	default:
		return "", fmt.Errorf("node type %q has no AI provider sample output contract", node.NodeTypeID)
	}
	sum := sha256.Sum256(contract)
	return hex.EncodeToString(sum[:]), nil
}
