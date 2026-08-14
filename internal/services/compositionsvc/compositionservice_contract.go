package compositionsvc

import "github.com/alicoding/mill/internal/contract"

// Registers exportedWorkflow's shape with internal/contract at process
// start (ADR-0036 decision 1) -- the generator and its drift test
// reflect this without importing compositionsvc's Wails-bound service
// surface, keeping the import direction one-way (contract never
// imports a service package).
func init() {
	contract.Register("workflow", exportedWorkflow{})
}
