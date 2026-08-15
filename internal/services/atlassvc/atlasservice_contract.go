package atlassvc

import "github.com/alicoding/mill/internal/contract"

// Registers Atlas's one exported* envelope shape with internal/contract
// at process start -- same registration pattern and reasoning as
// compositionsvc's/configuresvc's own (compositionservice_contract.go,
// configureservice_contract.go, ADR-0036 decision 1).
func init() {
	contract.Register("atlas", exportedAtlas{})
}
