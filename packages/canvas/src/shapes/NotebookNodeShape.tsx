/**
 * NotebookNode — Observable/Marimo-style reactive cells on the canvas.
 * Supports JS, Python, Ruby, C, C++, SQL via unified code runner.
 */

import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  TLBaseShape,
  Vec,
  useEditor,
} from "tldraw";
import { useRef, useState, useCallback } from "react";
import { Port } from "../Port";
import { executeCode, SUPPORTED_LANGS, getLangShort, type Lang } from "../lib/code-runner";
import { formatResult } from "../lib/eval-sandbox";
import { EditableLabel } from "../EditableLabel";
import { C, FONT, nodeContainerStyle, titleBarStyle } from "../theme";

interface Cell {
  id: string;
  type: "code" | "markdown";
  lang: Lang;
  source: string;
  output: string;
}

export type NotebookNodeShape = TLBaseShape<
  "notebook-node",
  { w: number; h: number; label: string; cells: string }
>;

export class NotebookNodeShapeUtil extends ShapeUtil<NotebookNodeShape> {
  static override type = "notebook-node" as const;
  static override props = { w: T.number, h: T.number, label: T.string, cells: T.string };

  getDefaultProps(): NotebookNodeShape["props"] {
    return {
      w: 400, h: 320, label: "Notebook",
      cells: JSON.stringify([
        { id: "c1", type: "code", lang: "python", source: "print('Hello from Python!')\n2 ** 10", output: "" },
      ]),
    };
  }

