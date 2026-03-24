/**
 * NotebookNode — reactive cells on the canvas.
 * Executes directly via code-runner (not via Runtime signaling).
 * Supports JS, Python, Ruby, C, C++, SQL.
 */

import {
  HTMLContainer, Rectangle2d, ShapeUtil, T, TLBaseShape, Vec, useEditor,
} from "tldraw";
import { useRef, useState, useCallback, useMemo, useEffect } from "react";
import { Port } from "../Port";
import { executeCode, SUPPORTED_LANGS, getLangShort, formatResult, type Lang } from "../lib/code-runner";
import { TitleBar } from "../TitleBar";
import { usePointerCapture } from "../hooks/usePointerCapture";
import { C, FONT, nodeContainerStyle } from "../theme";

interface Cell {
  id: string;
  type: "code" | "markdown";
  lang: Lang;
  source: string;
  output: string;
}

export type NotebookNodeShape = TLBaseShape<
  "notebook-node",
  { w: number; h: number; label: string; cells: string;
    // Legacy props kept for backward compat with cached shapes
    status: string; runNonce: number; runMode: string; activeCellId: string; }
>;

export class NotebookNodeShapeUtil extends ShapeUtil<NotebookNodeShape> {
  static override type = "notebook-node" as const;
  static override props = {
    w: T.number, h: T.number, label: T.string, cells: T.string,
    status: T.string, runNonce: T.number, runMode: T.string, activeCellId: T.string,
  };

