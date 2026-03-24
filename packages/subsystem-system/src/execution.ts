export type Lang = "js" | "python" | "ruby" | "c" | "cpp" | "sql" | "php";

export interface ExecResult {
  output: string[];
  result: unknown;
  error: string | null;
}

export interface TerminalHistoryEntry {
  type: "input" | "output" | "error";
  text: string;
}

export interface NotebookCell {
  id: string;
  type: "code" | "markdown";
  lang: Lang;
  source: string;
  output: string;
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

const terminalScopes = new Map<string, Record<string, unknown>>();
const terminalSessions = new Map<string, {
  lastRunNonce: number;
  lastClearNonce: number;
  history: TerminalHistoryEntry[];
}>();

function createStdlibScope(): Record<string, unknown> {
  return {
    fetchJSON: async (url: string) => {
      const r = await fetch(url);
      return r.json();
    },
    pp: (v: unknown) => {
      console.log(typeof v === "object" ? JSON.stringify(v, null, 2) : String(v));
    },
    table: (data: unknown[]) => {
      if (!Array.isArray(data) || data.length === 0) { console.log("[]"); return; }
      const keys = Object.keys(data[0] as object);
      const header = keys.join(" | ");
      console.log(header);
      console.log("-".repeat(header.length));
      for (const row of data) {
        console.log(keys.map(k => String((row as Record<string, unknown>)[k] ?? "")).join(" | "));
      }
    },
    sleep: (ms: number) => new Promise(r => setTimeout(r, ms)),
    npm: async (pkg: string) => {
      const url = pkg.startsWith("http") ? pkg : `https://esm.sh/${pkg}`;
      return import(/* @vite-ignore */ url);
    },
    env: typeof navigator !== "undefined" ? {
      userAgent: navigator.userAgent,
      language: navigator.language,
      online: navigator.onLine,
      cores: navigator.hardwareConcurrency,
    } : {},
  };
}

function getTerminalSession(nodeId: string) {
  let session = terminalSessions.get(nodeId);
  if (!session) {
    session = { lastRunNonce: -1, lastClearNonce: 0, history: [] };
    terminalSessions.set(nodeId, session);
  }
  if (!terminalScopes.has(nodeId)) {
    terminalScopes.set(nodeId, createStdlibScope());
  }
  return session;
}

export function resetTerminalSession(nodeId: string): void {
  terminalSessions.delete(nodeId);
  terminalScopes.delete(nodeId);
}

export async function executeTerminal(
  nodeId: string,
  config: Record<string, unknown>,
  input?: unknown,
): Promise<{
  history: TerminalHistoryEntry[];
  stdout: string;
  result: Record<string, unknown>;
}> {
  const session = getTerminalSession(nodeId);
  const clearNonce = Number(config.clearNonce || 0);
  const runNonce = Number(config.runNonce || 0);
  const pendingCommand = String(config.pendingCommand || "").trim();
  const mode = normalizeLang(config.mode);

  if (clearNonce !== session.lastClearNonce) {
    session.history = [];
    session.lastClearNonce = clearNonce;
    terminalScopes.set(nodeId, createStdlibScope());
  }

  if (!pendingCommand || runNonce === session.lastRunNonce) {
    return {
      history: session.history,
      stdout: lastStdout(session.history),
      result: {},
    };
  }

  session.lastRunNonce = runNonce;
  const execution = mode === "js"
    ? await evalTerminalJs(nodeId, pendingCommand, input)
    : await executeCode(mode, pendingCommand, normalizeInput(input));

  const entries: TerminalHistoryEntry[] = [
    { type: "input", text: pendingCommand },
    ...execution.output.map(text => ({ type: "output" as const, text })),
  ];
  if (execution.error) {
    entries.push({ type: "error", text: execution.error });
  } else {
    const formatted = formatResult(execution.result);
    if (formatted) {
      entries.push({ type: "output", text: formatted });
    }
  }

  session.history = [...session.history, ...entries].slice(-200);

  return {
    history: session.history,
    stdout: entries
      .filter(entry => entry.type === "output")
      .map(entry => entry.text)
      .join("\n"),
    result: resultToData(execution.result),
  };
}

export async function executeNotebook(
  config: Record<string, unknown>,
): Promise<{
  cells: NotebookCell[];
  allOutputs: Record<string, unknown>;
  cellOutputs: Record<string, unknown>;
}> {
  const cells = parseNotebookCells(config.cells);
  const seed = normalizeInput(config.data ?? config.input);
  const runMode = config.runMode === "cell" ? "cell" : "all";
  const activeCellId = typeof config.activeCellId === "string" ? config.activeCellId : "";

  if (runMode === "cell" && activeCellId) {
    return runNotebookCell(cells, activeCellId, seed);
  }

  return runNotebookAll(cells, seed);
}

function parseNotebookCells(raw: unknown): NotebookCell[] {
  if (typeof raw !== "string") return [];

  try {
    const parsed = JSON.parse(raw) as Array<Partial<NotebookCell>>;
    return parsed.map((cell, index) => ({
      id: typeof cell.id === "string" ? cell.id : `cell-${index}`,
      type: cell.type === "markdown" ? "markdown" : "code",
      lang: normalizeLang(cell.lang),
      source: typeof cell.source === "string" ? cell.source : "",
      output: typeof cell.output === "string" ? cell.output : "",
    }));
  } catch {
    return [];
  }
}

async function runNotebookAll(cells: NotebookCell[], seed: Record<string, unknown>) {
  const nextCells = cells.map(cell => ({ ...cell }));
  const context: Record<string, unknown> = { ...seed };
  const cellOutputs: Record<string, unknown> = {};

  for (let i = 0; i < nextCells.length; i++) {
    const cell = nextCells[i];
    if (cell.type !== "code") continue;

    const execution = await executeCode(cell.lang, cell.source, context);
    cell.output = formatNotebookOutput(execution);

    if (!execution.error) {
      mergeResult(context, cellOutputs, execution.result, i);
    }
  }

  return {
    cells: nextCells,
    allOutputs: context,
    cellOutputs,
  };
}

async function runNotebookCell(
  cells: NotebookCell[],
  activeCellId: string,
  seed: Record<string, unknown>,
) {
  const nextCells = cells.map(cell => ({ ...cell }));
  const context: Record<string, unknown> = { ...seed };
  const cellOutputs: Record<string, unknown> = {};

  for (let i = 0; i < nextCells.length; i++) {
    const cell = nextCells[i];
    if (cell.type !== "code") continue;

    const execution = await executeCode(cell.lang, cell.source, context);
    if (cell.id === activeCellId) {
      cell.output = formatNotebookOutput(execution);
    }

    if (!execution.error) {
      mergeResult(context, cellOutputs, execution.result, i);
    }

    if (cell.id === activeCellId) break;
  }

  return {
    cells: nextCells,
    allOutputs: context,
    cellOutputs,
  };
}

function mergeResult(
  context: Record<string, unknown>,
  cellOutputs: Record<string, unknown>,
  value: unknown,
  index: number,
) {
  if (value === undefined) return;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    Object.assign(context, value);
    cellOutputs[`cell:${index}`] = value;
    return;
  }

