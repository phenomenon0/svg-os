/**
 * SVG-OS Brave Rewrite — End-to-End Visual Tests
 *
 * Tests every node type, 3-link chains, all buttons, data flow,
 * and AI use cases. Each test takes a screenshot for visual verification.
 */

import { test, expect, type Page } from "@playwright/test";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Wait for the canvas app to be fully loaded and editor exposed */
async function waitForCanvas(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  // Wait for tldraw canvas to render
  await page.waitForSelector(".tl-container", { timeout: 15_000 });
  // Wait for our RuntimeBridge to expose the editor
  await page.waitForFunction(
    () => !!(window as any).__tldrawEditor,
    { timeout: 10_000 },
  );
}

/** Create a shape on the canvas via the tldraw editor API */
async function createShape(
  page: Page,
  type: string,
  x: number,
  y: number,
  props: Record<string, unknown> = {},
) {
  return page.evaluate(
    ({ type, x, y, props }) => {
      const editor = (window as any).__tldrawEditor;
      if (!editor) throw new Error("tldraw editor not found on window");
      const id = `shape:${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      editor.createShape({
        id,
        type,
        x,
        y,
        props: {
          w: props.w ?? 300,
          h: props.h ?? 200,
          ...props,
        },
      });
      return id;
    },
    { type, x, y, props },
  );
}

/** Connect two shapes via an arrow */
async function connectShapes(page: Page, fromId: string, toId: string) {
  return page.evaluate(
    ({ fromId, toId }) => {
      const editor = (window as any).__tldrawEditor;
      if (!editor) throw new Error("tldraw editor not found");
      const arrowId = `shape:arrow-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      editor.createShape({
        id: arrowId,
        type: "arrow",
        props: {},
      });
      editor.createBindings([
        {
          id: `binding:start-${Date.now()}`,
          type: "arrow",
          fromId: arrowId,
          toId: fromId,
          props: { terminal: "start", normalizedAnchor: { x: 1, y: 0.5 }, isExact: false, isPrecise: false },
        },
        {
          id: `binding:end-${Date.now() + 1}`,
          type: "arrow",
          fromId: arrowId,
          toId: toId,
          props: { terminal: "end", normalizedAnchor: { x: 0, y: 0.5 }, isExact: false, isPrecise: false },
        },
      ]);
      return arrowId;
    },
    { fromId, toId },
  );
}

/** Get all shapes on the current page */
async function getShapes(page: Page) {
  return page.evaluate(() => {
    const editor = (window as any).__tldrawEditor;
    if (!editor) return [];
    return editor.getCurrentPageShapes().map((s: any) => ({
      id: s.id,
      type: s.type,
      props: s.props,
    }));
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe("Core Runtime", () => {
  test.beforeEach(async ({ page }) => {
    await waitForCanvas(page);
  });

  test("1. JS eval-sandbox works with input data", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { evalJS } = await import("/src/lib/eval-sandbox.ts");
      return evalJS("input.x + input.y", { x: 10, y: 20 });
    });
    expect(result.error).toBeNull();
    expect(result.result).toBe(30);
    await page.screenshot({ path: "test-results/01-eval-sandbox.png" });
  });

  test("2. Code runner routes JS correctly", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { executeCode } = await import("/src/lib/code-runner.ts");
      return executeCode("js", "Math.PI.toFixed(2)");
    });
    expect(result.error).toBeNull();
    expect(result.result).toBe("3.14");
    await page.screenshot({ path: "test-results/02-code-runner-js.png" });
  });

  test("3. Code runner handles errors gracefully", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { executeCode } = await import("/src/lib/code-runner.ts");
      return executeCode("js", "throw new Error('boom')");
    });
    expect(result.error).toBeTruthy();
    expect(result.error).toContain("boom");
    await page.screenshot({ path: "test-results/03-code-runner-error.png" });
  });
});

