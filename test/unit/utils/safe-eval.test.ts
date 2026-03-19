import { describe, it, expect } from "vitest";
import { safeEvaluate } from "../../../src/utils/safe-eval.js";

describe("safeEvaluate", () => {
  it("should evaluate boolean literals", () => {
    expect(safeEvaluate("true", {})).toBe(true);
    expect(safeEvaluate("false", {})).toBe(false);
  });

  it("should evaluate comparisons", () => {
    expect(safeEvaluate("1 == 1", {})).toBe(true);
    expect(safeEvaluate("1 != 2", {})).toBe(true);
    expect(safeEvaluate("5 > 3", {})).toBe(true);
    expect(safeEvaluate("3 < 5", {})).toBe(true);
    expect(safeEvaluate("5 >= 5", {})).toBe(true);
    expect(safeEvaluate("3 <= 5", {})).toBe(true);
  });

  it("should evaluate logical operators", () => {
    expect(safeEvaluate("true && true", {})).toBe(true);
    expect(safeEvaluate("true && false", {})).toBe(false);
    expect(safeEvaluate("true || false", {})).toBe(true);
    expect(safeEvaluate("false || false", {})).toBe(false);
  });

  it("should evaluate not operator", () => {
    expect(safeEvaluate("!false", {})).toBe(true);
    expect(safeEvaluate("!true", {})).toBe(false);
  });

  it("should resolve template variables", () => {
    expect(safeEvaluate("{{ env }} == 'production'", { env: "production" })).toBe(true);
    expect(safeEvaluate("{{ env }} == 'production'", { env: "staging" })).toBe(false);
    expect(safeEvaluate("{{ count }} > 10", { count: 15 })).toBe(true);
  });

  it("should resolve bare variable names", () => {
    expect(safeEvaluate("enabled", { enabled: true })).toBe(true);
    expect(safeEvaluate("enabled", { enabled: false })).toBe(false);
  });

  it("should handle parentheses", () => {
    expect(safeEvaluate("(true || false) && true", {})).toBe(true);
    expect(safeEvaluate("(false || false) && true", {})).toBe(false);
  });

  it("should handle string comparisons", () => {
    expect(safeEvaluate("'hello' == 'hello'", {})).toBe(true);
    expect(safeEvaluate("'hello' != 'world'", {})).toBe(true);
  });

  it("should handle dotted variable paths", () => {
    expect(safeEvaluate("{{ variables.env }} == 'prod'", { env: "prod" })).toBe(true);
  });

  it("should default to true on parse errors (fail-open)", () => {
    expect(safeEvaluate("", {})).toBe(true);
    expect(safeEvaluate("???invalid???", {})).toBe(true);
  });

  it("should NOT execute arbitrary code", () => {
    // These should NOT work (no code execution)
    expect(safeEvaluate("process.exit(1)", {})).toBe(true); // treated as undefined variable, truthy fallback
    expect(safeEvaluate("require('fs')", {})).toBe(true);
  });
});
