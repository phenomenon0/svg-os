/**
 * Native code execution — routes JS to browser eval, everything else to Tauri subprocess.
 * Replaces the WASI-based code-runner from the web version.
 */

import { execRun } from "./ipc";

export type Lang = "js" | "python" | "ruby" | "c" | "cpp" | "sql" | "php";

export interface ExecResult {
  output: string[];
  result: unknown;
  error: string | null;
}

const LANG_LABELS: Record<Lang, string> = {
  js: "JavaScript",
  python: "Python",
  ruby: "Ruby",
  c: "C",
  cpp: "C++",
  sql: "SQL",
  php: "PHP",
};

export const SUPPORTED_LANGS: { id: Lang; label: string }[] = [
  { id: "js", label: "JavaScript" },
  { id: "python", label: "Python" },
  { id: "ruby", label: "Ruby" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "sql", label: "SQL" },
];

export function getLangLabel(lang: Lang): string {
  return LANG_LABELS[lang] || lang;
}

export function getLangShort(lang: Lang): string {
  const shorts: Record<Lang, string> = {
    js: "JS", python: "PY", ruby: "RB", c: "C", cpp: "C++", sql: "SQL", php: "PHP",
  };
  return shorts[lang] || lang.toUpperCase();
}

export function formatResult(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Execute code in any supported language.
 * JS runs natively in browser (instant). Everything else goes through Tauri subprocess.
 */
export async function executeCode(
  lang: Lang,
  code: string,
  input?: Record<string, unknown>,
): Promise<ExecResult> {
  if (lang === "js") {
    return evalJS(code, input);
  }

  return runViaNative(lang, code, input);
}

function evalJS(code: string, input?: Record<string, unknown>): ExecResult {
  const output: string[] = [];
  const fakeConsole = {
    log: (...args: unknown[]) => output.push(args.map(formatResult).join(" ")),
    warn: (...args: unknown[]) => output.push(args.map(formatResult).join(" ")),
    error: (...args: unknown[]) => output.push(args.map(formatResult).join(" ")),
    info: (...args: unknown[]) => output.push(args.map(formatResult).join(" ")),
  };

  try {
    // Try as expression first
    let result: unknown;
    try {
      const fn = new Function("console", "input", "data", `"use strict"; return (${code})`);
      result = fn(fakeConsole, input, input);
    } catch {
      // Fallback: run as statements
      const fn = new Function("console", "input", "data", `"use strict"; ${code}`);
      result = fn(fakeConsole, input, input);
    }
    return { output, result, error: null };
  } catch (err) {
    return { output, result: undefined, error: err instanceof Error ? err.message : String(err) };
  }
}

async function runViaNative(
  lang: Lang,
  code: string,
  input?: Record<string, unknown>,
): Promise<ExecResult> {
  try {
    // Inject input data for supported languages
    let wrappedCode = code;
    if (input && Object.keys(input).length > 0) {
      const json = JSON.stringify(input);
      if (lang === "python") {
        wrappedCode = `import json\ndata = json.loads('${json.replace(/'/g, "\\'")}')\n${code}`;
      } else if (lang === "ruby") {
        wrappedCode = `require 'json'\ndata = JSON.parse('${json.replace(/'/g, "\\'")}')\n${code}`;
      }
    }

    const result = await execRun(lang, wrappedCode);
    const combined = result.stdout + (result.stderr ? `\n${result.stderr}` : "");
    const lines = combined.split("\n").filter((l) => l.length > 0);

    if (result.exit_code !== 0) {
      return { output: [], result: undefined, error: result.stderr || `Exit code ${result.exit_code}` };
    }

    // Only return result if stdout is a single value (not already in output lines)
    // This prevents double-printing when stdout contains the result
    return { output: lines, result: undefined, error: null };
  } catch (err) {
    return { output: [], result: undefined, error: err instanceof Error ? err.message : String(err) };
  }
}
