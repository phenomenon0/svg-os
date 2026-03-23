/**
 * TerminalNode — raw power terminal. Eval anything.
 * Full access to browser APIs, fetch, DOM, canvas, WebGL.
 * No sandbox pretense. This is the real thing.
 */

import {
  HTMLContainer, Rectangle2d, ShapeUtil, T, TLBaseShape, Vec, useEditor,
} from "tldraw";
import { useRef, useCallback, useEffect, useState } from "react";
import { Port } from "../Port";
import { EditableLabel } from "../EditableLabel";
import { C, FONT } from "../theme";

export type TerminalNodeShape = TLBaseShape<
  "terminal-node",
  {
    w: number;
    h: number;
    history: string;
    label: string;
    mode: string;
    pendingCommand: string;
    runNonce: number;
    clearNonce: number;
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
    pendingCommand: T.string,
    runNonce: T.number,
    clearNonce: T.number,
  };

  getDefaultProps(): TerminalNodeShape["props"] {
    return {
      w: 420, h: 300, label: "Terminal", mode: "js",
      history: JSON.stringify([
        { type: "output", text: "SVG OS \u2014 raw terminal" },
        { type: "output", text: "Full browser API access. Try: fetch, document, navigator" },
      ]),
      pendingCommand: "",
      runNonce: 0,
      clearNonce: 0,
    };
  }

  override getGeometry(shape: TerminalNodeShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override canBind() { return true; }
  override canEdit() { return false; }

  override getHandleSnapGeometry(shape: TerminalNodeShape) {
    return { points: [new Vec(0, shape.props.h / 2), new Vec(shape.props.w, shape.props.h / 2)] };
  }

  override component(shape: TerminalNodeShape) { return <TerminalComponent shape={shape} />; }

  override indicator(shape: TerminalNodeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={6} />;
  }

  override canResize() { return true; }

  override onResize(shape: TerminalNodeShape, info: { scaleX: number; scaleY: number }) {
    return { props: { w: Math.max(250, shape.props.w * info.scaleX), h: Math.max(150, shape.props.h * info.scaleY) } };
  }
}

// ── Terminal Component ───────────────────────────────────────────────────────

interface HistoryEntry { type: "input" | "output" | "error"; text: string; }

function TerminalComponent({ shape }: { shape: TerminalNodeShape }) {
  const editor = useEditor();
  const { w, h, history: historyJson, label, runNonce, clearNonce } = shape.props;
  const [inputValue, setInputValue] = useState("");
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const outputRef = useRef<HTMLDivElement>(null);

  let history: HistoryEntry[] = [];
  try { history = JSON.parse(historyJson); } catch { /* */ }

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [historyJson]);

  const executeCommand = useCallback((cmd: string) => {
    if (!cmd.trim()) return;
    editor.updateShape({
      id: shape.id, type: "terminal-node",
      props: {
        pendingCommand: cmd,
        runNonce: runNonce + 1,
      },
    });
    setCmdHistory(prev => [cmd, ...prev].slice(0, 50));
    setHistoryIdx(-1);
    setInputValue("");
  }, [editor, shape.id, runNonce]);

  const clearHistory = useCallback(() => {
    editor.updateShape({
      id: shape.id, type: "terminal-node",
      props: {
        clearNonce: clearNonce + 1,
      },
    });
  }, [clearNonce, editor, shape.id]);

  // Capture-phase for input
  const cleanupRef = useRef<(() => void) | null>(null);
  const inputRef = useCallback((el: HTMLInputElement | null) => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    if (!el) return;
    const handler = (e: PointerEvent) => { e.stopPropagation(); e.stopImmediatePropagation(); };
    el.addEventListener("pointerdown", handler, { capture: true });
    cleanupRef.current = () => el.removeEventListener("pointerdown", handler, { capture: true });
  }, []);

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
      <div style={{
        width: "100%", height: "100%",
        background: "#000", border: `1px solid ${C.border}`,
        borderRadius: 6, overflow: "hidden",
        display: "flex", flexDirection: "column",
        fontFamily: FONT.mono, position: "relative",
        boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
      }}>
        {/* Title bar */}
        <div style={{
          height: 28, padding: "0 10px",
          background: "#111", borderBottom: "1px solid #222",
          display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
        }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444" }} />
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b" }} />
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e" }} />
          <span style={{ flex: 1, textAlign: "center" }}>
            <EditableLabel value={label} color="#555" onChange={v => editor.updateShape({ id: shape.id, type: "terminal-node", props: { label: v } })} />
          </span>
          <span onClick={e => { e.stopPropagation(); clearHistory(); }}
            onPointerDown={e => e.stopPropagation()}
            style={{ cursor: "pointer", color: "#444", fontSize: 9, letterSpacing: "0.05em" }}>
            CLEAR
          </span>
        </div>

        {/* Output */}
        <div ref={outputRef} style={{
          flex: 1, overflow: "auto", padding: 8,
          fontSize: 12, lineHeight: 1.5,
        }}>
          {history.map((entry, i) => (
            <div key={i} style={{
              color: entry.type === "error" ? "#ef4444" :
                     entry.type === "input" ? "#22c55e" : "#d4cfc7",
              whiteSpace: "pre-wrap", wordBreak: "break-all",
              opacity: entry.type === "output" ? 0.85 : 1,
            }}>
              {entry.type === "input" ? `\u276f ${entry.text}` : entry.text}
            </div>
          ))}
        </div>

        {/* Input */}
        <div style={{
          height: 32, padding: "0 8px",
          borderTop: "1px solid #222",
          display: "flex", alignItems: "center", gap: 4,
          background: "#0a0a0a", flexShrink: 0,
        }}>
          <span style={{ color: "#22c55e", fontSize: 12 }}>{"\u276f"}</span>
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === "Enter") executeCommand(inputValue);
              if (e.key === "ArrowUp") {
                const next = Math.min(historyIdx + 1, cmdHistory.length - 1);
                setHistoryIdx(next);
                if (cmdHistory[next]) setInputValue(cmdHistory[next]);
              }
              if (e.key === "ArrowDown") {
                const next = historyIdx - 1;
                setHistoryIdx(next);
                setInputValue(next < 0 ? "" : cmdHistory[next] || "");
              }
              if (e.key === "l" && e.ctrlKey) { e.preventDefault(); clearHistory(); }
            }}
            placeholder="eval anything..."
            style={{
              flex: 1, padding: "4px 0",
              background: "transparent", border: "none",
              color: "#d4cfc7", fontSize: 12,
              fontFamily: "inherit", outline: "none",
            }}
          />
        </div>

        <Port side="left" type="text" name="stdin" shapeId={shape.id} />
        <Port side="right" type="data" name="result" shapeId={shape.id} />
      </div>
    </HTMLContainer>
  );
}
