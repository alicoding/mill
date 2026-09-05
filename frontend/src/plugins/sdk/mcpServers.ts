// An MCP server a plugin ships. Declare it in the manifest under
// contributes.mcpServers and Mill offers it on the extension's page
// with an "Add to Configure" button: one press creates the MCP Server
// entity -- command, arguments and environment -- that workflows call
// tools on. The plugin never starts the server and never reads a
// secret; Mill creates the entity and resolves every secret when the
// server is spawned.
//
// A secret the server needs is named through one of your own secretRef
// settings: `"env": { "GITHUB_TOKEN": "secretRef:token" }` reads the
// entry the user picked for the `token` setting and stores a reference
// to it, never its value. A literal under a name that looks like a
// credential (TOKEN, SECRET, PASSWORD, API_KEY, PRIVATE_KEY,
// ACCESS_KEY, CREDENTIAL) is refused at load, so a plugin cannot ship
// a secret.

/** One MCP server declared in the manifest under contributes.mcpServers. */
export interface MCPServerContribution {
  /** A slug unique within this plugin ("reference", "github"). */
  id: string
  /** The name the entity is created with; sentence case. */
  label: string
  /** The program that starts the server ("npx", "uvx", "node"). */
  command: string
  /** Its arguments, in order. */
  args?: string[]
  /** Environment for the server process: a literal value, or
   * "secretRef:<setting key>" naming one of your secretRef settings.
   * Keys are variable names (letters, digits, underscore). */
  env?: Record<string, string>
}
