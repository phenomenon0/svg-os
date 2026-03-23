/**
 * Shared JS execution sandbox. Used by both Terminal (visual) and
 * Transform/reactive engine (headless). Extracts the eval logic
 * so any node can execute code and pipe results.
 */

export interface EvalResult {
  output: string[];   // console.log lines
  result: unknown;    // return value
  error: string | null;
}

/**
 * Execute JavaScript code in a sandboxed Function scope.
 * Optionally receives input data accessible as `$` and `data` variables.
 */
export function evalJS(code: string, input?: Record<string, unknown>): EvalResult {
  const logs: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;

  console.log = (...args: unknown[]) => {
    logs.push(args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" "));
  };
  console.warn = console.log;

  try {
    // Build the function body with input data injected as variables
    const dataSetup = input ? `const $ = ${JSON.stringify(input)}; const data = $;` : "";

    // Try as expression first (returns a value)
    try {
      const result = new Function(`"use strict"; ${dataSetup} return (${code})`)();
      console.log = origLog;
      console.warn = origWarn;
      return { output: logs, result, error: null };
    } catch {
      // Try as statement block
      new Function(`"use strict"; ${dataSetup} ${code}`)();
      console.log = origLog;
      console.warn = origWarn;
      return { output: logs, result: logs.length > 0 ? logs[logs.length - 1] : undefined, error: null };
    }
  } catch (err: unknown) {
    console.log = origLog;
    console.warn = origWarn;
    return {
      output: logs,
      result: undefined,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Format a result for display (terminal output).
 */
export function formatResult(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "object") {
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }
  return String(value);
}

/**
 * Convert a result to a JSON-serializable value for data flow.
 */
export function resultToData(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return { value };
}