  override getGeometry(shape: NotebookNodeShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override canBind() { return true; }
  override canEdit() { return false; }

  override getHandleSnapGeometry(shape: NotebookNodeShape) {
    return { points: [new Vec(0, shape.props.h / 2), new Vec(shape.props.w, shape.props.h / 2)] };
  }

  override component(shape: NotebookNodeShape) { return <NotebookComponent shape={shape} />; }

  override indicator(shape: NotebookNodeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }

  override canResize() { return true; }

  override onResize(shape: NotebookNodeShape, info: { scaleX: number; scaleY: number }) {
    return { props: { w: Math.max(300, shape.props.w * info.scaleX), h: Math.max(200, shape.props.h * info.scaleY) } };
  }
}

// ── Notebook Component ───────────────────────────────────────────────────────

function NotebookComponent({ shape }: { shape: NotebookNodeShape }) {
  const editor = useEditor();
  const { w, h, label } = shape.props;
  const [running, setRunning] = useState(false);

  let cells: Cell[] = [];
  try {
    cells = JSON.parse(shape.props.cells).map((c: any) => ({ ...c, lang: c.lang || "js" }));
  } catch { /* */ }

  const updateCells = useCallback((newCells: Cell[]) => {
    editor.updateShape({ id: shape.id, type: "notebook-node", props: { cells: JSON.stringify(newCells) } });
  }, [editor, shape.id]);

  const runCellAsync = useCallback(async (cellId: string) => {
    const idx = cells.findIndex(c => c.id === cellId);
    if (idx === -1 || cells[idx].type !== "code") return;
    const cell = cells[idx];

    // Show running state
    const loading = [...cells];
    loading[idx] = { ...loading[idx], output: "Running\u2026" };
    updateCells(loading);

    const context: Record<string, unknown> = {};
    for (let i = 0; i < idx; i++) {
      if (cells[i].type === "code" && cells[i].output) {
        try {
          const parsed = JSON.parse(cells[i].output);
          if (typeof parsed === "object" && parsed !== null) Object.assign(context, parsed);
          else context[`cell${i}`] = parsed;
        } catch { context[`cell${i}`] = cells[i].output; }
      }
    }

    const { output, result, error } = await executeCode(cell.lang, cell.source, context);
    const lines = [...output];
    if (error) lines.push(`Error: ${error}`);
    else if (result !== undefined) { const fmt = formatResult(result); if (fmt) lines.push(fmt); }

    const updated = [...cells];
    updated[idx] = { ...updated[idx], output: lines.join("\n") };
    updateCells(updated);
  }, [cells, updateCells]);

  const runAll = useCallback(async () => {
    setRunning(true);
    let cur = [...cells];
    const ctx: Record<string, unknown> = {};
    for (let i = 0; i < cur.length; i++) {
      if (cur[i].type !== "code") continue;
      const { output, result, error } = await executeCode(cur[i].lang, cur[i].source, ctx);
      const lines = [...output];
      if (error) lines.push(`Error: ${error}`);
      else if (result !== undefined) {
        const fmt = formatResult(result);
        if (fmt) lines.push(fmt);
        if (typeof result === "object" && result !== null) Object.assign(ctx, result);
        else ctx[`cell${i}`] = result;
      }
      cur[i] = { ...cur[i], output: lines.join("\n") };
    }
    updateCells(cur);
    setRunning(false);
  }, [cells, updateCells]);

  const addCell = useCallback((type: "code" | "markdown", lang: Lang = "python") => {
    updateCells([...cells, { id: `c${Date.now()}`, type, lang, source: type === "code" ? "" : "## Title", output: "" }]);
  }, [cells, updateCells]);

  const deleteCell = useCallback((cellId: string) => {
    if (cells.length <= 1) return;
    updateCells(cells.filter(c => c.id !== cellId));
  }, [cells, updateCells]);

  const updateCellSource = useCallback((cellId: string, source: string) => {
    updateCells(cells.map(c => c.id === cellId ? { ...c, source } : c));
  }, [cells, updateCells]);

  const cycleCellLang = useCallback((cellId: string) => {
    const langOrder: Lang[] = SUPPORTED_LANGS.map(l => l.id);
    updateCells(cells.map(c => {
      if (c.id !== cellId) return c;
      const curIdx = langOrder.indexOf(c.lang);
      const nextLang = langOrder[(curIdx + 1) % langOrder.length];
      return { ...c, lang: nextLang, output: "" };
    }));
  }, [cells, updateCells]);

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
      <div style={nodeContainerStyle}>
        <div style={titleBarStyle}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.notebook, flexShrink: 0 }} />
          <EditableLabel
            value={label}
            onChange={(v) => editor.updateShape({ id: shape.id, type: "notebook-node", props: { label: v } })}
          />
          <span style={{ flex: 1 }} />
          {running && <span style={{ color: C.yellow, fontSize: 9, fontFamily: FONT.mono }}>Running\u2026</span>}
          <button
            onClick={(e) => { e.stopPropagation(); runAll(); }}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={running}
            style={{ background: `${C.green}22`, border: `1px solid ${C.green}55`, borderRadius: 4, color: C.green, fontSize: 10, padding: "2px 8px", cursor: running ? "wait" : "pointer", fontFamily: FONT.mono, letterSpacing: "0.05em" }}
          >
            RUN ALL
          </button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 6 }}>
          {cells.map((cell, i) => (
            <CellComponent key={cell.id} cell={cell} index={i}
              onRun={() => runCellAsync(cell.id)} onDelete={() => deleteCell(cell.id)}
              onSourceChange={(s) => updateCellSource(cell.id, s)} onToggleLang={() => cycleCellLang(cell.id)}
            />
          ))}
          <div style={{ display: "flex", gap: 4, padding: "6px 8px", justifyContent: "center", flexWrap: "wrap" }}>
            {SUPPORTED_LANGS.slice(0, 4).map(l => (
              <button key={l.id}
                onClick={(e) => { e.stopPropagation(); addCell("code", l.id); }}
                onPointerDown={(e) => e.stopPropagation()}
                style={{ background: "transparent", border: `1px solid ${C.blue}44`, borderRadius: 4, color: C.blue, fontSize: 9, padding: "2px 8px", cursor: "pointer", fontFamily: FONT.mono, letterSpacing: "0.03em" }}
              >
                + {l.label}
              </button>
            ))}
            <button
              onClick={(e) => { e.stopPropagation(); addCell("markdown"); }}
              onPointerDown={(e) => e.stopPropagation()}
              style={{ background: "transparent", border: `1px solid ${C.faint}44`, borderRadius: 4, color: C.faint, fontSize: 9, padding: "2px 8px", cursor: "pointer", fontFamily: FONT.mono }}
            >
              + MD
            </button>
          </div>
        </div>

        <Port side="left" type="data" name="data" shapeId={shape.id} />
        {/* Dynamic cell output ports */}
        {cells.filter(c => c.type === "code").length > 0 && (
          <>
            <Port side="right" type="data" name="all" shapeId={shape.id}
              index={0} total={cells.filter(c => c.type === "code").length + 1} />
            {cells.filter(c => c.type === "code").map((cell, ci) => (
              <Port key={cell.id} side="right" type="data"
                name={`cell:${cells.indexOf(cell)}`}
                shapeId={shape.id}
                index={ci + 1}
                total={cells.filter(c => c.type === "code").length + 1}
              />
            ))}
          </>
        )}
        {cells.filter(c => c.type === "code").length === 0 && (
          <Port side="right" type="data" name="all" shapeId={shape.id} />
        )}
      </div>
    </HTMLContainer>
  );
}

