package secret

// BuiltInDemo ships one seeded, obviously-fake example entry the first
// time a vault is created -- the same "every capability ships a working
// example" standing practice httprequest.BuiltIn/mcpserver's own seeds
// already establish (.claude/rules/testing.md), applied here so the
// browse surface (goal 0185 S2) never opens to a genuinely empty state
// on a fresh vault. ID is left blank -- the vault adapter mints a real
// one on insert, same as any other Upsert call.
func BuiltInDemo() Entry {
	return Entry{
		Title:    "Example Login",
		Username: "demo@example.com",
		Password: "correct horse battery staple",
		URL:      "https://example.com",
		Notes:    "A starter entry -- delete it once you've added your own.",
	}
}