  context[`cell${index}`] = value;
  cellOutputs[`cell:${index}`] = value;
}

async function executeCode(
  lang: Lang,
  code: string,
  input?: Record<string, unknown>,
): Promise<ExecResult> {
  if (lang === "js") {
    return evalJS(code, input);
  }

  return runViaWasi(lang, code, input);
}

function evalJS(code: string, input?: Record<string, unknown>): ExecResult {
  const logs: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;

  console.log = (...args: unknown[]) => {
    logs.push(args.map(arg => typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)).join(" "));
  };
  console.warn = console.log;

  try {
    const dataSetup = input ? `const input = ${JSON.stringify(input)}; const $ = input; const data = input;` : "";

    try {
      const result = new Function(`"use strict"; ${dataSetup} return (${code})`)();
      console.log = origLog;
      console.warn = origWarn;
      return { output: logs, result, error: null };
    } catch {
      new Function(`"use strict"; ${dataSetup} ${code}`)();
      console.log = origLog;
      console.warn = origWarn;
      return {
        output: logs,
        result: logs.length > 0 ? logs[logs.length - 1] : undefined,
        error: null,
      };
    }
  } catch (err) {
    console.log = origLog;
    console.warn = origWarn;
    return {
      output: logs,
      result: undefined,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function evalTerminalJs(
  nodeId: string,
  code: string,
  input?: unknown,
): Promise<ExecResult> {
  const scope = terminalScopes.get(nodeId) || {};
  const logs: string[] = [];
  const normalizedInput = normalizeInput(input);
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  console.log = (...args: unknown[]) => {
    logs.push(args.map(arg => typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)).join(" "));
  };
  console.warn = console.log;
  console.error = (...args: unknown[]) => {
    logs.push("[error] " + args.map(arg => typeof arg === "object" ? JSON.stringify(arg) : String(arg)).join(" "));
  };

  try {
    const scopeKeys = [...Object.keys(scope), "input", "$", "data", "stdin"];
    const scopeValues = [...Object.values(scope), normalizedInput, normalizedInput, normalizedInput, input];
    let result: unknown;

    try {
      const fn = new Function(...scopeKeys, `"use strict"; return (${code})`);
      result = await fn(...scopeValues);
    } catch {
      const fn = new Function(...scopeKeys, `"use strict"; ${code}`);
      result = await fn(...scopeValues);
    }

    const assignMatch = code.match(/^(?:let|const|var)\s+(\w+)\s*=/);
    if (assignMatch) {
      const variableName = assignMatch[1];
      try {
        const fn = new Function(...scopeKeys, `"use strict"; ${code}; return ${variableName};`);
        scope[variableName] = await fn(...scopeValues);
      } catch {
        // Ignore partial assignment failures and keep terminal usable.
      }
    }

    terminalScopes.set(nodeId, scope);
    return { output: logs, result, error: null };
  } catch (err) {
    return {
      output: logs,
      result: undefined,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
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

  if (typeof SharedArrayBuffer === "undefined") {
    return {
      output: [],
      result: undefined,
      error: `${LANG_LABELS[lang]} is loading - reload the page if this persists.`,
    };
  }

  try {
    const { headlessRunCode } = await import("@runno/runtime");

    let fullCode = code;
    if (input && Object.keys(input).length > 0) {
      const dataJson = JSON.stringify(input);
      if (lang === "python") {
        fullCode = `import json\ninput = json.loads('${dataJson.replace(/'/g, "\\'")}')\ndata = input\n${code}`;
      } else if (lang === "ruby") {
        fullCode = `require 'json'\ninput = JSON.parse('${dataJson.replace(/'/g, "\\'")}')\ndata = input\n${code}`;
      }
    }

    const stdin = (lang === "c" || lang === "sql") && input
      ? JSON.stringify(input)
      : undefined;

    const result = await headlessRunCode(runtime as never, fullCode, stdin);

    if (result.resultType === "complete") {
      const stdout = result.stdout?.trim() || "";
      const stderr = result.stderr?.trim() || "";
      const output: string[] = [];

      if (stdout) output.push(...stdout.split("\n"));
      if (stderr) output.push(...stderr.split("\n"));

      return {
        output,
        result: undefined,
        error: result.exitCode !== 0 ? (stderr || `Exit code ${result.exitCode}`) : null,
      };
    }

    if (result.resultType === "crash") {
      return {
        output: [],
        result: undefined,
        error: typeof result.error === "string"
          ? result.error
          : (result.error as { message?: string })?.message || "Runtime crash",
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

function formatNotebookOutput(execution: ExecResult): string {
  const lines = [...execution.output];
  if (execution.error) {
    lines.push(`Error: ${execution.error}`);
  } else {
    const formatted = formatResult(execution.result);
    if (formatted) lines.push(formatted);
  }
  return lines.join("\n");
}

function formatResult(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function resultToData(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function normalizeInput(input: unknown): Record<string, unknown> {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (input === undefined) return {};
  return { value: input };
}

function normalizeLang(value: unknown): Lang {
  switch (value) {
    case "python":
    case "ruby":
    case "c":
    case "cpp":
    case "sql":
    case "php":
      return value;
    default:
      return "js";
  }
}

function lastStdout(history: TerminalHistoryEntry[]): string {
  return [...history]
    .reverse()
    .filter(entry => entry.type === "output")
    .map(entry => entry.text)
    .join("\n");
}