  getDefaultProps(): NotebookNodeShape["props"] {
    return {
      w: 320, h: 240, label: "Notebook",
      cells: JSON.stringify([
        { id: "c1", type: "code", lang: "js", source: "", output: "" },
      ]),
      status: "idle", runNonce: 0, runMode: "", activeCellId: "",
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
    return { props: { w: Math.max(260, shape.props.w * info.scaleX), h: Math.max(160, shape.props.h * info.scaleY) } };
  }
}

// ── Notebook Component ───────────────────────────────────────────────────────

function NotebookComponent({ shape }: { shape: NotebookNodeShape }) {
  const editor = useEditor();
  const { w, h, label } = shape.props;
  const [running, setRunning] = useState(false);

  // Parse cells with useMemo to avoid reparsing every render
  const cells: Cell[] = useMemo(() => {
    try {
      return JSON.parse(shape.props.cells).map((c: any) => ({
        ...c, lang: c.lang || "js",
      }));
    } catch { return []; }
  }, [shape.props.cells]);

  // Keep a ref to the latest cells so callbacks always see current state
  const cellsRef = useRef(cells);
  cellsRef.current = cells;

  const commitCells = useCallback((newCells: Cell[]) => {
    cellsRef.current = newCells;
    editor.updateShape({
      id: shape.id, type: "notebook-node",
      props: { cells: JSON.stringify(newCells) },
    });
  }, [editor, shape.id]);

  // ── Direct execution (not via Runtime) ──────────────────────

  const runCell = useCallback(async (cellId: string) => {
    const current = cellsRef.current;
    const idx = current.findIndex(c => c.id === cellId);
    if (idx === -1 || current[idx].type !== "code") return;

    // Build context from earlier cells
    const context: Record<string, unknown> = {};
    for (let i = 0; i < idx; i++) {
      if (current[i].type === "code" && current[i].output) {
        try {
          const parsed = JSON.parse(current[i].output);
          if (typeof parsed === "object" && parsed !== null) Object.assign(context, parsed);
          else context[`cell${i}`] = parsed;
        } catch { context[`cell${i}`] = current[i].output; }
      }
    }

    const { output, result, error } = await executeCode(current[idx].lang, current[idx].source, context);
    const lines = [...output];
    if (error) lines.push(`Error: ${error}`);
    else if (result !== undefined) {
      const fmt = formatResult(result);
      if (fmt) lines.push(fmt);
    }

    const updated = [...current];
    updated[idx] = { ...updated[idx], output: lines.join("\n") };
    commitCells(updated);
  }, [commitCells]);

  const runAll = useCallback(async () => {
    setRunning(true);
    let cur = [...cellsRef.current];
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

    commitCells(cur);
    setRunning(false);
  }, [commitCells]);

  // ── Cell CRUD ───────────────────────────────────────────────

  const addCell = useCallback((type: "code" | "markdown", lang: Lang = "js") => {
    const current = cellsRef.current;
    commitCells([...current, { id: `c${Date.now()}`, type, lang, source: "", output: "" }]);
  }, [commitCells]);

  const deleteCell = useCallback((cellId: string) => {
    const current = cellsRef.current;
    if (current.length <= 1) return;
    commitCells(current.filter(c => c.id !== cellId));
  }, [commitCells]);

  const updateSource = useCallback((cellId: string, source: string) => {
    const current = cellsRef.current;
    commitCells(current.map(c => c.id === cellId ? { ...c, source } : c));
  }, [commitCells]);

  const cycleLang = useCallback((cellId: string) => {
    const current = cellsRef.current;
    const order: Lang[] = SUPPORTED_LANGS.map(l => l.id);
    commitCells(current.map(c => {
      if (c.id !== cellId) return c;
      const next = order[(order.indexOf(c.lang) + 1) % order.length];
      return { ...c, lang: next, output: "" };
    }));
  }, [commitCells]);

  // ── Render ──────────────────────────────────────────────────

  const codeCells = cells.filter(c => c.type === "code");

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
      <div style={nodeContainerStyle}>
        {/* Title bar */}
        <TitleBar label={label} color={C.notebook} onChange={v => editor.updateShape({ id: shape.id, type: "notebook-node", props: { label: v } })}>
          {running && <span style={{ color: C.yellow, fontSize: 9, fontFamily: FONT.mono }}>Running...</span>}
          <button
            onClick={e => { e.stopPropagation(); runAll(); }}
            onPointerDown={e => e.stopPropagation()}
            disabled={running}
            style={{ background: `${C.green}22`, border: `1px solid ${C.green}55`, borderRadius: 4, color: C.green, fontSize: 9, padding: "2px 6px", cursor: running ? "wait" : "pointer", fontFamily: FONT.mono }}
          >
            RUN ALL
          </button>
        </TitleBar>

        {/* Cells */}
        <div style={{ flex: 1, overflow: "auto", padding: 4 }}>
          {cells.map((cell, i) => (
            <CellView key={cell.id} cell={cell} index={i}
              onRun={() => runCell(cell.id)}
              onDelete={() => deleteCell(cell.id)}
              onSourceChange={s => updateSource(cell.id, s)}
              onToggleLang={() => cycleLang(cell.id)}
            />
          ))}
        </div>

        {/* Add buttons — outside scroll area so tldraw doesn't eat events */}
        <div style={{ display: "flex", gap: 4, padding: "4px 8px", justifyContent: "center", flexWrap: "wrap", borderTop: `1px solid ${C.borderSoft}`, flexShrink: 0 }}>
          <AddBtn label="+ JS" color={C.yellow} onClick={() => addCell("code", "js")} />
          <AddBtn label="+ Python" color={C.blue} onClick={() => addCell("code", "python")} />
          <AddBtn label="+ Ruby" color={C.red} onClick={() => addCell("code", "ruby")} />
          <AddBtn label="+ C" color={C.green} onClick={() => addCell("code", "c")} />
          <AddBtn label="+ SQL" color={C.cyan} onClick={() => addCell("code", "sql")} />
          <AddBtn label="+ MD" color={C.faint} onClick={() => addCell("markdown")} />
        </div>

        {/* Ports */}
        <Port side="left" type="any" name="in" shapeId={shape.id} />
        {codeCells.length > 0 ? (
          <>
            <Port side="right" type="any" name="out" shapeId={shape.id} index={0} total={codeCells.length + 1} />
            {codeCells.map((c, ci) => (
              <Port key={c.id} side="right" type="data" name={`cell:${cells.indexOf(c)}`}
                shapeId={shape.id} index={ci + 1} total={codeCells.length + 1} />
            ))}
          </>
        ) : (
          <Port side="right" type="any" name="out" shapeId={shape.id} />
        )}
      </div>
    </HTMLContainer>
  );
}

// ── Cell View ────────────────────────────────────────────────────────────────