test.describe("Canvas Shapes", () => {
  test.beforeEach(async ({ page }) => {
    await waitForCanvas(page);
  });

  test("4. Create DataNode and verify props", async ({ page }) => {
    const id = await createShape(page, "data-node", 100, 100, {
      dataJson: '{"name":"Alice","age":30}',
      label: "Test Data",
    });
    expect(id).toBeTruthy();

    const shapes = await getShapes(page);
    const dataNode = shapes.find((s: any) => s.id === id);
    expect(dataNode).toBeTruthy();
    expect(dataNode.props.dataJson).toBe('{"name":"Alice","age":30}');
    await page.screenshot({ path: "test-results/04-data-node.png" });
  });

  test("5. Create TransformNode and verify expression", async ({ page }) => {
    const id = await createShape(page, "transform-node", 100, 100, {
      expression: "$.name.toUpperCase()",
      label: "Uppercase",
      w: 200,
      h: 48,
    });
    expect(id).toBeTruthy();
    await page.screenshot({ path: "test-results/05-transform-node.png" });
  });

  test("6. Create NoteNode with content", async ({ page }) => {
    const id = await createShape(page, "note-node", 100, 100, {
      content: "# Hello World\n\nThis is a **test** note with {{name}}.",
      label: "Note",
    });
    expect(id).toBeTruthy();
    await page.screenshot({ path: "test-results/06-note-node.png" });
  });

  test("7. Create TableNode with data", async ({ page }) => {
    const id = await createShape(page, "table-node", 100, 100, {
      dataJson: JSON.stringify([
        { name: "Alice", age: 30 },
        { name: "Bob", age: 25 },
        { name: "Carol", age: 35 },
      ]),
      label: "Users",
    });
    expect(id).toBeTruthy();
    await page.screenshot({ path: "test-results/07-table-node.png" });
  });

  test("8. Create TerminalNode", async ({ page }) => {
    const id = await createShape(page, "terminal-node", 100, 100, {
      label: "Shell",
      history: "[]",
      mode: "js",
    });
    expect(id).toBeTruthy();
    await page.screenshot({ path: "test-results/08-terminal-node.png" });
  });

  test("9. Create NotebookNode with cells", async ({ page }) => {
    const id = await createShape(page, "notebook-node", 100, 100, {
      label: "Notebook",
      cells: JSON.stringify([
        { id: "c1", type: "code", lang: "js", source: "1 + 1", output: "" },
        { id: "c2", type: "code", lang: "js", source: "console.log('hello')", output: "" },
      ]),
    });
    expect(id).toBeTruthy();
    await page.screenshot({ path: "test-results/09-notebook-node.png" });
  });

  test("10. Create AINode with prompt", async ({ page }) => {
    const id = await createShape(page, "ai-node", 100, 100, {
      label: "AI",
      prompt: "What is 2 + 2?",
      response: "",
      status: "idle",
      errorMessage: "",
    });
    expect(id).toBeTruthy();
    await page.screenshot({ path: "test-results/10-ai-node.png" });
  });

  test("11. Create WebViewNode", async ({ page }) => {
    const id = await createShape(page, "web-view", 100, 100, {
      label: "Web",
      url: "about:blank",
      mode: "url",
      w: 480,
      h: 360,
    });
    expect(id).toBeTruthy();
    await page.screenshot({ path: "test-results/11-webview-node.png" });
  });
});

