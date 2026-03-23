/**
 * TerminalNode — a live code execution terminal on the canvas.
 *
 * Type commands, see output. Currently executes JavaScript.
 * Future: Pyodide (Python), WASI (bash/shell).
 *
 * Commands and output stored in history prop for persistence.
 * Input/output ports for data flow integration.
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
import { useRef, useCallback, useState } from "react";
import { Port } from "../Port";
import { evalJS, formatResult } from "../lib/eval-sandbox";

export type TerminalNodeShape = TLBaseShape<
  "terminal-node",
  {
    w: number;
    h: number;
    history: string; // JSON array of {type, text}
    label: string;
    mode: string;    // 'js' | 'python' | 'bash' (future)
  }
>;

export class TerminalNodeShapeUtil extends ShapeUtil<TerminalNodeShape> {
  static override type = "terminal-node" as const;

  static override props = {
    w: T.number,
    h: T.number,
    history: T.string,
    label: T.string,
    mode: T.string,
  };

  getDefaultProps(): TerminalNodeShape["props"] {
    return {
      w: 400,
      h: 280,
      history: JSON.stringify([
        { type: "output", text: "SVG OS Terminal — JavaScript sandbox" },
        { type: "output", text: "Type expressions, see results. Try: 1 + 1" },
      ]),
      label: "Terminal",
      mode: "js",
    };
  }

  override getGeometry(shape: TerminalNodeShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override canBind() { return true; }
  override canEdit() { return false; }

  override getHandleSnapGeometry(shape: TerminalNodeShape) {
    return {
      points: [
        new Vec(0, shape.props.h / 2),
        new Vec(shape.props.w, shape.props.h / 2),
      ],
    };
  }

  override component(shape: TerminalNodeShape) {
    return <TerminalComponent shape={shape} />;
  }

  override indicator(shape: TerminalNodeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={6} />;
  }

  override canResize() { return true; }

  override onResize(shape: TerminalNodeShape, info: { scaleX: number; scaleY: number }) {
    return {
      props: {
        w: Math.max(250, shape.props.w * info.scaleX),
        h: Math.max(150, shape.props.h * info.scaleY),
      },
    };
  }
}

// ── Terminal Component ───────────────────────────────────────────────────────

interface HistoryEntry {
  type: "input" | "output" | "error";
  text: string;
}

function TerminalComponent({ shape }: { shape: TerminalNodeShape }) {
  const editor = useEditor();
  const { w, h, history: historyJson, label, mode } = shape.props;
  const [inputValue, setInputValue] = useState("");
  const outputRef = useRef<HTMLDivElement>(null);

  let history: HistoryEntry[] = [];
  try { history = JSON.parse(historyJson); } catch { /* */ }

  const appendHistory = useCallback((entries: HistoryEntry[]) => {
    const current: HistoryEntry[] = (() => {
      try { return JSON.parse(shape.props.history); } catch { return []; }
    })();
    const updated = [...current, ...entries].slice(-100); // keep last 100 entries
    editor.updateShape({
      id: shape.id,
      type: "terminal-node",
      props: { history: JSON.stringify(updated) },
    });
    // Scroll to bottom
    setTimeout(() => {
      if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }, 50);
  }, [editor, shape.id, shape.props.history]);

  const executeCommand = useCallback((cmd: string) => {
    if (!cmd.trim()) return;
    const entries: HistoryEntry[] = [{ type: "input", text: cmd }];

    // Use shared eval sandbox — passes upstream data as $ variable
    const { output, result, error } = evalJS(cmd);

    for (const line of output) {
      entries.push({ type: "output", text: line });
    }

    if (error) {
      entries.push({ type: "error", text: error });
    } else if (result !== undefined) {
      const display = formatResult(result);
      if (display) entries.push({ type: "output", text: display });
    }

    appendHistory(entries);
    setInputValue("");
  }, [appendHistory]);

  // Capture-phase event interception for the input
  const cleanupRef = useRef<(() => void) | null>(null);
  const inputRef = useCallback((el: HTMLInputElement | null) => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    if (!el) return;
    const handler = (e: PointerEvent) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    el.addEventListener("pointerdown", handler, { capture: true });
    cleanupRef.current = () => el.removeEventListener("pointerdown", handler, { capture: true });
  }, []);

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
      <div style={{
        width: "100%", height: "100%",
        background: "#000000", border: "1px solid #333",
        borderRadius: 6, overflow: "hidden",
        display: "flex", flexDirection: "column",
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        position: "relative",
      }}>
        {/* Title bar */}
        <div style={{
          height: 28, padding: "0 10px",
          background: "#1a1a1a", borderBottom: "1px solid #333",
          display: "flex", alignItems: "center", gap: 6,
          fontSize: 11, flexShrink: 0,
        }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444" }} />
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b" }} />
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e" }} />
          <span style={{ flex: 1, textAlign: "center", color: "#666", fontSize: 10 }}>
            {label} — {mode.toUpperCase()}
          </span>
        </div>

        {/* Output area */}
        <div
          ref={outputRef}
          style={{
            flex: 1, overflow: "auto", padding: 8,
            fontSize: 12, lineHeight: 1.5,
          }}
        >
          {history.map((entry, i) => (
            <div key={i} style={{
              color: entry.type === "error" ? "#ef4444" :
                     entry.type === "input" ? "#22c55e" : "#e2e8f0",
              whiteSpace: "pre-wrap", wordBreak: "break-all",
              opacity: entry.type === "output" ? 0.9 : 1,
            }}>
              {entry.type === "input" ? `❯ ${entry.text}` : entry.text}
            </div>
          ))}
        </div>

        {/* Input */}
        <div style={{
          height: 32, padding: "0 8px",
          borderTop: "1px solid #333",
          display: "flex", alignItems: "center", gap: 4,
          background: "#0a0a0a",
          flexShrink: 0,
        }}>
          <span style={{ color: "#22c55e", fontSize: 12 }}>❯</span>
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") executeCommand(inputValue);
            }}
            placeholder="Type JavaScript..."
            style={{
              flex: 1, padding: "4px 0",
              background: "transparent", border: "none",
              color: "#e2e8f0", fontSize: 12,
              fontFamily: "inherit", outline: "none",
            }}
          />
        </div>

        <Port side="left" type="data" name="input" shapeId={shape.id} />
        <Port side="right" type="data" name="result" shapeId={shape.id} />
      </div>
    </HTMLContainer>
  );
}