// ── Cell ─────────────────────────────────────────────────────────────────────

function CellComponent({ cell, index, onRun, onDelete, onSourceChange, onToggleLang }: {
  cell: Cell; index: number; onRun: () => void; onDelete: () => void; onSourceChange: (s: string) => void; onToggleLang: () => void;
}) {
  const [localSource, setLocalSource] = useState(cell.source);
  const cleanupRef = useRef<(() => void) | null>(null);
  if (cell.source !== localSource) setLocalSource(cell.source);

  const textareaRef = useCallback((el: HTMLTextAreaElement | null) => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    if (!el) return;
    const handler = (e: PointerEvent) => { e.stopPropagation(); e.stopImmediatePropagation(); };
    el.addEventListener("pointerdown", handler, { capture: true });
    cleanupRef.current = () => el.removeEventListener("pointerdown", handler, { capture: true });
  }, []);

  const isCode = cell.type === "code";
  const langColors: Record<string, string> = { js: C.yellow, python: C.blue, ruby: C.red, c: C.green, cpp: C.green, sql: C.cyan, php: C.purple };
  const accentColor = isCode ? (langColors[cell.lang] || C.blue) : C.faint;

  return (
    <div style={{ margin: "4px 2px", borderRadius: 6, border: `1px solid ${accentColor}22`, background: C.bgDeep, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 8px", background: `${accentColor}08`, borderBottom: `1px solid ${accentColor}15` }}>
        <span
          onClick={(e) => { e.stopPropagation(); if (isCode) onToggleLang(); }}
          onPointerDown={(e) => e.stopPropagation()}
          style={{ fontFamily: FONT.mono, fontSize: 9, color: accentColor, fontWeight: 600, cursor: isCode ? "pointer" : "default", letterSpacing: "0.05em", userSelect: "none" }}
          title={isCode ? "Click to cycle language" : ""}
        >
          [{index + 1}] {isCode ? getLangShort(cell.lang) : "MD"}
        </span>
        <span style={{ flex: 1 }} />
        {isCode && (
          <button onClick={(e) => { e.stopPropagation(); onRun(); }} onPointerDown={(e) => e.stopPropagation()}
            style={{ background: "transparent", border: "none", color: C.green, fontSize: 10, cursor: "pointer", padding: "0 3px" }}>
            {"\u25B6"}
          </button>
        )}
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} onPointerDown={(e) => e.stopPropagation()}
          style={{ background: "transparent", border: "none", color: C.red, fontSize: 10, cursor: "pointer", padding: "0 3px", opacity: 0.6 }}>
          {"\u2715"}
        </button>
      </div>

      <textarea ref={textareaRef} value={localSource}
        onChange={(e) => { setLocalSource(e.target.value); onSourceChange(e.target.value); }}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && (e.shiftKey || e.ctrlKey) && isCode) { e.preventDefault(); onRun(); } }}
        rows={Math.max(2, localSource.split("\n").length)}
        placeholder={isCode ? `${getLangShort(cell.lang)} code\u2026` : "Markdown\u2026"}
        style={{ width: "100%", padding: "8px 10px", background: "transparent", border: "none", color: isCode ? C.fg : C.muted, fontSize: 13, resize: "none", outline: "none", fontFamily: isCode ? FONT.mono : FONT.serif, lineHeight: 1.6 }}
      />

      {isCode && cell.output && (
        <div style={{ padding: "6px 10px", borderTop: `1px solid ${C.borderSoft}`, background: `${C.bgDeep}`, fontSize: 12, fontFamily: FONT.mono, color: cell.output.includes("Error:") ? C.red : C.green, whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 120, overflow: "auto", lineHeight: 1.5 }}>
          {cell.output}
        </div>
      )}
    </div>
  );
}
