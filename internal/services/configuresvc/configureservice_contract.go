package configuresvc

import "github.com/alicoding/mill/internal/contract"

// Registers this package's six exported* envelope shapes with
// internal/contract at process start -- same registration pattern and
// reasoning as compositionsvc's own (compositionservice_contract.go,
// ADR-0036 decision 1).
func init() {
	contract.Register("request", exportedHTTPRequest{})
	contract.Register("list", exportedList{})
	contract.Register("mcpserver", exportedMCPServer{})
	contract.Register("decision", exportedDecision{})
	contract.Register("aiprovider", exportedAIProvider{})
	contract.Register("execenv", exportedExecEnv{})
}
