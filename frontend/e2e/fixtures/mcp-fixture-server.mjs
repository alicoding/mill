#!/usr/bin/env node
// Minimal fixture MCP server for mcp-tool-editor.spec.ts (docs/SPEC.md
// §3.6): exposes one real tool, "greet", over real stdio MCP protocol so
// the test drives the actual ListMCPServerTools -> Inspector ->
// MCPToolArgsEditor path against a live subprocess, the same "test
// against something real" bar internal/adapters/mcpclient's own tests
// already set on the Go side -- not a mock.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const server = new Server({ name: 'mill-e2e-fixture', version: '1.0.0' }, { capabilities: { tools: {} } })

const greetTool = {
  name: 'greet',
  description: 'Say hello to someone',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Who to greet' },
      count: { type: 'number' },
      loud: { type: 'boolean' },
    },
    required: ['name'],
  },
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [greetTool] }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'greet') {
    throw new Error(`unknown tool: ${request.params.name}`)
  }
  const { name } = request.params.arguments ?? {}
  return { content: [{ type: 'text', text: `Hello, ${name}` }] }
})

await server.connect(new StdioServerTransport())
