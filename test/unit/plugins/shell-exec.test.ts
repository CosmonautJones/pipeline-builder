import { describe, it, expect } from "vitest";
import { shellExecPlugin } from "../../../src/plugins/built-in/shell-exec.js";

describe("shellExecPlugin", () => {
  it("should execute a basic command", async () => {
    const result = await shellExecPlugin.execute("exec", { command: "echo hello" });
    expect(result.isError).toBe(false);
    expect(result.content.stdout).toBe("hello");
  });

  it("should handle double-quoted arguments", async () => {
    const result = await shellExecPlugin.execute("exec", { command: 'echo "hello world"' });
    expect(result.isError).toBe(false);
    expect(result.content.stdout).toBe("hello world");
  });

  it("should handle single-quoted arguments", async () => {
    const result = await shellExecPlugin.execute("exec", { command: "echo 'hello world'" });
    expect(result.isError).toBe(false);
    expect(result.content.stdout).toBe("hello world");
  });

  it("should return isError=true for unknown tool names", async () => {
    const result = await shellExecPlugin.execute("unknown-tool", { command: "echo hi" });
    expect(result.isError).toBe(true);
    expect(result.errorMessage).toContain("Unknown tool");
  });

  it("should return isError=true when command fails", async () => {
    const result = await shellExecPlugin.execute("exec", { command: "nonexistent-command-xyz" });
    expect(result.isError).toBe(true);
    expect(result.errorMessage).toBeDefined();
  });

  it("should not interpret shell metacharacters", async () => {
    const result = await shellExecPlugin.execute("exec", { command: "echo hello; rm -rf /" });
    expect(result.isError).toBe(false);
    // Since execFile is used without shell:true, semicolons and subsequent
    // tokens are passed as literal arguments to echo, not interpreted by a shell.
    const stdout = result.content.stdout as string;
    expect(stdout).toContain("hello;");
    expect(stdout).toContain("rm");
    expect(stdout).toContain("-rf");
    expect(stdout).toContain("/");
  });
});