function CellView({ cell, index, onRun, onDelete, onSourceChange, onToggleLang }: {
  cell: Cell; index: number; onRun: () => void; onDelete: () => void;
  onSourceChange: (s: string) => void; onToggleLang: () => void;
}) {
  const [local, setLocal] = useState(cell.source);
  const [focused, setFocused] = useState(false);

  // Only sync from parent when NOT focused (prevents reset while typing)
  if (!focused && cell.source !== local) setLocal(cell.source);

  const taRef = usePointerCapture<HTMLTextAreaElement>();

  const isCode = cell.type === "code";
  const colors: Record<string, string> = { js: C.yellow, python: C.blue, ruby: C.red, c: C.green, cpp: C.green, sql: C.cyan };
  const accent = isCode ? (colors[cell.lang] || C.blue) : C.faint;

  return (
    <div style={{ margin: "3px 2px", borderRadius: 5, border: `1px solid ${accent}22`, background: C.bgDeep, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 6px", background: `${accent}08`, borderBottom: `1px solid ${accent}15` }}>
        <span
          onClick={e => { e.stopPropagation(); if (isCode) onToggleLang(); }}
          onPointerDown={e => e.stopPropagation()}
          style={{ fontFamily: FONT.mono, fontSize: 8, color: accent, fontWeight: 600, cursor: isCode ? "pointer" : "default", letterSpacing: "0.05em", userSelect: "none" }}
        >
          [{index + 1}] {isCode ? getLangShort(cell.lang) : "MD"}
        </span>
        <span style={{ flex: 1 }} />
        {isCode && <CellBtn icon={"\u25B6"} color={C.green} onAction={onRun} />}
        <CellBtn icon={"\u2715"} color={C.red} onAction={onDelete} opacity={0.5} />
      </div>

      {/* Source */}
      <textarea ref={taRef} value={local}
        onChange={e => { setLocal(e.target.value); onSourceChange(e.target.value); }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === "Enter" && (e.shiftKey || e.ctrlKey) && isCode) { e.preventDefault(); onRun(); }
        }}
        rows={Math.max(1, local.split("\n").length)}
        placeholder={isCode ? `${getLangShort(cell.lang)} code...` : "Markdown..."}
        style={{
          width: "100%", padding: "6px 8px", background: "transparent", border: "none",
          color: isCode ? C.fg : C.muted, fontSize: 12, resize: "none", outline: "none",
          fontFamily: isCode ? FONT.mono : FONT.serif, lineHeight: 1.5,
        }}
      />

      {/* Output */}
      {isCode && cell.output && (
        <div style={{
          padding: "4px 8px", borderTop: `1px solid ${C.borderSoft}`, background: C.bgDeep,
          fontSize: 11, fontFamily: FONT.mono, whiteSpace: "pre-wrap", wordBreak: "break-all",
          maxHeight: 100, overflow: "auto", lineHeight: 1.4,
          color: cell.output.includes("Error:") ? C.red : C.green,
        }}>
          {cell.output}
        </div>
      )}
    </div>
  );
}

// ── Cell action button (run/delete) — uses native capture to bypass tldraw ──

function CellBtn({ icon, color, onAction, opacity = 1 }: { icon: string; color: string; onAction: () => void; opacity?: number }) {
  const cleanupRef = useRef<(() => void) | null>(null);
  const btnRef = useCallback((el: HTMLButtonElement | null) => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    if (!el) return;
    const onDown = (e: PointerEvent) => { e.stopPropagation(); e.stopImmediatePropagation(); };
    const onUp = (e: PointerEvent) => { e.stopPropagation(); e.stopImmediatePropagation(); onAction(); };
    el.addEventListener("pointerdown", onDown, { capture: true });
    el.addEventListener("pointerup", onUp, { capture: true });
    cleanupRef.current = () => {
      el.removeEventListener("pointerdown", onDown, { capture: true });
      el.removeEventListener("pointerup", onUp, { capture: true });
    };
  }, [onAction]);

  return (
    <button ref={btnRef} style={{ background: "transparent", border: "none", color, fontSize: 9, cursor: "pointer", padding: "2px 4px", opacity }}>
      {icon}
    </button>
  );
}

// ── Add button ───────────────────────────────────────────────────────────────

function AddBtn({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(); }}
      onPointerDown={e => e.stopPropagation()}
      style={{
        background: "transparent", border: `1px solid ${color}44`, borderRadius: 3,
        color, fontSize: 9, padding: "2px 6px", cursor: "pointer", fontFamily: FONT.mono,
      }}
    >
      {label}
    </button>
  );
}