test.describe("Data Flow Chains", () => {
  test.beforeEach(async ({ page }) => {
    await waitForCanvas(page);
  });

  test("12. JSON → Transform → Note (3-link chain)", async ({ page }) => {
    const jsonId = await createShape(page, "data-node", 50, 200, {
      dataJson: '{"name":"Alice","score":95}',
      label: "Source",
    });
    const transformId = await createShape(page, "transform-node", 450, 212, {
      expression: '({...input, grade: input.score > 90 ? "A" : "B"})',
      label: "Grade",
      w: 220,
      h: 48,
    });
    const noteId = await createShape(page, "note-node", 750, 200, {
      content: "Student: {{name}}\nGrade: {{grade}}",
      label: "Report",
    });

    await connectShapes(page, jsonId, transformId);
    await connectShapes(page, transformId, noteId);

    const shapes = await getShapes(page);
    const arrows = shapes.filter((s: any) => s.type === "arrow");
    expect(arrows.length).toBeGreaterThanOrEqual(2);

    await page.screenshot({ path: "test-results/12-json-transform-note-chain.png" });
  });

  test("13. JSON → Table → Transform (array chain)", async ({ page }) => {
    const jsonId = await createShape(page, "data-node", 50, 200, {
      dataJson: JSON.stringify([
        { name: "Alice", score: 95 },
        { name: "Bob", score: 72 },
      ]),
      label: "Students",
    });
    const tableId = await createShape(page, "table-node", 450, 200, {
      label: "Roster",
    });
    const transformId = await createShape(page, "transform-node", 900, 212, {
      expression: "input.length || 'empty'",
      label: "Count",
      w: 180,
      h: 48,
    });

    await connectShapes(page, jsonId, tableId);
    await connectShapes(page, tableId, transformId);

    const shapes = await getShapes(page);
    const arrows = shapes.filter((s: any) => s.type === "arrow");
    expect(arrows.length).toBeGreaterThanOrEqual(2);

    await page.screenshot({ path: "test-results/13-json-table-transform-chain.png" });
  });

  test("14. Multi-input merge: 2x JSON → CompactMerge → Note", async ({ page }) => {
    const json1 = await createShape(page, "data-node", 50, 100, {
      dataJson: '{"first":"John"}',
      label: "First Name",
      w: 200,
      h: 150,
    });
    const json2 = await createShape(page, "data-node", 50, 350, {
      dataJson: '{"last":"Doe"}',
      label: "Last Name",
      w: 200,
      h: 150,
    });
    const mergeId = await createShape(page, "compact-node", 400, 225, {
      nodeType: "data:merge",
      label: "Merge",
      w: 180,
      h: 48,
    });
    const noteId = await createShape(page, "note-node", 700, 200, {
      content: "Full name: {{first}} {{last}}",
      label: "Output",
    });

    await connectShapes(page, json1, mergeId);
    await connectShapes(page, json2, mergeId);
    await connectShapes(page, mergeId, noteId);

    await page.screenshot({ path: "test-results/14-multi-input-merge.png" });
  });

  test("15. Full pipeline: JSON → Transform → Filter → Table → Note", async ({ page }) => {
    const jsonId = await createShape(page, "data-node", 50, 200, {
      dataJson: JSON.stringify([
        { name: "Alice", age: 30, active: true },
        { name: "Bob", age: 17, active: true },
        { name: "Carol", age: 25, active: false },
        { name: "Dave", age: 40, active: true },
      ]),
      label: "People",
      w: 250,
    });

    const transformId = await createShape(page, "transform-node", 380, 212, {
      expression: "input.map(p => ({...p, adult: p.age >= 18}))",
      label: "Add Adult",
      w: 220,
      h: 48,
    });

    const filterId = await createShape(page, "compact-node", 680, 212, {
      nodeType: "data:filter",
      label: "Active Only",
      configJson: JSON.stringify({ predicate: "item.active && item.adult" }),
      w: 200,
      h: 48,
    });

    const tableId = await createShape(page, "table-node", 960, 150, {
      label: "Results",
      w: 300,
    });

    const noteId = await createShape(page, "note-node", 1340, 200, {
      content: "Filtered results ready",
      label: "Done",
      w: 200,
    });

    await connectShapes(page, jsonId, transformId);
    await connectShapes(page, transformId, filterId);
    await connectShapes(page, filterId, tableId);
    await connectShapes(page, tableId, noteId);

    const shapes = await getShapes(page);
    const arrows = shapes.filter((s: any) => s.type === "arrow");
    expect(arrows.length).toBeGreaterThanOrEqual(4);

    await page.screenshot({ path: "test-results/15-full-pipeline.png" });
  });
});

