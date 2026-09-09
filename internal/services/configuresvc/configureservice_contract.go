package configuresvc

import "github.com/alicoding/mill/internal/contract"

// Registers this package's exported* envelope shapes with
// internal/contract at process start -- same registration pattern and
// reasoning as compositionsvc's own (compositionservice_contract.go,
// ADR-0036 decision 1). "steptype" is goal 0054 slice A's family
// (ADR-0037): declared step types join the contract the same way
// every other Configure entity does. "secretsource" is goal 0408 S3's
// source-DEFINITION envelope -- kind/label/path only, never a value.
func init() {
	contract.Register("request", exportedHTTPRequest{})
	contract.Register("list", exportedList{})
	contract.Register("mcpserver", exportedMCPServer{})
	contract.Register("decision", exportedDecision{})
	contract.Register("aiprovider", exportedAIProvider{})
	contract.Register("execenv", exportedExecEnv{})
	contract.Register("environment", exportedEnvironment{})
	contract.Register("steptype", exportedDeclaredStepType{})
	contract.Register("secretsource", exportedSecretSource{})
}
