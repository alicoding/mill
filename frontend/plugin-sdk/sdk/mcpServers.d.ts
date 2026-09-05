/** One MCP server declared in the manifest under contributes.mcpServers. */
export interface MCPServerContribution {
    /** A slug unique within this plugin ("reference", "github"). */
    id: string;
    /** The name the entity is created with; sentence case. */
    label: string;
    /** The program that starts the server ("npx", "uvx", "node"). */
    command: string;
    /** Its arguments, in order. */
    args?: string[];
    /** Environment for the server process: a literal value, or
     * "secretRef:<setting key>" naming one of your secretRef settings.
     * Keys are variable names (letters, digits, underscore). */
    env?: Record<string, string>;
}
