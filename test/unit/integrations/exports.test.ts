import { describe, it, expect } from "vitest";
import { generateClaudeMd } from "../../../src/integrations/claude-md-export.js";
import { generateCursorRules } from "../../../src/integrations/cursor-rules-export.js";
import { generateClaudeCodeHooks } from "../../../src/integrations/claude-code-hooks.js";
import type { PipelineDefinition } from "../../../src/types/pipeline.js";

const testPipeline: PipelineDefinition = {
  apiVersion: "pipeline-builder/v1",
  metadata: {
    name: "Test CI Pipeline",
    version: "1.0.0",
    description: "A test pipeline for CI/CD",
    tags: ["ci"],
  },
  nodes: [
    {
      id: "checkout", name: "Checkout Code", type: "trigger",
      dependsOn: [], inputs: [], outputs: [], inputMappings: {},
      errorPolicy: "fail", tags: [], metadata: {},
    },
    {
      id: "lint", name: "Run Linter", type: "action", tool: "shell:exec",
      toolInput: { command: "npm run lint" },
      dependsOn: ["checkout"], inputs: [], outputs: [], inputMappings: {},
      errorPolicy: "skip", tags: [], metadata: {},
    },
    {
      id: "test", name: "Run Tests", type: "action", tool: "shell:exec",
      toolInput: { command: "npm test" },
      dependsOn: ["checkout"], inputs: [], outputs: [], inputMappings: {},
      errorPolicy: "fail", tags: [], metadata: {},
      retry: { maxAttempts: 2, backoffMs: 1000, backoffMultiplier: 2 },
    },
    {
      id: "build", name: "Build Application", type: "action", tool: "shell:exec",
      toolInput: { command: "npm run build" },
      dependsOn: ["lint", "test"], inputs: [], outputs: [], inputMappings: {},
      errorPolicy: "fail", tags: [], metadata: {},
    },
    {
      id: "deploy-approval", name: "Deploy Approval", type: "human-review",
      humanReview: { prompt: "Approve deployment?", approvalRequired: true },
      dependsOn: ["build"], inputs: [], outputs: [], inputMappings: {},
      errorPolicy: "fail", tags: [], metadata: {},
    },
    {
      id: "deploy", name: "Deploy to Production", type: "action", tool: "shell:exec",
      toolInput: { command: "kubectl apply -f k8s/" },
      dependsOn: ["deploy-approval"], inputs: [], outputs: [], inputMappings: {},
      errorPolicy: "fail", tags: [], metadata: {},
    },
  ],
  edges: [
    { from: "checkout", to: "lint" },
    { from: "checkout", to: "test" },
    { from: "lint", to: "build" },
    { from: "test", to: "build" },
    { from: "build", to: "deploy-approval" },
    { from: "deploy-approval", to: "deploy" },
  ],
  variables: [
    { name: "environment", type: "string", default: "staging", required: true },
  ],
  secrets: ["DEPLOY_TOKEN"],
  env: {},
  trigger: { type: "webhook", config: { event: "push" } },
  mcpServers: [],
  tags: ["ci"],
};

describe("CLAUDE.md Export", () => {
  it("should generate valid CLAUDE.md content", () => {
    const content = generateClaudeMd(testPipeline);

    expect(content).toContain("Test CI Pipeline");
    expect(content).toContain("A test pipeline for CI/CD");
    expect(content).toContain("Execution Order");
    expect(content).toContain("Checkout Code");
    expect(content).toContain("Run Linter");
    expect(content).toContain("Run Tests");
    expect(content).toContain("Build Application");
    expect(content).toContain("Deploy Approval");
  });

  it("should include parallel execution notation", () => {
    const content = generateClaudeMd(testPipeline);
    // lint and test are parallel (both depend only on checkout)
    expect(content).toContain("Parallel");
  });

  it("should include human review instructions", () => {
    const content = generateClaudeMd(testPipeline);
    expect(content).toContain("human review checkpoint");
    expect(content).toContain("Approve deployment?");
  });

  it("should include variables and secrets", () => {
    const content = generateClaudeMd(testPipeline);
    expect(content).toContain("environment");
    expect(content).toContain("DEPLOY_TOKEN");
  });
});

describe("Cursor Rules Export", () => {
  it("should generate rule files", () => {
    const rules = generateCursorRules(testPipeline);

    expect(rules.length).toBeGreaterThanOrEqual(1);
    // Should have at least the master rule
    const master = rules.find(r => r.filename === "pipeline-workflow.mdc");
    expect(master).toBeDefined();
    expect(master!.alwaysApply).toBe(true);
  });

  it("should include pipeline stages in master rule", () => {
    const rules = generateCursorRules(testPipeline);
    const master = rules.find(r => r.filename === "pipeline-workflow.mdc")!;

    expect(master.content).toContain("Checkout Code");
    expect(master.content).toContain("Run Linter");
    expect(master.content).toContain("Run Tests");
    expect(master.content).toContain("Build Application");
  });

  it("should generate review gate rules", () => {
    const rules = generateCursorRules(testPipeline);
    const reviewRule = rules.find(r => r.filename.includes("review"));

    expect(reviewRule).toBeDefined();
    expect(reviewRule!.content).toContain("human review checkpoint");
  });
});

describe("Claude Code Hooks Export", () => {
  it("should generate hooks settings", () => {
    const settings = generateClaudeCodeHooks(testPipeline);

    expect(settings.hooks).toBeDefined();
    expect(settings.mcpServers).toBeDefined();
  });

  it("should map lint steps to PreToolUse hooks", () => {
    const settings = generateClaudeCodeHooks(testPipeline);
    const preHooks = settings.hooks?.PreToolUse ?? [];

    const lintHook = preHooks.find(h =>
      h.hooks.some(hook => hook.command.includes("lint"))
    );
    expect(lintHook).toBeDefined();
    expect(lintHook!.matcher).toContain("Write");
  });

  it("should map test steps to PostToolUse hooks", () => {
    const settings = generateClaudeCodeHooks(testPipeline);
    const postHooks = settings.hooks?.PostToolUse ?? [];

    const testHook = postHooks.find(h =>
      h.hooks.some(hook => hook.command.includes("test"))
    );
    expect(testHook).toBeDefined();
  });

  it("should include pipeline-builder as MCP server", () => {
    const settings = generateClaudeCodeHooks(testPipeline);
    expect(settings.mcpServers!["pipeline-builder"]).toBeDefined();
  });

  it("should map deploy steps to guarded hooks", () => {
    const settings = generateClaudeCodeHooks(testPipeline);
    const preHooks = settings.hooks?.PreToolUse ?? [];

    const deployHook = preHooks.find(h =>
      h.hooks.some(hook => hook.command.includes("deploy"))
    );
    expect(deployHook).toBeDefined();
    // Deploy hooks should be guarded (only trigger on push)
    expect(deployHook!.hooks[0].command).toContain("push");
  });
});
