package configuresvc

import "github.com/alicoding/mill/internal/contract"

// Registers this package's seven exported* envelope shapes with
// internal/contract at process start -- same registration pattern and
// reasoning as compositionsvc's own (compositionservice_contract.go,
// ADR-0036 decision 1). "steptype" is goal 0054 slice A's new family
// (ADR-0037): declared step types join the contract the same way
// every other Configure entity does.
func init() {
	contract.Register("request", exportedHTTPRequest{})
	contract.Register("list", exportedList{})
	contract.Register("mcpserver", exportedMCPServer{})
	contract.Register("decision", exportedDecision{})
	contract.Register("aiprovider", exportedAIProvider{})
	contract.Register("execenv", exportedExecEnv{})
	contract.Register("steptype", exportedDeclaredStepType{})
}
