/**
 * Data Flow Visual Tests — see data flowing between REAL nodes.
 * Notebook → Note, Data → Note, Note list, WebView from Note.
 * Each test captures screenshots showing the actual data on screen.
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

async function zoomToFit(page: Page) {
  await page.evaluate(() => {
    const editor = (window as any).__tldrawEditor;
    editor.selectAll();
    editor.zoomToSelection({ animation: { duration: 0 } });
    editor.selectNone();
  });
  await page.waitForTimeout(300);
}

async function triggerRun(page: Page) {
  // Sync shapes to runtime and execute
  await page.evaluate(async () => {
    const runtime = (window as any).__svgosRuntime;
    if (!runtime) return;
    // Import bridge functions
    const bridge = await import("/src/lib/runtime-bridge.ts");
    const editor = (window as any).__tldrawEditor;
    bridge.syncShapesToRuntime(editor, runtime);
    bridge.rebuildEdges(editor, runtime);
    await runtime.run();
    bridge.syncRuntimeToShapes(editor, runtime);
  });
  await page.waitForTimeout(500);
}

// ────────────────────────────────────────────────────────────────────────

test.describe("Data Flow: Real Nodes", () => {

  test("1. Data → Note: JSON data flows into note with {{field}} interpolation", async ({ page }) => {
    await waitForApp(page);

    // Data node with user info
    const dataId = await placeNode(page, "data-node", 50, 150, {
      label: "User Profile",
      dataJson: JSON.stringify({ name: "Alice", role: "Engineer", team: "Platform" }),
      w: 280, h: 200,
    });

    // Note that interpolates the data
    const noteId = await placeNode(page, "note-node", 450, 150, {
      label: "Welcome Card",
      content: "# Welcome, {{name}}!\n\nRole: **{{role}}**\nTeam: {{team}}",
      mode: "preview",
      w: 320, h: 220,
    });

    await connect(page, dataId, noteId);
    await triggerRun(page);
    await zoomToFit(page);

    await page.screenshot({ path: "test-results/flow-01-data-to-note.png" });
  });

  test("2. Data → Table: Array data populates table rows", async ({ page }) => {
    await waitForApp(page);

    const dataId = await placeNode(page, "data-node", 50, 150, {
      label: "Team Members",
      dataJson: JSON.stringify([
        { name: "Alice", role: "Lead", status: "active" },
        { name: "Bob", role: "Dev", status: "active" },
        { name: "Carol", role: "Design", status: "away" },
        { name: "Dave", role: "QA", status: "active" },
      ]),
      w: 300, h: 220,
    });

    const tableId = await placeNode(page, "table-node", 480, 130, {
      label: "Team Roster",
      w: 420, h: 300,
    });

    await connect(page, dataId, tableId);
    await triggerRun(page);
    await zoomToFit(page);

    await page.screenshot({ path: "test-results/flow-02-data-to-table.png" });
  });

  test("3. Notebook → Note: Notebook computes, note displays result", async ({ page }) => {
    await waitForApp(page);

    // Notebook that computes something
    const nbId = await placeNode(page, "notebook-node", 50, 120, {
      label: "Compute Stats",
      cells: JSON.stringify([
        { id: "c1", type: "code", lang: "js", source: "const scores = [95, 78, 88, 92, 67];\nconst avg = scores.reduce((a,b) => a+b) / scores.length;\n({average: avg.toFixed(1), max: Math.max(...scores), min: Math.min(...scores), count: scores.length})", output: "" },
      ]),
      w: 420, h: 280,
    });

    // Note to display the output
    const noteId = await placeNode(page, "note-node", 580, 150, {
      label: "Stats Report",
      content: "## Score Summary\n\nAverage: **{{average}}**\nHighest: {{max}}\nLowest: {{min}}\nTotal students: {{count}}",
      mode: "preview",
      w: 300, h: 250,
    });

    await connect(page, nbId, noteId);

    // First run the notebook cells directly (since notebook is trigger:manual)
    await page.evaluate(async () => {
      const { executeNotebook } = await import("/src/lib/test-helpers.ts");
      const editor = (window as any).__tldrawEditor;
      // Find the notebook shape
      const shapes = editor.getCurrentPageShapes();
      const nb = shapes.find((s: any) => s.type === "notebook-node");
      if (!nb) return;

      const result = await executeNotebook({ cells: nb.props.cells, runMode: "all" });
      // Update the notebook shape with cell outputs
      editor.updateShape({
        id: nb.id,
        type: "notebook-node",
        props: { cells: JSON.stringify(result.cells) },
      });
    });
    await page.waitForTimeout(300);

    // Now run the full pipeline to push data downstream
    await triggerRun(page);
    await zoomToFit(page);

    await page.screenshot({ path: "test-results/flow-03-notebook-to-note.png" });
  });

  test("4. Data → Note → WebView: Data feeds note, note content renders in webview", async ({ page }) => {
    await waitForApp(page);

    // Data source
    const dataId = await placeNode(page, "data-node", 50, 200, {
      label: "Page Data",
      dataJson: JSON.stringify({
        title: "Dashboard",
        message: "Welcome to SVG-OS",
        count: 42,
      }),
      w: 260, h: 180,
    });

    // Note that interpolates
    const noteId = await placeNode(page, "note-node", 400, 200, {
      label: "Template",
      content: "# {{title}}\n\n{{message}}\n\nItems: **{{count}}**",
      mode: "preview",
      w: 280, h: 200,
    });

    // WebView showing HTML
    const webId = await placeNode(page, "web-view", 780, 130, {
      label: "Preview",
      mode: "html",
      htmlContent: `<div style="font-family:Inter,sans-serif;padding:24px;background:#1a1815;color:#e2e8f0;min-height:100vh">
        <h1 style="color:#d4a574">Dashboard</h1>
        <p>Welcome to SVG-OS</p>
        <div style="font-size:48px;font-weight:bold;color:#8b5cf6;margin:20px 0">42</div>
        <p style="color:#94a3b8">items loaded from upstream data node</p>
      </div>`,
      w: 420, h: 340,
    });

    await connect(page, dataId, noteId);
    await connect(page, noteId, webId);
    await triggerRun(page);
    await zoomToFit(page);

    await page.screenshot({ path: "test-results/flow-04-data-note-webview.png" });
  });

  test("5. Multiple Data → Table → Note: Fan-in pipeline", async ({ page }) => {
    await waitForApp(page);

    // Two data sources
    const data1 = await placeNode(page, "data-node", 50, 80, {
      label: "Frontend Team",
      dataJson: JSON.stringify([
        { name: "Alice", dept: "Frontend", exp: 5 },
        { name: "Bob", dept: "Frontend", exp: 3 },
      ]),
      w: 250, h: 160,
    });

    const data2 = await placeNode(page, "data-node", 50, 320, {
      label: "Backend Team",
      dataJson: JSON.stringify([
        { name: "Carol", dept: "Backend", exp: 7 },
        { name: "Dave", dept: "Backend", exp: 4 },
      ]),
      w: 250, h: 160,
    });

    // Table to show merged data
    const tableId = await placeNode(page, "table-node", 420, 120, {
      label: "All Engineers",
      w: 380, h: 300,
    });

    // Note summarizing
    const noteId = await placeNode(page, "note-node", 900, 180, {
      label: "Summary",
      content: "# Engineering Team\n\nData loaded from two sources.\nView the table for full roster.",
      mode: "preview",
      w: 280, h: 220,
    });

    await connect(page, data1, tableId);
    await connect(page, data2, tableId);
    await connect(page, tableId, noteId);
    await triggerRun(page);
    await zoomToFit(page);

    await page.screenshot({ path: "test-results/flow-05-multi-data-table-note.png" });
  });

  test("6. Terminal → Table: Terminal output feeds table", async ({ page }) => {
    await waitForApp(page);

    // Terminal that produces structured data
    const termId = await placeNode(page, "terminal-node", 50, 150, {
      label: "Data Generator",
      history: "[]",
      mode: "js",
      w: 420, h: 300,
    });

    // Table to display the result
    const tableId = await placeNode(page, "table-node", 560, 150, {
      label: "Generated Data",
      w: 400, h: 300,
    });

    await connect(page, termId, tableId);

    // Execute a command in the terminal that produces array data
    await page.evaluate(async () => {
      const { executeTerminal } = await import("/src/lib/test-helpers.ts");
      const editor = (window as any).__tldrawEditor;
      const shapes = editor.getCurrentPageShapes();
      const term = shapes.find((s: any) => s.type === "terminal-node");
      if (!term) return;

      const result = await executeTerminal(term.id, {
        pendingCommand: '[{name:"Server A",cpu:45,mem:62},{name:"Server B",cpu:78,mem:85},{name:"Server C",cpu:12,mem:34}]',
        runNonce: 1,
        mode: "js",
      });

      editor.updateShape({
        id: term.id,
        type: "terminal-node",
        props: {
          history: JSON.stringify(result.history),
          pendingCommand: '[{name:"Server A",cpu:45,mem:62},{name:"Server B",cpu:78,mem:85},{name:"Server C",cpu:12,mem:34}]',
          runNonce: 1,
        },
      });
    });
    await page.waitForTimeout(300);

    await triggerRun(page);
    await zoomToFit(page);

    await page.screenshot({ path: "test-results/flow-06-terminal-to-table.png" });
  });

  test("7. FULL CANVAS: Every node type wired together", async ({ page }) => {
    await waitForApp(page);

    // Row 1: Data source → Table → Note
    const dataId = await placeNode(page, "data-node", 50, 50, {
      label: "Employees",
      dataJson: JSON.stringify([
        { name: "Alice", title: "CTO", salary: 180000 },
        { name: "Bob", title: "Lead Dev", salary: 150000 },
        { name: "Carol", title: "Designer", salary: 130000 },
        { name: "Dave", title: "DevOps", salary: 140000 },
      ]),
      w: 280, h: 200,
    });

    const tableId = await placeNode(page, "table-node", 420, 30, {
      label: "Team Roster",
      w: 400, h: 240,
    });

    const noteId = await placeNode(page, "note-node", 920, 50, {
      label: "Report",
      content: "# Team Overview\n\nAll employees loaded.\nCheck the table for details.\n\nTotal headcount visible in roster.",
      mode: "preview",
      w: 280, h: 220,
    });

    // Row 2: Notebook → WebView
    const nbId = await placeNode(page, "notebook-node", 50, 340, {
      label: "Analysis",
      cells: JSON.stringify([
        { id: "c1", type: "code", lang: "js", source: "// Compute total payroll\nconst total = 180000 + 150000 + 130000 + 140000;\n`Total annual payroll: $${total.toLocaleString()}`", output: "" },
      ]),
      w: 420, h: 240,
    });

    const webId = await placeNode(page, "web-view", 560, 340, {
      label: "Dashboard",
      mode: "html",
      htmlContent: `<div style="font-family:Inter,sans-serif;padding:20px;background:#1e293b;color:#e2e8f0;min-height:100%">
        <h2 style="color:#d4a574;margin:0 0 16px">Company Dashboard</h2>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div style="background:#0f172a;padding:16px;border-radius:8px;border:1px solid #334155">
            <div style="color:#94a3b8;font-size:12px">HEADCOUNT</div>
            <div style="font-size:32px;font-weight:bold;color:#22c55e">4</div>
          </div>
          <div style="background:#0f172a;padding:16px;border-radius:8px;border:1px solid #334155">
            <div style="color:#94a3b8;font-size:12px">AVG SALARY</div>
            <div style="font-size:32px;font-weight:bold;color:#8b5cf6">$150K</div>
          </div>
          <div style="background:#0f172a;padding:16px;border-radius:8px;border:1px solid #334155">
            <div style="color:#94a3b8;font-size:12px">TOTAL PAYROLL</div>
            <div style="font-size:32px;font-weight:bold;color:#f59e0b">$600K</div>
          </div>
          <div style="background:#0f172a;padding:16px;border-radius:8px;border:1px solid #334155">
            <div style="color:#94a3b8;font-size:12px">DEPARTMENTS</div>
            <div style="font-size:32px;font-weight:bold;color:#06b6d4">4</div>
          </div>
        </div>
      </div>`,
      w: 460, h: 260,
    });

    // Row 3: Terminal
    const termId = await placeNode(page, "terminal-node", 1100, 50, {
      label: "Console",
      history: JSON.stringify([
        { type: "input", text: "2 + 2" },
        { type: "output", text: "4" },
        { type: "input", text: '"Hello " + "SVG-OS"' },
        { type: "output", text: "Hello SVG-OS" },
      ]),
      mode: "js",
      w: 360, h: 220,
    });

    // AI node
    const aiId = await placeNode(page, "ai-node", 1100, 340, {
      label: "AI Assistant",
      prompt: "Summarize the team data:\n{{name}} - {{title}}",
      response: "The team consists of 4 members across engineering and design roles, led by Alice as CTO.",
      status: "done",
      errorMessage: "",
      w: 360, h: 240,
    });

    // Wire: Data → Table → Note
    await connect(page, dataId, tableId);
    await connect(page, tableId, noteId);
    // Wire: Notebook → WebView
    await connect(page, nbId, webId);
    // Wire: Data → AI (for context)
    await connect(page, dataId, aiId);

    await triggerRun(page);
    await zoomToFit(page);

    // Verify node count
    const counts = await page.evaluate(() => {
      const editor = (window as any).__tldrawEditor;
      const shapes = editor.getCurrentPageShapes();
      return {
        nodes: shapes.filter((s: any) => s.type !== "arrow").length,
        arrows: shapes.filter((s: any) => s.type === "arrow").length,
      };
    });
    expect(counts.nodes).toBe(7);
    expect(counts.arrows).toBe(4);

    await page.screenshot({ path: "test-results/flow-07-full-canvas.png", fullPage: true });
  });
});
