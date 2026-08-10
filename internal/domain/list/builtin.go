package list

// ExampleCountryCodesID is the seeded example List's ID -- exported so
// composition.BuiltInWorkflows' own list-lookup seed (nodetypes.go)
// can reference it without a string literal that could drift, same
// pattern httprequest.ExampleNoneID/decision.ExampleApproveID already
// establish.
const ExampleCountryCodesID = "example-country-codes-list"

// BuiltIn returns the seeded example List -- pure config, no
// persistence (mirrors httprequest.BuiltIn/decision.BuiltIn's shape:
// this package stays free of the settings-store concern, per
// CLAUDE.md's backend rule -- ConfigureService owns seeding/top-up).
// docs/goals/0010 item 4: Lists had zero seeded example and zero
// seeded workflow exercising list-lookup before this.
func BuiltIn() []List {
	return []List{
		{
			ID:    ExampleCountryCodesID,
			Label: "Example: Country codes",
			Entries: map[string]string{
				"US": "United States",
				"CA": "Canada",
				"MX": "Mexico",
			},
			BuiltIn: true,
		},
	}
}
