package environment

import "github.com/alicoding/mill/internal/domain/seedorigin"

// ExampleSandboxID/ExampleProductionID are the seeded Environments'
// IDs -- exported so composition.BuiltInWorkflows and
// httprequest.BuiltIn can reference them without a string literal that
// could drift, the same convention execenv.ExampleSafeSandboxID and
// httprequest.ExampleNoneID already establish.
const (
	ExampleSandboxID    = "example-sandbox-environment"
	ExampleProductionID = "example-production-environment"
)

// BuiltIn returns the seeded example Environments -- pure config, no
// persistence (execenv.BuiltIn's shape: ConfigureService owns seeding
// and top-up).
//
// The pair is the whole point of the entity: one workflow, one
// request, two stages, and the only thing that changes between them is
// which Environment the run selects. Sandbox's API_BASE points at the
// same public echo service every other seeded request uses, so the
// seeded "Post an update to the client portal" workflow stays runnable
// end to end with a variable in its URL; Production's points at a
// deliberately unreachable example host, so running against it is a
// decision, never an accident.
//
// API_TOKEN ships as a SECRET variable with an EMPTY reference: a
// secret variable's value is a pointer into the secret store, and no
// seed may invent an entry there, so the pair demonstrates the
// "Needs a value" state a real secret variable starts in.
func BuiltIn() []Environment {
	return []Environment{
		{
			ID:    ExampleSandboxID,
			Label: "Example: Sandbox",
			Vars: []Variable{
				{Key: "API_BASE", Value: "https://httpbin.org"},
				{Key: "API_TOKEN", Secret: true},
			},
			BuiltIn: true,
			Seed:    seedorigin.Stamp(1),
		},
		{
			ID:    ExampleProductionID,
			Label: "Example: Production",
			Vars: []Variable{
				{Key: "API_BASE", Value: "https://api.example.com"},
				{Key: "API_TOKEN", Secret: true},
			},
			BuiltIn: true,
			Seed:    seedorigin.Stamp(1),
		},
	}
}
