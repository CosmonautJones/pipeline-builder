import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MCPClientManager } from "../../../src/mcp/client-manager.js";

const buildSafeEnv = (configEnv: Record<string, string>): Record<string, string> =>
  (MCPClientManager as any).buildSafeEnv(configEnv);

describe("MCPClientManager.buildSafeEnv", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Set known values for safe-inherit vars
    process.env.PATH = "/usr/bin:/bin";
    process.env.HOME = "/home/testuser";
    process.env.USER = "testuser";
    process.env.SHELL = "/bin/bash";
    process.env.LANG = "en_US.UTF-8";
    process.env.TERM = "xterm-256color";
    process.env.NODE_ENV = "test";
    process.env.TMPDIR = "/tmp";
  });

  afterEach(() => {
    // Restore original environment
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("should inherit PATH from process.env", () => {
    const result = buildSafeEnv({});
    expect(result.PATH).toBe("/usr/bin:/bin");
  });

  it("should allow user-provided vars like API_KEY and DATABASE_URL", () => {
    const result = buildSafeEnv({
      API_KEY: "sk-secret-123",
      DATABASE_URL: "postgres://localhost/db",
    });
    expect(result.API_KEY).toBe("sk-secret-123");
    expect(result.DATABASE_URL).toBe("postgres://localhost/db");
  });

  it("should block LD_PRELOAD from user config", () => {
    const result = buildSafeEnv({ LD_PRELOAD: "/tmp/evil.so" });
    expect(result.LD_PRELOAD).toBeUndefined();
  });

  it("should block NODE_OPTIONS from user config", () => {
    const result = buildSafeEnv({ NODE_OPTIONS: "--require /tmp/evil.js" });
    expect(result.NODE_OPTIONS).toBeUndefined();
  });

  it("should block DYLD_INSERT_LIBRARIES from user config", () => {
    const result = buildSafeEnv({ DYLD_INSERT_LIBRARIES: "/tmp/evil.dylib" });
    expect(result.DYLD_INSERT_LIBRARIES).toBeUndefined();
  });

  it("should block HTTP_PROXY and HTTPS_PROXY from user config", () => {
    const result = buildSafeEnv({
      HTTP_PROXY: "http://evil-proxy:8080",
      HTTPS_PROXY: "http://evil-proxy:8080",
    });
    expect(result.HTTP_PROXY).toBeUndefined();
    expect(result.HTTPS_PROXY).toBeUndefined();
  });

  it("should not allow user to override PATH", () => {
    const result = buildSafeEnv({ PATH: "/tmp/evil-bin" });
    expect(result.PATH).toBe("/usr/bin:/bin");
  });

  it("should not include vars from process.env that are not in the safe list", () => {
    process.env.SECRET_INTERNAL_VAR = "should-not-leak";
    process.env.AWS_SECRET_ACCESS_KEY = "also-should-not-leak";

    const result = buildSafeEnv({});
    expect(result.SECRET_INTERNAL_VAR).toBeUndefined();
    expect(result.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });
});