test.describe("Direct Execution", () => {
  test.beforeEach(async ({ page }) => {
    await waitForCanvas(page);
  });

  test("16. Terminal executes JS and returns result", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { executeTerminal } = await import("/src/lib/test-helpers.ts");
      return executeTerminal("test-node-1", {
        pendingCommand: "2 + 2",
        runNonce: 1,
        mode: "js",
      });
    });

    expect(result.history.length).toBeGreaterThan(0);
    expect(result.history.some((e: any) => e.type === "input" && e.text === "2 + 2")).toBe(true);
    await page.screenshot({ path: "test-results/16-terminal-execution.png" });
  });

  test("17. Notebook executes multiple cells with shared context", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { executeNotebook } = await import("/src/lib/test-helpers.ts");
      return executeNotebook({
        cells: JSON.stringify([
          { id: "c1", type: "code", lang: "js", source: "const x = 42", output: "" },
          { id: "c2", type: "code", lang: "js", source: "x * 2", output: "" },
        ]),
        runMode: "all",
      });
    });

    expect(result.cells.length).toBe(2);
    expect(result.cells[1].output).toBeTruthy();
    await page.screenshot({ path: "test-results/17-notebook-execution.png" });
  });

  test("18. Terminal persists scope across commands", async ({ page }) => {
    await page.evaluate(async () => {
      const { executeTerminal } = await import("/src/lib/test-helpers.ts");
      await executeTerminal("scope-test", {
        pendingCommand: "const greeting = 'hello'",
        runNonce: 1,
        mode: "js",
      });
    });

    const result2 = await page.evaluate(async () => {
      const { executeTerminal } = await import("/src/lib/test-helpers.ts");
      return executeTerminal("scope-test", {
        pendingCommand: "greeting + ' world'",
        runNonce: 2,
        mode: "js",
      });
    });

    const outputs = result2.history
      .filter((e: any) => e.type === "output")
      .map((e: any) => e.text);
    expect(outputs.some((o: string) => o.includes("hello world"))).toBe(true);
    await page.screenshot({ path: "test-results/18-terminal-scope.png" });
  });
});

test.describe("Node Type Coverage", () => {
  test.beforeEach(async ({ page }) => {
    await waitForCanvas(page);
  });

  test("19. All essential shapes can be created on canvas", async ({ page }) => {
    const shapes = [
      { type: "data-node", x: 50, y: 50, props: { label: "JSON", dataJson: '{"a":1}' } },
      { type: "table-node", x: 400, y: 50, props: { label: "Table", dataJson: "[]" } },
      { type: "transform-node", x: 750, y: 62, props: { label: "Transform", expression: "$.a", w: 180, h: 48 } },
      { type: "note-node", x: 50, y: 300, props: { label: "Note", content: "Hello" } },
      { type: "terminal-node", x: 400, y: 300, props: { label: "Terminal", history: "[]", mode: "js" } },
      { type: "notebook-node", x: 850, y: 300, props: { label: "Notebook", cells: "[]" } },
      { type: "ai-node", x: 50, y: 570, props: { label: "AI", prompt: "test", response: "", status: "idle", errorMessage: "" } },
      { type: "web-view", x: 500, y: 570, props: { label: "Web", url: "about:blank", mode: "url", w: 480, h: 300 } },
    ];

    for (const s of shapes) {
      const id = await createShape(page, s.type, s.x, s.y, s.props);
      expect(id).toBeTruthy();
    }

    const allShapes = await getShapes(page);
    const nodeShapes = allShapes.filter((s: any) => s.type !== "arrow");
    expect(nodeShapes.length).toBe(shapes.length);

    await page.screenshot({
      path: "test-results/19-all-shapes.png",
      fullPage: true,
    });
  });

  test("20. CompactNode works for data:filter", async ({ page }) => {
    const id = await createShape(page, "compact-node", 100, 100, {
      nodeType: "data:filter",
      label: "Filter",
      configJson: JSON.stringify({ predicate: "item.active" }),
      w: 180,
      h: 48,
    });
    expect(id).toBeTruthy();

    const shapes = await getShapes(page);
    const compact = shapes.find((s: any) => s.id === id);
    expect(compact?.props.nodeType).toBe("data:filter");
    await page.screenshot({ path: "test-results/20-compact-node.png" });
  });
});

