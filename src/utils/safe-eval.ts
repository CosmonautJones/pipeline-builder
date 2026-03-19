/**
 * Safe expression evaluator for pipeline conditions.
 * Replaces the unsafe `new Function()` approach.
 *
 * Supports:
 * - Boolean literals: true, false
 * - Comparisons: ==, !=, >, <, >=, <=
 * - Logical operators: &&, ||, !
 * - Variable references: {{ varName }}
 * - String/number/boolean literals
 * - Parentheses for grouping
 */

type Token =
  | { type: "bool"; value: boolean }
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "var"; name: string }
  | { type: "op"; value: string }
  | { type: "paren"; value: "(" | ")" }
  | { type: "not" };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    // Skip whitespace
    if (/\s/.test(expr[i])) { i++; continue; }

    // Template variable: {{ varName }}
    if (expr[i] === "{" && expr[i + 1] === "{") {
      i += 2;
      while (i < expr.length && /\s/.test(expr[i])) i++;
      let name = "";
      while (i < expr.length && /[\w.]/.test(expr[i])) { name += expr[i]; i++; }
      while (i < expr.length && /\s/.test(expr[i])) i++;
      if (expr[i] === "}" && expr[i + 1] === "}") i += 2;
      tokens.push({ type: "var", name });
      continue;
    }

    // Parentheses
    if (expr[i] === "(" || expr[i] === ")") {
      tokens.push({ type: "paren", value: expr[i] as "(" | ")" });
      i++; continue;
    }

    // Not operator
    if (expr[i] === "!" && expr[i + 1] !== "=") {
      tokens.push({ type: "not" });
      i++; continue;
    }

    // Two-char operators
    const twoChar = expr.slice(i, i + 2);
    if (["==", "!=", ">=", "<=", "&&", "||"].includes(twoChar)) {
      tokens.push({ type: "op", value: twoChar });
      i += 2; continue;
    }

    // Single-char operators
    if (["<", ">"].includes(expr[i])) {
      tokens.push({ type: "op", value: expr[i] });
      i++; continue;
    }

    // String literal
    if (expr[i] === '"' || expr[i] === "'") {
      const quote = expr[i]; i++;
      let str = "";
      while (i < expr.length && expr[i] !== quote) { str += expr[i]; i++; }
      i++; // closing quote
      tokens.push({ type: "string", value: str });
      continue;
    }

    // Number
    if (/[\d.]/.test(expr[i])) {
      let num = "";
      while (i < expr.length && /[\d.]/.test(expr[i])) { num += expr[i]; i++; }
      tokens.push({ type: "number", value: parseFloat(num) });
      continue;
    }

    // Boolean / bare identifier (treated as variable)
    if (/[a-zA-Z_]/.test(expr[i])) {
      let word = "";
      while (i < expr.length && /[\w.]/.test(expr[i])) { word += expr[i]; i++; }
      if (word === "true") tokens.push({ type: "bool", value: true });
      else if (word === "false") tokens.push({ type: "bool", value: false });
      else tokens.push({ type: "var", name: word });
      continue;
    }

    i++; // skip unknown chars
  }

  return tokens;
}

function resolveVar(name: string, variables: Record<string, unknown>): unknown {
  // Handle dotted paths like "variables.environment"
  const cleanName = name.startsWith("variables.") ? name.slice("variables.".length) : name;
  return variables[cleanName];
}

function evaluate(tokens: Token[], variables: Record<string, unknown>): unknown {
  let pos = 0;

  function peek(): Token | undefined { return tokens[pos]; }
  function advance(): Token { return tokens[pos++]; }

  function primary(): unknown {
    const t = peek();
    if (!t) return undefined;

    if (t.type === "bool") { advance(); return t.value; }
    if (t.type === "number") { advance(); return t.value; }
    if (t.type === "string") { advance(); return t.value; }
    if (t.type === "var") { advance(); return resolveVar(t.name, variables); }

    if (t.type === "not") {
      advance();
      return !primary();
    }

    if (t.type === "paren" && t.value === "(") {
      advance(); // (
      const val = orExpr();
      if (peek()?.type === "paren" && (peek() as { value: string }).value === ")") advance(); // )
      return val;
    }

    advance();
    return undefined;
  }

  function comparison(): unknown {
    let left = primary();
    while (peek()?.type === "op" && ["==", "!=", ">", "<", ">=", "<="].includes((peek() as { value: string }).value)) {
      const op = (advance() as { value: string }).value;
      const right = primary();
      switch (op) {
        case "==": left = left == right; break;
        case "!=": left = left != right; break;
        case ">": left = (left as number) > (right as number); break;
        case "<": left = (left as number) < (right as number); break;
        case ">=": left = (left as number) >= (right as number); break;
        case "<=": left = (left as number) <= (right as number); break;
      }
    }
    return left;
  }

  function andExpr(): unknown {
    let left = comparison();
    while (peek()?.type === "op" && (peek() as { value: string }).value === "&&") {
      advance();
      const right = comparison();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }

  function orExpr(): unknown {
    let left = andExpr();
    while (peek()?.type === "op" && (peek() as { value: string }).value === "||") {
      advance();
      const right = andExpr();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  return orExpr();
}

/**
 * Safely evaluate a boolean expression with variable substitution.
 * Returns true/false. Defaults to true on parse errors (fail-open for pipeline conditions).
 */
export function safeEvaluate(expression: string, variables: Record<string, unknown>): boolean {
  try {
    const trimmed = expression.trim();
    if (!trimmed) return true; // empty expression = always run

    const tokens = tokenize(trimmed);
    if (tokens.length === 0) return true; // no valid tokens = always run

    const result = evaluate(tokens, variables);
    // If result is undefined (unresolved variable), fail-open
    if (result === undefined) return true;
    return Boolean(result);
  } catch {
    return true; // fail-open: run the step on parse error
  }
}
