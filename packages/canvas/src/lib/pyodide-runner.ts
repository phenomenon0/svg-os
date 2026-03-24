/**
 * Pyodide-based Python execution engine.
 *
 * Manages a singleton Pyodide instance that is lazy-loaded on first use.
 * Provides NumPy, Pandas, Matplotlib, micropip, and the full Python stdlib.
 * Auto-detects import statements and installs missing packages via micropip.
 */

import type { ExecResult } from "./code-runner";

let pyodideInstance: any = null;
let loading: Promise<any> | null = null;

/** Standard-library modules that don't need micropip installation. */
const STDLIB_MODULES = new Set([
  "abc", "aifc", "argparse", "array", "ast", "asynchat", "asyncio",
  "asyncore", "atexit", "base64", "bdb", "binascii", "binhex", "bisect",
  "builtins", "bz2", "calendar", "cgi", "cgitb", "chunk", "cmath",
  "cmd", "code", "codecs", "codeop", "collections", "colorsys", "compileall",
  "concurrent", "configparser", "contextlib", "contextvars", "copy",
  "copyreg", "cProfile", "csv", "ctypes", "curses", "dataclasses",
  "datetime", "dbm", "decimal", "difflib", "dis", "distutils", "doctest",
  "email", "encodings", "enum", "errno", "faulthandler", "fcntl",
  "filecmp", "fileinput", "fnmatch", "fractions", "ftplib", "functools",
  "gc", "getopt", "getpass", "gettext", "glob", "graphlib", "grp",
  "gzip", "hashlib", "heapq", "hmac", "html", "http", "idlelib",
  "imaplib", "imghdr", "imp", "importlib", "inspect", "io", "ipaddress",
  "itertools", "json", "keyword", "lib2to3", "linecache", "locale",
  "logging", "lzma", "mailbox", "mailcap", "marshal", "math", "mimetypes",
  "mmap", "modulefinder", "multiprocessing", "netrc", "nis", "nntplib",
  "numbers", "operator", "optparse", "os", "ossaudiodev", "pathlib",
  "pdb", "pickle", "pickletools", "pipes", "pkgutil", "platform",
  "plistlib", "poplib", "posix", "posixpath", "pprint", "profile",
  "pstats", "pty", "pwd", "py_compile", "pyclbr", "pydoc", "queue",
  "quopri", "random", "re", "readline", "reprlib", "resource", "rlcompleter",
  "runpy", "sched", "secrets", "select", "selectors", "shelve", "shlex",
  "shutil", "signal", "site", "smtpd", "smtplib", "sndhdr", "socket",
  "socketserver", "sqlite3", "ssl", "stat", "statistics", "string",
  "stringprep", "struct", "subprocess", "sunau", "symtable", "sys",
  "sysconfig", "syslog", "tabnanny", "tarfile", "telnetlib", "tempfile",
  "termios", "test", "textwrap", "threading", "time", "timeit", "tkinter",
  "token", "tokenize", "tomllib", "trace", "traceback", "tracemalloc",
  "tty", "turtle", "turtledemo", "types", "typing", "unicodedata",
  "unittest", "urllib", "uu", "uuid", "venv", "warnings", "wave",
  "weakref", "webbrowser", "winreg", "winsound", "wsgiref", "xdrlib",
  "xml", "xmlrpc", "zipapp", "zipfile", "zipimport", "zlib",
  // Pyodide built-ins
  "micropip", "pyodide", "js", "_pyodide",
]);

/**
 * Get or create the singleton Pyodide instance.
 * First call loads the runtime from CDN and pre-loads micropip.
 */
export async function getPyodide(): Promise<any> {
  if (pyodideInstance) return pyodideInstance;
  if (loading) return loading;

  loading = (async () => {
    const { loadPyodide } = await import("pyodide");
    const instance = await loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.29.3/full/",
    });
    await instance.loadPackage("micropip");
    pyodideInstance = instance;
    return instance;
  })();

  return loading;
}

