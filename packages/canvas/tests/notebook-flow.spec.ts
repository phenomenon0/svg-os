/**
 * Notebook Flow Diagnostic Tests
 * Tests notebook-to-notebook data flow, error isolation, and backward reactivity.
 */

import { test, expect, type Page } from "@playwright/test";

async function waitForApp(page: Page) {
  await page.goto("/");
  await page.waitForSelector(".tl-container", { timeout: 15_000 });
  await page.waitForFunction(() => !!(window as any).__tldrawEditor, { timeout: 10_000 });
  await page.waitForTimeout(500);
}

async function placeNode(page: Page, type: string, x: number, y: number, props: Record<string, unknown> = {}) {
  return page.evaluate(({ type, x, y, props }) => {
    const editor = (window as any).__tldrawEditor;
    const id = `shape:${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    editor.createShape({ id, type, x, y, props: { w: props.w ?? 300, h: props.h ?? 200, ...props } });
    return id;
  }, { type, x, y, props });
}

async function connect(page: Page, fromId: string, toId: string) {
  await page.evaluate(({ fromId, toId }) => {
    const editor = (window as any).__tldrawEditor;
    const id = `shape:arrow-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    editor.createShape({ id, type: "arrow", props: {} });
    editor.createBindings([
      { id: `binding:s-${Date.now()}`, type: "arrow", fromId: id, toId: fromId, props: { terminal: "start", normalizedAnchor: { x: 1, y: 0.5 }, isExact: false, isPrecise: false } },
      { id: `binding:e-${Date.now() + 1}`, type: "arrow", fromId: id, toId: toId, props: { terminal: "end", normalizedAnchor: { x: 0, y: 0.5 }, isExact: false, isPrecise: false } },
    ]);
  }, { fromId, toId });
}

async function triggerRun(page: Page) {
  await page.evaluate(async () => {
    const runtime = (window as any).__svgosRuntime;
    const editor = (window as any).__tldrawEditor;
    if (!runtime) return;
    const bridge = await import("/src/lib/runtime-bridge.ts");
    bridge.syncShapesToRuntime(editor, runtime);
    bridge.rebuildEdges(editor, runtime);
    await runtime.run();
    bridge.syncRuntimeToShapes(editor, runtime);
  });
  await page.waitForTimeout(300);
}

/** Run a notebook's cells directly (simulates clicking RUN ALL) */
async function runNotebook(page: Page, shapeId: string) {
  return page.evaluate(async ({ shapeId }) => {
    const editor = (window as any).__tldrawEditor;
    const runtime = (window as any).__svgosRuntime;
    const { executeCode } = await import("/src/lib/code-runner.ts");
    const { formatResult } = await import("/src/lib/eval-sandbox.ts");
    const { getNodeId } = await import("/src/lib/runtime-bridge.ts");

    const shape = editor.getShape(shapeId);
    if (!shape) return { error: "shape not found" };

    const cells = JSON.parse(shape.props.cells);

    // Get upstream data
    const nodeId = getNodeId(shapeId);
    let ctx: Record<string, unknown> = {};
    if (nodeId && runtime) {
      for (const portName of ["in", "data"]) {
        const edges = runtime.graph.getEdgesTo(nodeId, portName);
        for (const edge of edges) {
          const val = runtime.getOutput(edge.from.node, edge.from.port);
          if (val && typeof val === "object" && !Array.isArray(val)) {
            Object.assign(ctx, val);
          } else if (val !== undefined) {
            ctx.value = val;
          }
        }
      }
    }

    // Execute cells
    for (let i = 0; i < cells.length; i++) {
      if (cells[i].type !== "code") continue;
      const { output, result, error } = await executeCode(cells[i].lang, cells[i].source, ctx);
      const lines = [...output];
      if (error) lines.push(`Error: ${error}`);
      else if (result !== undefined) {
        const fmt = formatResult(result);
        if (fmt) lines.push(fmt);
        if (typeof result === "object" && result !== null) Object.assign(ctx, result);
        else ctx[`cell${i}`] = result;
      }
      cells[i] = { ...cells[i], output: lines.join("\n") };
    }

    // Update shape
    editor.updateShape({ id: shapeId, type: "notebook-node", props: { cells: JSON.stringify(cells) } });

    return { cells, ctx };
  }, { shapeId });
}

// ── Tests ────────────────────────────────────────────────────────────────

