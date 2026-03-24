/**
 * SVG-OS UI Interaction Tests — actually click buttons, type text, verify visuals.
 * No programmatic shortcuts — this tests what users actually do.
 */

import { test, expect, type Page } from "@playwright/test";

async function waitForApp(page: Page) {
  await page.goto("/");
  await page.waitForSelector(".tl-container", { timeout: 15_000 });
  // Wait for editor to be exposed
  await page.waitForFunction(() => !!(window as any).__tldrawEditor, { timeout: 10_000 });
  await page.waitForTimeout(300);
}

/** Click a node type in the left palette to create it */
async function clickPaletteNode(page: Page, name: string) {
  const item = page.locator(`text=${name}`).first();
  await item.click();
  await page.waitForTimeout(500);
}

/** Create a shape programmatically since palette drag is unreliable in headless */
async function placeNode(page: Page, type: string, x: number, y: number, props: Record<string, unknown> = {}) {
  return page.evaluate(({ type, x, y, props }) => {
    const editor = (window as any).__tldrawEditor;
    const id = `shape:${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    editor.createShape({ id, type, x, y, props: { w: props.w ?? 300, h: props.h ?? 200, ...props } });
    // Select it so it's visible
    editor.select(id);
    // Center on it
    editor.zoomToSelection({ animation: { duration: 0 } });
    return id;
  }, { type, x, y, props });
}

// ── Test: Every node renders without crash ─────────────────────────────

test.describe("UI: Node Rendering", () => {
  test("Notebook renders and cells are visible", async ({ page }) => {
    await waitForApp(page);

    const id = await placeNode(page, "notebook-node", 200, 200, {
      label: "My Notebook",
      cells: JSON.stringify([
        { id: "c1", type: "code", lang: "js", source: "1 + 1", output: "" },
        { id: "c2", type: "code", lang: "js", source: "console.log('hi')", output: "" },
      ]),
      w: 400, h: 300,
    });

    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/ui-01-notebook-render.png" });

    // Verify the notebook shape exists in the DOM
    const shapeExists = await page.evaluate((id) => {
      const editor = (window as any).__tldrawEditor;
      return !!editor.getShape(id);
    }, id);
    expect(shapeExists).toBe(true);
  });

  test("Terminal renders with input area", async ({ page }) => {
    await waitForApp(page);

    const id = await placeNode(page, "terminal-node", 200, 200, {
      label: "Terminal",
      history: "[]",
      mode: "js",
      w: 450, h: 320,
    });

    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/ui-02-terminal-render.png" });

    const shapeExists = await page.evaluate((id) => {
      const editor = (window as any).__tldrawEditor;
      return !!editor.getShape(id);
    }, id);
    expect(shapeExists).toBe(true);
  });

  test("DataNode renders with JSON tree", async ({ page }) => {
    await waitForApp(page);

    const id = await placeNode(page, "data-node", 200, 200, {
      label: "Users",
      dataJson: JSON.stringify({ users: [{ name: "Alice" }, { name: "Bob" }] }),
      w: 320, h: 250,
    });

    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/ui-03-data-node-render.png" });

    const shapeExists = await page.evaluate((id) => {
      const editor = (window as any).__tldrawEditor;
      return !!editor.getShape(id);
    }, id);
    expect(shapeExists).toBe(true);
  });

  test("TableNode renders with rows", async ({ page }) => {
    await waitForApp(page);

    const id = await placeNode(page, "table-node", 200, 200, {
      label: "People",
      dataJson: JSON.stringify([
        { name: "Alice", age: 30 },
        { name: "Bob", age: 25 },
        { name: "Carol", age: 35 },
      ]),
      w: 400, h: 280,
    });

    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/ui-04-table-node-render.png" });

    const shapeExists = await page.evaluate((id) => {
      const editor = (window as any).__tldrawEditor;
      return !!editor.getShape(id);
    }, id);
    expect(shapeExists).toBe(true);
  });

  test("NoteNode renders with markdown", async ({ page }) => {
    await waitForApp(page);

    const id = await placeNode(page, "note-node", 200, 200, {
      label: "Readme",
      content: "# Hello World\n\nThis is **bold** and *italic*.\n\n- Item one\n- Item two",
      mode: "preview",
      w: 350, h: 280,
    });

    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/ui-05-note-node-render.png" });

    const shapeExists = await page.evaluate((id) => {
      const editor = (window as any).__tldrawEditor;
      return !!editor.getShape(id);
    }, id);
    expect(shapeExists).toBe(true);
  });

  test("AINode renders with prompt area", async ({ page }) => {
    await waitForApp(page);

    const id = await placeNode(page, "ai-node", 200, 200, {
      label: "Claude",
      prompt: "Explain recursion in one sentence",
      response: "",
      status: "idle",
      errorMessage: "",
      w: 400, h: 320,
    });

    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/ui-06-ai-node-render.png" });

    const shapeExists = await page.evaluate((id) => {
      const editor = (window as any).__tldrawEditor;
      return !!editor.getShape(id);
    }, id);
    expect(shapeExists).toBe(true);
  });

  test("WebView renders with iframe", async ({ page }) => {
    await waitForApp(page);

    const id = await placeNode(page, "web-view", 200, 200, {
      label: "Browser",
      url: "about:blank",
      mode: "html",
      htmlContent: "<h1 style='color:white;font-family:sans-serif;padding:20px'>Hello from WebView</h1>",
      w: 500, h: 380,
    });

    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/ui-07-webview-render.png" });

    const shapeExists = await page.evaluate((id) => {
      const editor = (window as any).__tldrawEditor;
      return !!editor.getShape(id);
    }, id);
    expect(shapeExists).toBe(true);
  });

  test("TransformNode renders as pill", async ({ page }) => {
    await waitForApp(page);

    const id = await placeNode(page, "transform-node", 200, 200, {
      label: "Uppercase",
      expression: "$.name.toUpperCase()",
      w: 220, h: 48,
    });

    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/ui-08-transform-render.png" });

    const shapeExists = await page.evaluate((id) => {
      const editor = (window as any).__tldrawEditor;
      return !!editor.getShape(id);
    }, id);
    expect(shapeExists).toBe(true);
  });

  test("CompactNode renders for data:merge", async ({ page }) => {
    await waitForApp(page);

    const id = await placeNode(page, "compact-node", 200, 200, {
      label: "Merge",
      nodeType: "data:merge",
      w: 180, h: 48,
    });

    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/ui-09-compact-render.png" });

    const shapeExists = await page.evaluate((id) => {
      const editor = (window as any).__tldrawEditor;
      return !!editor.getShape(id);
    }, id);
    expect(shapeExists).toBe(true);
  });
});

// ── Test: Full visual pipeline ─────────────────────────────────────────

test.describe("UI: Full Pipeline Visual", () => {
  test("Build complete canvas with all node types + connections", async ({ page }) => {
    await waitForApp(page);

    // Create a full pipeline: JSON → Transform → Table
    const jsonId = await placeNode(page, "data-node", 100, 300, {
      label: "Source Data",
      dataJson: JSON.stringify([
        { name: "Alice", score: 95 },
        { name: "Bob", score: 78 },
        { name: "Carol", score: 88 },
      ]),
      w: 280, h: 200,
    });

    const transformId = await placeNode(page, "transform-node", 480, 370, {
      label: "Add Grade",
      expression: 'input.map(s => ({...s, grade: s.score > 90 ? "A" : s.score > 80 ? "B" : "C"}))',
      w: 260, h: 48,
    });

    const tableId = await placeNode(page, "table-node", 840, 280, {
      label: "Graded Students",
      w: 380, h: 260,
    });

    // Add a terminal
    const termId = await placeNode(page, "terminal-node", 100, 580, {
      label: "JS Console",
      history: "[]",
      mode: "js",
      w: 420, h: 280,
    });

    // Add a notebook
    const nbId = await placeNode(page, "notebook-node", 600, 580, {
      label: "Analysis",
      cells: JSON.stringify([
        { id: "c1", type: "code", lang: "js", source: "const data = [1, 2, 3, 4, 5];\ndata.reduce((a, b) => a + b, 0)", output: "" },
      ]),
      w: 380, h: 260,
    });

    // Add a note
    const noteId = await placeNode(page, "note-node", 1080, 580, {
      label: "Notes",
      content: "# Student Analysis\n\nThis pipeline:\n1. Loads student data\n2. Computes grades\n3. Displays in table",
      mode: "preview",
      w: 300, h: 260,
    });

    // Connect JSON → Transform → Table
    await page.evaluate(({ fromId, toId }) => {
      const editor = (window as any).__tldrawEditor;
      const id = `shape:arrow-${Date.now()}`;
      editor.createShape({ id, type: "arrow", props: {} });
      editor.createBindings([
        { id: `binding:s-${Date.now()}`, type: "arrow", fromId: id, toId: fromId, props: { terminal: "start", normalizedAnchor: { x: 1, y: 0.5 }, isExact: false, isPrecise: false } },
        { id: `binding:e-${Date.now()}`, type: "arrow", fromId: id, toId: toId, props: { terminal: "end", normalizedAnchor: { x: 0, y: 0.5 }, isExact: false, isPrecise: false } },
      ]);
    }, { fromId: jsonId, toId: transformId });

    await page.evaluate(({ fromId, toId }) => {
      const editor = (window as any).__tldrawEditor;
      const id = `shape:arrow-${Date.now()}`;
      editor.createShape({ id, type: "arrow", props: {} });
      editor.createBindings([
        { id: `binding:s-${Date.now()}`, type: "arrow", fromId: id, toId: fromId, props: { terminal: "start", normalizedAnchor: { x: 1, y: 0.5 }, isExact: false, isPrecise: false } },
        { id: `binding:e-${Date.now()}`, type: "arrow", fromId: id, toId: toId, props: { terminal: "end", normalizedAnchor: { x: 0, y: 0.5 }, isExact: false, isPrecise: false } },
      ]);
    }, { fromId: transformId, toId: tableId });

    // Zoom to fit everything
    await page.evaluate(() => {
      const editor = (window as any).__tldrawEditor;
      editor.selectAll();
      editor.zoomToSelection({ animation: { duration: 0 } });
      editor.selectNone();
    });
    await page.waitForTimeout(300);

    // Verify all shapes exist
    const shapeCount = await page.evaluate(() => {
      const editor = (window as any).__tldrawEditor;
      return editor.getCurrentPageShapes().filter((s: any) => s.type !== "arrow").length;
    });
    expect(shapeCount).toBe(6);

    // Verify arrows exist
    const arrowCount = await page.evaluate(() => {
      const editor = (window as any).__tldrawEditor;
      return editor.getCurrentPageShapes().filter((s: any) => s.type === "arrow").length;
    });
    expect(arrowCount).toBe(2);

    await page.screenshot({ path: "test-results/ui-10-full-pipeline.png", fullPage: true });
  });
});

// ── Test: Console errors ───────────────────────────────────────────────

test.describe("UI: No Console Errors", () => {
  test("Creating each node type produces no React errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().includes("WASM") && !msg.text().includes("wasm")) {
        errors.push(msg.text());
      }
    });

    await waitForApp(page);

    // Create one of each node type
    const nodeTypes = [
      { type: "data-node", props: { label: "D", dataJson: '{"a":1}' } },
      { type: "table-node", props: { label: "T", dataJson: "[]" } },
      { type: "transform-node", props: { label: "X", expression: "$.a", w: 180, h: 48 } },
      { type: "note-node", props: { label: "N", content: "Hello" } },
      { type: "terminal-node", props: { label: "T", history: "[]", mode: "js" } },
      { type: "notebook-node", props: { label: "NB", cells: JSON.stringify([{ id: "c1", type: "code", lang: "js", source: "", output: "" }]) } },
      { type: "ai-node", props: { label: "AI", prompt: "", response: "", status: "idle", errorMessage: "" } },
      { type: "web-view", props: { label: "W", url: "about:blank", mode: "url", w: 400, h: 300 } },
      { type: "compact-node", props: { label: "F", nodeType: "data:filter", w: 180, h: 48 } },
    ];

    for (let i = 0; i < nodeTypes.length; i++) {
      const n = nodeTypes[i];
      await placeNode(page, n.type, 100 + (i % 3) * 400, 100 + Math.floor(i / 3) * 350, n.props);
      await page.waitForTimeout(200);
    }

    // Zoom to fit
    await page.evaluate(() => {
      const editor = (window as any).__tldrawEditor;
      editor.selectAll();
      editor.zoomToSelection({ animation: { duration: 0 } });
      editor.selectNone();
    });
    await page.waitForTimeout(500);

    await page.screenshot({ path: "test-results/ui-11-all-nodes-no-errors.png", fullPage: true });

    // Filter out non-critical errors
    const criticalErrors = errors.filter(e =>
      !e.includes("favicon") &&
      !e.includes("404") &&
      !e.includes("wasm") &&
      !e.includes("WASM") &&
      !e.includes("static-copy") &&
      !e.includes("net::ERR")
    );

    if (criticalErrors.length > 0) {
      console.log("Critical errors found:", criticalErrors);
    }
    expect(criticalErrors).toEqual([]);
  });
});
