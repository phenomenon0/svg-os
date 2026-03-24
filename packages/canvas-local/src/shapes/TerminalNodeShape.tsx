/**
 * TerminalNode — real native terminal via xterm.js + Tauri PTY.
 * Full bash/zsh with ANSI colors, cursor movement, scrollback.
 */

import {
  HTMLContainer, Rectangle2d, ShapeUtil, T, TLBaseShape, Vec, useEditor,
} from "tldraw";
import { useRef, useCallback, useEffect } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Port } from "../Port";
import { EditableLabel } from "../EditableLabel";
import { C, FONT } from "../theme";
import { startPtySession } from "../lib/pty-native";
import { ptyWrite, ptyResize } from "../lib/ipc";

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
      w: 560, h: 380, label: "Terminal", mode: "bash",
      history: "[]",
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
    return { props: { w: Math.max(300, shape.props.w * info.scaleX), h: Math.max(200, shape.props.h * info.scaleY) } };
  }
}

// ── Terminal Component (xterm.js + PTY) ─────────────────────────────────────

function TerminalComponent({ shape }: { shape: TerminalNodeShape }) {
  const editor = useEditor();
  const { w, h, label } = shape.props;

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const initRef = useRef(false);

  // ── Initialize xterm.js + PTY once ────────────────────────────────────
  useEffect(() => {
    if (initRef.current) return; // Skip React strict mode re-mount
    if (!containerRef.current) return;
    initRef.current = true;

    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: true,
      cursorStyle: "bar",
      allowProposedApi: true,
      theme: {
        background: "#0a0908",
        foreground: "#d4cfc7",
        cursor: "#e6a756",
        selectionBackground: "#e6a75633",
        black: "#1a1815",
        red: "#c98f8f",
        green: "#7eb59d",
        yellow: "#d4b86a",
        blue: "#6a9fcf",
        magenta: "#a78bca",
        cyan: "#7abfb8",
        white: "#d4cfc7",
        brightBlack: "#6b6660",
        brightRed: "#ef4444",
        brightGreen: "#22c55e",
        brightYellow: "#e6a756",
        brightBlue: "#8fb8e0",
        brightMagenta: "#c4a8e0",
        brightCyan: "#9dd5cf",
        brightWhite: "#e8e4df",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    // Fit after a frame so the container has dimensions
    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch { /* container might not be sized yet */ }
    });

    termRef.current = term;
    fitRef.current = fitAddon;

    // Connect to PTY
    startPtySession(shape.id,
      (data) => term.write(data),
      (code) => term.write(`\r\n\x1b[33m[Process exited with code ${code}]\x1b[0m\r\n`),
    ).then((cleanup) => {
      cleanupRef.current = cleanup;

      // Send terminal dimensions to PTY
      const { cols, rows } = term;
      ptyResize(shape.id, cols, rows).catch(() => {});
    }).catch((err) => {
      term.write(`\x1b[31m[PTY error: ${err}]\x1b[0m\r\n`);
    });

    // Forward keystrokes from xterm to PTY
    term.onData((data) => {
      ptyWrite(shape.id, data).catch(() => {});
    });

    // Forward resize events
    term.onResize(({ cols, rows }) => {
      ptyResize(shape.id, cols, rows).catch(() => {});
    });

    return () => {
      // Only clean up if we actually initialized
      if (termRef.current) {
        termRef.current.dispose();
        termRef.current = null;
      }
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      initRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Re-fit on shape resize ────────────────────────────────────────────
  useEffect(() => {
    if (fitRef.current) {
      requestAnimationFrame(() => {
        try { fitRef.current?.fit(); } catch { /* */ }
      });
    }
  }, [w, h]);

  // ── Capture pointer events ONLY on xterm area (not title bar) ──────
  const xtermCaptureRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const handler = (e: PointerEvent) => { e.stopPropagation(); e.stopImmediatePropagation(); };
    el.addEventListener("pointerdown", handler, { capture: true });
  }, []);

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
      <div style={{
        width: "100%", height: "100%",
        background: "#0a0908", border: `1px solid ${C.border}`,
        borderRadius: 6, overflow: "hidden",
        display: "flex", flexDirection: "column",
        position: "relative",
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
        </div>

        {/* xterm.js container — captures pointer events to allow typing */}
        <div
          ref={(el) => { containerRef.current = el; xtermCaptureRef(el); }}
          style={{ flex: 1, padding: 4 }}
          onClick={() => termRef.current?.focus()}
        />

        <Port side="left" type="text" name="stdin" shapeId={shape.id} />
        <Port side="right" type="data" name="result" shapeId={shape.id} />
      </div>
    </HTMLContainer>
  );
}