test.describe("Notebook Flow", () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
  });

  test("1. Single notebook, JS cell 2+2", async ({ page }) => {
    const nbId = await placeNode(page, "notebook-node", 100, 100, {
      label: "NB", cells: JSON.stringify([
        { id: "c1", type: "code", lang: "js", source: "2 + 2", output: "" },
      ]),
    });

    const result = await runNotebook(page, nbId);
    expect(result.cells[0].output).toContain("4");
  });

  test("2. Single notebook, Python cell 2+2", async ({ page }) => {
    test.setTimeout(60_000);
    const nbId = await placeNode(page, "notebook-node", 100, 100, {
      label: "NB", cells: JSON.stringify([
        { id: "c1", type: "code", lang: "python", source: "2 + 2", output: "" },
      ]),
    });

    const result = await runNotebook(page, nbId);
    expect(result.cells[0].output).toContain("4");
  });

  test("3. Single notebook, 2 JS cells, cell2 uses cell1 context", async ({ page }) => {
    const nbId = await placeNode(page, "notebook-node", 100, 100, {
      label: "NB", cells: JSON.stringify([
        { id: "c1", type: "code", lang: "js", source: "({x: 42})", output: "" },
        { id: "c2", type: "code", lang: "js", source: "input.x * 2", output: "" },
      ]),
    });

    const result = await runNotebook(page, nbId);
    expect(result.cells[0].output).toContain("42");
    expect(result.cells[1].output).toContain("84");
  });

  test("4. Notebook A → Notebook B: forward data flow", async ({ page }) => {
    const nbA = await placeNode(page, "notebook-node", 50, 100, {
      label: "NB-A", cells: JSON.stringify([
        { id: "c1", type: "code", lang: "js", source: "({x: 1, name: 'hello'})", output: "" },
      ]),
      w: 350,
    });
    const nbB = await placeNode(page, "notebook-node", 500, 100, {
      label: "NB-B", cells: JSON.stringify([
        { id: "c1", type: "code", lang: "js", source: "input.name + ' world'", output: "" },
      ]),
      w: 350,
    });

    await connect(page, nbA, nbB);

    // Run A first, then sync runtime, then run B
    await runNotebook(page, nbA);
    await triggerRun(page); // syncs A's output to runtime cache
    const result = await runNotebook(page, nbB);

    expect(result.cells[0].output).toContain("hello world");
  });

  test("5. Notebook A errors → Notebook B gets clean data, not error string", async ({ page }) => {
    const nbA = await placeNode(page, "notebook-node", 50, 100, {
      label: "NB-A", cells: JSON.stringify([
        { id: "c1", type: "code", lang: "js", source: "throw new Error('broken')", output: "" },
      ]),
      w: 350,
    });
    const nbB = await placeNode(page, "notebook-node", 500, 100, {
      label: "NB-B", cells: JSON.stringify([
        { id: "c1", type: "code", lang: "js", source: "JSON.stringify(input)", output: "" },
      ]),
      w: 350,
    });

    await connect(page, nbA, nbB);
    await runNotebook(page, nbA);
    await triggerRun(page);
    const result = await runNotebook(page, nbB);

    // B should NOT see error strings as data
    const output = result.cells[0].output;
    expect(output).not.toContain("Error:");
    expect(output).not.toContain("broken");
  });

  test("6. Editing Notebook B does NOT re-execute Notebook A", async ({ page }) => {
    const nbA = await placeNode(page, "notebook-node", 50, 100, {
      label: "NB-A", cells: JSON.stringify([
        { id: "c1", type: "code", lang: "js", source: "({counter: Date.now()})", output: "" },
      ]),
      w: 350,
    });
    const nbB = await placeNode(page, "notebook-node", 500, 100, {
      label: "NB-B", cells: JSON.stringify([
        { id: "c1", type: "code", lang: "js", source: "input.counter", output: "" },
      ]),
      w: 350,
    });

    await connect(page, nbA, nbB);
    await runNotebook(page, nbA);
    await triggerRun(page);

    // Record A's output
    const before = await page.evaluate((id: string) => {
      const editor = (window as any).__tldrawEditor;
      return editor.getShape(id)?.props.cells;
    }, nbA);

    // Edit B's cell (simulates typing)
    await page.evaluate((id: string) => {
      const editor = (window as any).__tldrawEditor;
      const shape = editor.getShape(id);
      const cells = JSON.parse(shape.props.cells);
      cells[0].source = "input.counter + 1";
      editor.updateShape({ id, type: "notebook-node", props: { cells: JSON.stringify(cells) } });
    }, nbB);
    await page.waitForTimeout(500);

    // Check A hasn't changed
    const after = await page.evaluate((id: string) => {
      const editor = (window as any).__tldrawEditor;
      return editor.getShape(id)?.props.cells;
    }, nbA);

    expect(after).toBe(before);
  });

  test("7. Data → Notebook A → Notebook B: 3-link chain", async ({ page }) => {
    const dataId = await placeNode(page, "data-node", 50, 200, {
      label: "Source", dataJson: JSON.stringify({ value: 10 }),
      w: 220, h: 150,
    });
    const nbA = await placeNode(page, "notebook-node", 350, 150, {
      label: "NB-A", cells: JSON.stringify([
        { id: "c1", type: "code", lang: "js", source: "({doubled: input.value * 2})", output: "" },
      ]),
      w: 350,
    });
    const nbB = await placeNode(page, "notebook-node", 780, 150, {
      label: "NB-B", cells: JSON.stringify([
        { id: "c1", type: "code", lang: "js", source: "input.doubled + ' is the answer'", output: "" },
      ]),
      w: 350,
    });

    await connect(page, dataId, nbA);
    await connect(page, nbA, nbB);
    await triggerRun(page); // data node outputs {value: 10}
    await runNotebook(page, nbA); // A reads input.value=10, outputs {doubled:20}
    await triggerRun(page); // sync A's output
    const result = await runNotebook(page, nbB);

    expect(result.cells[0].output).toContain("20 is the answer");
  });

  test("8. Notebook with error then fix — error clears", async ({ page }) => {
    const nbId = await placeNode(page, "notebook-node", 100, 100, {
      label: "NB", cells: JSON.stringify([
        { id: "c1", type: "code", lang: "js", source: "undefinedVar", output: "" },
      ]),
    });

    // First run: error
    const r1 = await runNotebook(page, nbId);
    expect(r1.cells[0].output).toContain("Error:");

    // Fix the cell
    await page.evaluate((id: string) => {
      const editor = (window as any).__tldrawEditor;
      const shape = editor.getShape(id);
      const cells = JSON.parse(shape.props.cells);
      cells[0].source = "42";
      editor.updateShape({ id, type: "notebook-node", props: { cells: JSON.stringify(cells) } });
    }, nbId);

    // Second run: should be clean
    const r2 = await runNotebook(page, nbId);
    expect(r2.cells[0].output).toContain("42");
    expect(r2.cells[0].output).not.toContain("Error:");
  });

  test("9. Notebook A → Note: interpolation works", async ({ page }) => {
    const nbA = await placeNode(page, "notebook-node", 50, 150, {
      label: "NB-A", cells: JSON.stringify([
        { id: "c1", type: "code", lang: "js", source: "({greeting: 'Hello', target: 'World'})", output: "" },
      ]),
      w: 350,
    });
    const noteId = await placeNode(page, "note-node", 500, 150, {
      label: "Output", content: "{{greeting}}, {{target}}!", mode: "preview",
      w: 300, h: 200,
    });

    await connect(page, nbA, noteId);
    await runNotebook(page, nbA);
    // Sync notebook output to runtime, then run downstream (note)
    await triggerRun(page);
    // Run again so the note's execute reads the notebook's updated output
    await triggerRun(page);

    const noteProps = await page.evaluate((id: string) => {
      const editor = (window as any).__tldrawEditor;
      return editor.getShape(id)?.props;
    }, noteId);

    expect(noteProps.renderedContent).toContain("Hello");
    expect(noteProps.renderedContent).toContain("World");
  });

  test("10. scheduleRun skips notebook cell edits", async ({ page }) => {
    // Track how many times runtime.run() is called
    const runCount = await page.evaluate(async () => {
      const runtime = (window as any).__svgosRuntime;
      let count = 0;
      const origRun = runtime.run.bind(runtime);
      runtime.run = async function() {
        count++;
        return origRun();
      };
      (window as any).__runCount = () => count;
      return count;
    });

    const nbId = await placeNode(page, "notebook-node", 100, 100, {
      label: "NB", cells: JSON.stringify([
        { id: "c1", type: "code", lang: "js", source: "", output: "" },
      ]),
    });
    await page.waitForTimeout(1000); // let initial runs settle

    const before = await page.evaluate(() => (window as any).__runCount());

    // Edit the cell 3 times (simulates typing)
    for (const text of ["a", "ab", "abc"]) {
      await page.evaluate(({ id, text }) => {
        const editor = (window as any).__tldrawEditor;
        const shape = editor.getShape(id);
        const cells = JSON.parse(shape.props.cells);
        cells[0].source = text;
        editor.updateShape({ id, type: "notebook-node", props: { cells: JSON.stringify(cells) } });
      }, { id: nbId, text });
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(500);

    const after = await page.evaluate(() => (window as any).__runCount());

    // Should NOT have triggered many runs just from typing
    // Before fix: each edit triggers scheduleRun → runtime.run()
    // After fix: notebook cell edits are skipped
    console.log(`Runs before: ${before}, after: ${after}, diff: ${after - before}`);
    // We allow 1 run (from shape creation) but not 3+ from typing
    expect(after - before).toBeLessThanOrEqual(1);
  });
});
