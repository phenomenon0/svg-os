/**
 * Unified code execution — routes to native JS or Runno WASI sandbox.
 *
 * JS: instant via native new Function() (eval-sandbox.ts)
 * Everything else: Runno headless WASI (Python, Ruby, C, C++, SQL, PHP)
 *
 * Languages are lazy-loaded on first use.
 */

import { evalJS, formatResult, type EvalResult } from "./eval-sandbox";

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

const LANG_TO_RUNTIME: Record<string, string> = {
  python: "python",
  ruby: "ruby",
  c: "clang",
  cpp: "clangpp",
  sql: "sqlite",
  php: "php-cgi",
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

/**
 * Execute code in any supported language.
 * JS runs natively (instant). Everything else uses Runno WASI.
 */
export async function executeCode(
  lang: Lang,
  code: string,
  input?: Record<string, unknown>,
): Promise<ExecResult> {
  if (lang === "js") {
    return evalJS(code, input);
  }

  return runViaWasi(lang, code, input);
}

async function runViaWasi(
  lang: Lang,
  code: string,
  input?: Record<string, unknown>,
): Promise<ExecResult> {
  const runtime = LANG_TO_RUNTIME[lang];
  if (!runtime) {
    return { output: [], result: undefined, error: `Unsupported language: ${lang}` };
  }

  // SharedArrayBuffer required for WASI — not available without COOP/COEP headers
  if (typeof SharedArrayBuffer === "undefined") {
    return {
      output: [],
      result: undefined,
      error: `${getLangLabel(lang)} is loading — reload the page if this persists.`,
    };
  }

  try {
    // Lazy import Runno
    const { headlessRunCode } = await import("@runno/runtime");

    // For Python/Ruby: inject input data as a variable assignment at the top
    let fullCode = code;
    if (input && Object.keys(input).length > 0) {
      const dataJson = JSON.stringify(input);
      if (lang === "python") {
        fullCode = `import json\ndata = json.loads('${dataJson.replace(/'/g, "\\'")}')\n${code}`;
      } else if (lang === "ruby") {
        fullCode = `require 'json'\ndata = JSON.parse('${dataJson.replace(/'/g, "\\'")}')\n${code}`;
      }
      // For C/SQL/PHP, input is passed via stdin
    }

    // Stdin for languages that read from it
    const stdin = (lang === "c" || lang === "sql") && input
      ? JSON.stringify(input)
      : undefined;

    const result = await headlessRunCode(runtime as any, fullCode, stdin);

    if (result.resultType === "complete") {
      const stdout = result.stdout?.trim() || "";
      const stderr = result.stderr?.trim() || "";
      const output: string[] = [];

      if (stdout) output.push(...stdout.split("\n"));
      if (stderr) output.push(...stderr.split("\n"));

      return {
        output,
        result: undefined,  // WASI output is in stdout, not a return value
        error: result.exitCode !== 0 ? (stderr || `Exit code ${result.exitCode}`) : null,
      };
    }

    if (result.resultType === "crash") {
      return {
        output: [],
        result: undefined,
        error: typeof result.error === "string" ? result.error : (result.error as any)?.message || "Runtime crash",
      };
    }

    if (result.resultType === "timeout") {
      return { output: [], result: undefined, error: "Execution timed out" };
    }

    return { output: [], result: undefined, error: "Execution terminated" };
  } catch (err) {
    return {
      output: [],
      result: undefined,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