/**
 * Extract top-level import names from Python source code.
 * Handles `import foo`, `from foo import bar`, and `import foo, bar`.
 */
function extractImports(code: string): string[] {
  const names = new Set<string>();
  for (const line of code.split("\n")) {
    const trimmed = line.trim();
    // `from foo.bar import ...`
    let m = trimmed.match(/^from\s+([\w.]+)\s+import\b/);
    if (m) {
      names.add(m[1].split(".")[0]);
      continue;
    }
    // `import foo, bar as baz, qux`
    m = trimmed.match(/^import\s+(.+)/);
    if (m) {
      for (const part of m[1].split(",")) {
        const pkg = part.trim().split(/\s/)[0].split(".")[0];
        if (pkg) names.add(pkg);
      }
    }
  }
  return [...names];
}

/**
 * Auto-install any third-party packages referenced by import statements.
 * Silently skips stdlib modules and packages that fail to install.
 */
async function autoInstallImports(pyodide: any, code: string): Promise<void> {
  const imports = extractImports(code);
  const thirdParty = imports.filter((m) => !STDLIB_MODULES.has(m));
  if (thirdParty.length === 0) return;

  const micropip = pyodide.pyimport("micropip");
  for (const pkg of thirdParty) {
    try {
      await micropip.install(pkg);
    } catch {
      // Package may not exist on PyPI or is already available — ignore.
    }
  }
}

/**
 * Execute Python code via Pyodide and return a unified ExecResult.
 *
 * - `input` is injected as `data` and `$` Python variables (dicts).
 * - stdout/stderr are captured and returned in `output`.
 * - The last expression value is returned in `result`.
 */
export async function runPython(
  code: string,
  input?: Record<string, unknown>,
): Promise<ExecResult> {
  let pyodide: any;
  try {
    pyodide = await getPyodide();
  } catch (err) {
    return {
      output: [],
      result: undefined,
      error: `Failed to load Pyodide: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Inject input data as Python globals (`input` is primary, `data` and `$` are aliases)
  if (input && Object.keys(input).length > 0) {
    pyodide.globals.set("input", pyodide.toPy(input));
    pyodide.globals.set("data", pyodide.toPy(input));
    pyodide.globals.set("$", pyodide.toPy(input));
  } else {
    pyodide.globals.set("input", pyodide.toPy({}));
    pyodide.globals.set("data", pyodide.toPy({}));
    pyodide.globals.set("$", pyodide.toPy({}));
  }

  // Redirect stdout/stderr to capture buffers
  pyodide.runPython(`
import sys as __sys, io as __io
__sys.stdout = __io.StringIO()
__sys.stderr = __io.StringIO()
`);

  // Auto-install third-party packages before execution
  await autoInstallImports(pyodide, code);

  try {
    const result = await pyodide.runPythonAsync(code);

    const stdout: string = pyodide.runPython("__sys.stdout.getvalue()");
    const stderr: string = pyodide.runPython("__sys.stderr.getvalue()");

    // Restore original streams
    pyodide.runPython("__sys.stdout = __sys.__stdout__; __sys.stderr = __sys.__stderr__");

    const output: string[] = [];
    if (stdout) output.push(...stdout.split("\n").filter(Boolean));
    if (stderr) output.push(...stderr.split("\n").filter(Boolean));

    // Convert Pyodide proxy objects to plain JS values
    let jsResult: unknown;
    try {
      jsResult = result?.toJs?.({ dict_converter: Object.fromEntries }) ?? result ?? undefined;
    } catch {
      jsResult = result != null ? String(result) : undefined;
    }

    return { output, result: jsResult, error: null };
  } catch (err) {
    // Always restore streams on error
    try {
      pyodide.runPython("__sys.stdout = __sys.__stdout__; __sys.stderr = __sys.__stderr__");
    } catch {
      // Ignore cleanup errors
    }

    return {
      output: [],
      result: undefined,
      error: err instanceof Error ? (err.message || String(err)) : String(err),
    };
  }
}
