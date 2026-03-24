import { execRun, execRunRepl } from "./ipc";

export type Language = "javascript" | "python" | "ruby" | "c" | "cpp" | "sql" | "bash" | "php";

export async function executeCode(
  lang: Language,
  code: string,
  opts?: { cwd?: string; stdin?: string },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // JS expressions run in browser for instant eval
  if (lang === "javascript" && !code.includes("require(") && !code.includes("import ")) {
    try {
      const result = new Function(`"use strict"; return (${code})`)();
      return { stdout: String(result), stderr: "", exitCode: 0 };
    } catch {
      // Fall through to native execution
    }
  }

  const result = await execRun(lang, code, opts?.cwd, opts?.stdin);
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exit_code };
}

export async function executeCodeRepl(
  lang: Language,
  code: string,
  context?: Record<string, unknown>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const contextJson = context ? JSON.stringify(context) : undefined;
  const result = await execRunRepl(lang, code, contextJson);
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exit_code };
}