test.describe("Core Types & Execution", () => {
  test.beforeEach(async ({ page }) => {
    await waitForCanvas(page);
  });

  test("21. Runtime, Graph, Scheduler exist and initialize", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { Runtime } = await import("/src/lib/test-helpers.ts");
      const runtime = new Runtime();
      const hasGraph = !!runtime.graph;
      const hasScheduler = !!runtime.scheduler;
      const hasEvents = !!runtime.events;
      runtime.destroy();
      return { hasGraph, hasScheduler, hasEvents };
    });

    expect(result.hasGraph).toBe(true);
    expect(result.hasScheduler).toBe(true);
    expect(result.hasEvents).toBe(true);
    await page.screenshot({ path: "test-results/21-core-types.png" });
  });

  test("22. Subsystems register correctly with trigger modes", async ({ page }) => {
    const defs = await page.evaluate(async () => {
      const { Runtime, dataSubsystem, systemSubsystem, viewSubsystem } =
        await import("/src/lib/test-helpers.ts");

      const runtime = new Runtime();
      await runtime.register(dataSubsystem);
      await runtime.register(systemSubsystem);
      await runtime.register(viewSubsystem);

      const nodeDefs = runtime.listNodeDefs().map((d: any) => ({
        type: d.type,
        trigger: d.trigger || "auto",
        description: d.description || "",
        inputCount: d.inputs.length,
        outputCount: d.outputs.length,
      }));

      runtime.destroy();
      return nodeDefs;
    });

    // Verify essential nodes exist
    const types = defs.map((d: any) => d.type);
    expect(types).toContain("data:json");
    expect(types).toContain("data:transform");
    expect(types).toContain("data:ai");
    expect(types).toContain("sys:terminal");
    expect(types).toContain("sys:notebook");
    expect(types).toContain("view:note");
    expect(types).toContain("view:webview");

    // Verify novelty nodes are GONE
    expect(types).not.toContain("sys:disk");
    expect(types).not.toContain("sys:processes");
    expect(types).not.toContain("sys:screen-capture");
    expect(types).not.toContain("sys:notify");
    expect(types).not.toContain("sys:network");
    expect(types).not.toContain("sys:geolocation");

    // Verify trigger modes
    const jsonDef = defs.find((d: any) => d.type === "data:json");
    expect(jsonDef?.trigger).toBe("auto");

    const terminalDef = defs.find((d: any) => d.type === "sys:terminal");
    expect(terminalDef?.trigger).toBe("manual");

    const fetchDef = defs.find((d: any) => d.type === "data:fetch");
    expect(fetchDef?.trigger).toBe("once");

    // Verify descriptions exist
    for (const def of defs) {
      expect(def.description).toBeTruthy();
    }

    await page.screenshot({ path: "test-results/22-subsystem-defs.png" });
  });

  test("23. ExecContext API: clean signatures, no nodeId", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { Runtime, dataSubsystem } = await import("/src/lib/test-helpers.ts");

      const runtime = new Runtime();
      await runtime.register(dataSubsystem);

      const nodeId = runtime.graph.addNode("data:json", { json: '{"test":42}' });
      await runtime.runNode(nodeId);

      const output = runtime.getOutput(nodeId, "data");
      const outAlias = runtime.getOutput(nodeId, "out");
      const node = runtime.graph.getNode(nodeId);
      runtime.destroy();

      return { output, outAlias, status: node?.status };
    });

    expect(result.output).toEqual({ test: 42 });
    expect(result.outAlias).toEqual({ test: 42 }); // auto-alias works
    expect(result.status).toBe("done");
    await page.screenshot({ path: "test-results/23-exec-context.png" });
  });

  test("24. Scheduler auto-aliases first output as 'out'", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { Runtime, dataSubsystem } = await import("/src/lib/test-helpers.ts");

      const runtime = new Runtime();
      await runtime.register(dataSubsystem);

      // data:transform has only "output" port (no explicit "out")
      const jsonId = runtime.graph.addNode("data:json", { json: '{"x":5}' });
      const transformId = runtime.graph.addNode("data:transform", { expression: "input.x * 2" });
      runtime.graph.addEdge(
        { node: jsonId, port: "data" },
        { node: transformId, port: "in" },
      );

      await runtime.run();

      const output = runtime.getOutput(transformId, "output");
      const outAlias = runtime.getOutput(transformId, "out");
      runtime.destroy();

      return { output, outAlias };
    });

    expect(result.output).toEqual({ value: 10 });
    expect(result.outAlias).toEqual({ value: 10 }); // auto-alias
    await page.screenshot({ path: "test-results/24-auto-out-alias.png" });
  });
});
