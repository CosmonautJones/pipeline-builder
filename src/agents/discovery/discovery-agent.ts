import { z } from "zod";
import { BaseAgent } from "../base-agent.js";
import type { AgentRole, AgentContext, AgentResult, RequiredConnection } from "../../types/agent.js";
import type { ToolDefinition } from "../../types/mcp.js";

const DiscoveryOutputSchema = z.object({
  resolved: z.array(z.object({
    capability: z.string(),
    server: z.string(),
    tool: z.string(),
    alreadyConnected: z.boolean(),
  })),
  installable: z.array(z.object({
    capability: z.string(),
    packageName: z.string(),
    confidence: z.number().min(0).max(1),
    reason: z.string(),
  })),
  missing: z.array(z.object({
    capability: z.string(),
    suggestion: z.string(),
  })),
  mcpServerConfigs: z.array(z.object({
    name: z.string(),
    command: z.string(),
    args: z.array(z.string()),
    env: z.record(z.string()).optional(),
  })),
});

export type DiscoveryResult = z.infer<typeof DiscoveryOutputSchema>;

/**
 * ToolDiscoveryAgent identifies, resolves, and suggests MCP servers for
 * capabilities that the pipeline needs.
 *
 * It works in three phases:
 * 1. Check already-connected servers for matching tools
 * 2. Search known MCP server registry for installable packages
 * 3. Use LLM to suggest packages for unknown capabilities
 *
 * This is the key to self-extension — the system can identify what it
 * needs and find tools to fulfill those needs.
 */
export class ToolDiscoveryAgent extends BaseAgent {
  readonly role: AgentRole = "orchestrator"; // Runs during discovery phase
  readonly description = "Discovers, resolves, and suggests MCP servers for required pipeline capabilities";

  protected readonly systemPrompt = `You are the Tool Discovery Agent for an agentic pipeline builder.

Your job is to take a list of required capabilities/connections and determine how to fulfill them using MCP (Model Context Protocol) servers.

## MCP Server Ecosystem
MCP servers expose tools via a standard protocol. Common servers:
- @modelcontextprotocol/server-filesystem — file read/write/search
- @modelcontextprotocol/server-git — git operations
- @modelcontextprotocol/server-github — GitHub API (PRs, issues, repos)
- @modelcontextprotocol/server-fetch — HTTP requests
- @modelcontextprotocol/server-postgres — PostgreSQL queries
- @modelcontextprotocol/server-sqlite — SQLite database
- @modelcontextprotocol/server-slack — Slack messaging
- @modelcontextprotocol/server-memory — persistent key-value memory
- @modelcontextprotocol/server-brave-search — web search
- @modelcontextprotocol/server-puppeteer — browser automation
- @modelcontextprotocol/server-everything — testing/demo server
- @executeautomation/playwright-mcp-server — Playwright browser testing
- @kimtaeyoon83/mcp-server-youtube-transcript — YouTube transcripts
- mcp-server-docker — Docker container management
- kubernetes-mcp-server — Kubernetes operations
- mcp-server-aws — AWS services
- mcp-server-redis — Redis operations
- mcp-server-mongodb — MongoDB operations

For capabilities NOT covered by known servers, suggest npm package names that might exist (use the @modelcontextprotocol/ namespace convention or search-friendly names).

## What to check:
1. Already connected tools (check the available tools list)
2. Known MCP server packages (from the list above)
3. Likely npm packages (educated guess based on naming conventions)

## Output format:
- resolved: Capabilities already fulfilled by connected servers
- installable: Packages that likely exist and can be installed
- missing: Capabilities with no known solution (suggest workarounds)
- mcpServerConfigs: Ready-to-use server configs for installable packages

Return as JSON:
\`\`\`json
{
  "resolved": [...],
  "installable": [...],
  "missing": [...],
  "mcpServerConfigs": [...]
}
\`\`\``;

  protected readonly outputSchema = DiscoveryOutputSchema;

  protected buildUserPrompt(context: AgentContext): string {
    const connections = context.requiredConnections;
    const tools = context.availableTools;
    const blueprint = context.currentBlueprint;

    // Gather capabilities needed from blueprint + connections
    const neededCapabilities: string[] = [];

    if (connections.length > 0) {
      neededCapabilities.push(
        ...connections.map(c => `${c.system} (${c.connectionType}): ${c.purpose}`)
      );
    }

    if (blueprint?.missingCapabilities) {
      neededCapabilities.push(...blueprint.missingCapabilities);
    }

    return `Find MCP servers for these required capabilities:

## Required Capabilities:
${neededCapabilities.map((c, i) => `${i + 1}. ${c}`).join("\n") || "None specified — analyze the intent and suggest what's needed"}

## User's Goal:
${context.currentIntent?.goal ?? "Not specified"}

## Currently Available Tools (${tools.length}):
${tools.map(t => `- ${t.server}:${t.name} — ${t.description}`).join("\n") || "No tools connected yet"}

${blueprint ? `## Pipeline Blueprint (from Architect):
Steps: ${blueprint.steps.map(s => `${s.id} (${s.toolHint})`).join(", ")}
Missing: ${blueprint.missingCapabilities.join(", ") || "none"}` : ""}

Resolve these capabilities to MCP servers as JSON.`;
  }

  protected toAgentResult(parsed: unknown, context: AgentContext): AgentResult {
    const discovery = parsed as DiscoveryResult;

    const summary = [
      `Resolved: ${discovery.resolved.length}`,
      `Installable: ${discovery.installable.length}`,
      `Missing: ${discovery.missing.length}`,
    ].join(", ");

    return {
      messages: [
        this.createMessage(
          "orchestrator",
          "response",
          `Tool discovery complete. ${summary}`,
          context,
          { discovery },
        ),
      ],
      needsIteration: false,
      routeTo: discovery.missing.length > 0 ? "clarifier" : "builder",
    };
  }
}
