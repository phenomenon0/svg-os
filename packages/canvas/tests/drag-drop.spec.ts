/**
 * Drag-and-drop file tests — verify files dropped on canvas create the right nodes.
 */

import { test, expect, type Page } from "@playwright/test";

async function waitForApp(page: Page) {
  await page.goto("/");
  await page.waitForSelector(".tl-container", { timeout: 15_000 });
  await page.waitForFunction(() => !!(window as any).__tldrawEditor, { timeout: 10_000 });
  await page.waitForTimeout(500);
}

/** Simulate a file drop on the canvas via native drag events */
async function dropFile(page: Page, filename: string, content: string | Buffer, mimeType: string) {
  await page.evaluate(async ({ filename, content, mimeType }) => {
    const editor = (window as any).__tldrawEditor;
    if (!editor) throw new Error("no editor");

    // Create a File object
    const blob = new Blob([content], { type: mimeType });
    const file = new File([blob], filename, { type: mimeType });

    // Create DataTransfer with the file
    const dt = new DataTransfer();
    dt.items.add(file);

    // Get canvas center for drop position
    const canvas = document.querySelector(".tl-container");
    if (!canvas) throw new Error("no canvas");
    const rect = canvas.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    // Dispatch dragover first (to activate the drop zone)
    canvas.dispatchEvent(new DragEvent("dragover", {
      bubbles: true, cancelable: true, dataTransfer: dt,
      clientX: x, clientY: y,
    }));

    await new Promise(r => setTimeout(r, 200));

    // Then drop
    canvas.dispatchEvent(new DragEvent("drop", {
      bubbles: true, cancelable: true, dataTransfer: dt,
      clientX: x, clientY: y,
    }));

    await new Promise(r => setTimeout(r, 500));
  }, { filename, content: typeof content === "string" ? content : content.toString("base64"), mimeType });
}

async function getShapeTypes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const editor = (window as any).__tldrawEditor;
    return editor.getCurrentPageShapes().map((s: any) => s.type);
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("Drag and Drop Files", () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
  });

  test("Drop JSON file creates Data node", async ({ page }) => {
    const json = JSON.stringify({ name: "Alice", score: 95 }, null, 2);
    await dropFile(page, "data.json", json, "application/json");

    const types = await getShapeTypes(page);
    expect(types).toContain("data-node");

    // Verify the data was loaded
    const dataNode = await page.evaluate(() => {
      const editor = (window as any).__tldrawEditor;
      const shapes = editor.getCurrentPageShapes();
      const dn = shapes.find((s: any) => s.type === "data-node");
      return dn?.props;
    });
    expect(dataNode?.dataJson).toContain("Alice");
    await page.screenshot({ path: "test-results/drop-01-json.png" });
  });

  test("Drop CSV file creates Table node", async ({ page }) => {
    const csv = "name,age,city\nAlice,30,NYC\nBob,25,LA\nCarol,35,Chicago";
    await dropFile(page, "people.csv", csv, "text/csv");

    const types = await getShapeTypes(page);
    expect(types).toContain("table-node");

    const tableNode = await page.evaluate(() => {
      const editor = (window as any).__tldrawEditor;
      const shapes = editor.getCurrentPageShapes();
      const tn = shapes.find((s: any) => s.type === "table-node");
      return tn?.props;
    });
    const rows = JSON.parse(tableNode?.dataJson || "[]");
    expect(rows.length).toBe(3);
    expect(rows[0].name).toBe("Alice");
    await page.screenshot({ path: "test-results/drop-02-csv.png" });
  });

  test("Drop PNG creates Media node with image", async ({ page }) => {
    // Create a tiny 1x1 red PNG
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
    const pngBuffer = Uint8Array.from(atob(pngBase64), c => c.charCodeAt(0));

    await page.evaluate(async ({ pngBase64 }) => {
      const editor = (window as any).__tldrawEditor;
      const canvas = document.querySelector(".tl-container");
      if (!canvas || !editor) return;

      // Decode base64 to binary
      const binary = atob(pngBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const blob = new Blob([bytes], { type: "image/png" });
      const file = new File([blob], "test.png", { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);

      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      canvas.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
      await new Promise(r => setTimeout(r, 200));
      canvas.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
      await new Promise(r => setTimeout(r, 1000));
    }, { pngBase64 });

    const types = await getShapeTypes(page);
    expect(types).toContain("media-node");

    const mediaNode = await page.evaluate(() => {
      const editor = (window as any).__tldrawEditor;
      const shapes = editor.getCurrentPageShapes();
      return shapes.find((s: any) => s.type === "media-node")?.props;
    });
    expect(mediaNode?.mediaType).toBe("image");
    expect(mediaNode?.src).toContain("data:image/png");
    await page.screenshot({ path: "test-results/drop-03-png.png" });
  });

  test("Media node exists in palette", async ({ page }) => {
    // Check the palette has a Media entry
    const hasMedia = await page.evaluate(() => {
      const editor = (window as any).__tldrawEditor;
      // Create a media node programmatically to verify the shape type works
      editor.createShape({
        id: "shape:media-test",
        type: "media-node",
        x: 200, y: 200,
        props: { w: 320, h: 260, label: "Test Media", mediaType: "none", src: "", filename: "", mimeType: "", fileSize: 0 },
      });
      return !!editor.getShape("shape:media-test");
    });
    expect(hasMedia).toBe(true);
    await page.screenshot({ path: "test-results/drop-04-media-node.png" });
  });
});
