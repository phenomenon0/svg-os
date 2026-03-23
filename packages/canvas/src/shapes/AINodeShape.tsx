/**
 * AINode — Claude API integration on the canvas.
 * Prompt textarea + response display. Connects to data flow.
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
import { callClaude } from "../lib/claude-api";
import { EditableLabel } from "../EditableLabel";
import { C, FONT, nodeContainerStyle, titleBarStyle } from "../theme";

export type AINodeShape = TLBaseShape<
  "ai-node",
  {
    w: number;
    h: number;
    label: string;
    prompt: string;
    response: string;
    model: string;
    status: string;
    errorMessage: string;
  }
>;

export class AINodeShapeUtil extends ShapeUtil<AINodeShape> {
  static override type = "ai-node" as const;

  static override props = {
    w: T.number, h: T.number,
    label: T.string, prompt: T.string, response: T.string,
    model: T.string, status: T.string, errorMessage: T.string,
  };

  getDefaultProps(): AINodeShape["props"] {
    return {
      w: 400, h: 320, label: "AI",
      prompt: "", response: "",
      model: "claude-opus-4-6",
      status: "idle", errorMessage: "",
    };
  }

  override getGeometry(shape: AINodeShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override canBind() { return true; }
  override canEdit() { return false; }

  override getHandleSnapGeometry(shape: AINodeShape) {
    return {
      points: [
        new Vec(0, shape.props.h / 2),
        new Vec(shape.props.w, shape.props.h / 2),
      ],
    };
  }

  override component(shape: AINodeShape) {
    return <AIComponent shape={shape} />;
  }

  override indicator(shape: AINodeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }

  override canResize() { return true; }

  override onResize(shape: AINodeShape, info: { scaleX: number; scaleY: number }) {
    return {
      props: {
        w: Math.max(280, shape.props.w * info.scaleX),
        h: Math.max(200, shape.props.h * info.scaleY),
      },
    };
  }
}

function AIComponent({ shape }: { shape: AINodeShape }) {
  const editor = useEditor();
  const { w, h, label, prompt, response, model, status, errorMessage } = shape.props;
  const [localPrompt, setLocalPrompt] = useState(prompt);

  if (prompt !== localPrompt) setLocalPrompt(prompt);

  const commitPrompt = useCallback((text: string) => {
    editor.updateShape({ id: shape.id, type: "ai-node", props: { prompt: text } });
  }, [editor, shape.id]);

  const run = useCallback(async () => {
    const currentPrompt = localPrompt.trim();
    if (!currentPrompt) return;
    editor.updateShape({
      id: shape.id, type: "ai-node",
      props: { status: "loading", errorMessage: "", prompt: currentPrompt },
    });
    const { text, error } = await callClaude(currentPrompt);
    editor.updateShape({
      id: shape.id, type: "ai-node",
      props: { response: text || "", status: error ? "error" : "done", errorMessage: error || "" },
    });
  }, [editor, shape.id, localPrompt]);

  const cleanupRef = useRef<(() => void) | null>(null);
  const textareaRef = useCallback((el: HTMLTextAreaElement | null) => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    if (!el) return;
    const handler = (e: PointerEvent) => { e.stopPropagation(); e.stopImmediatePropagation(); };
    el.addEventListener("pointerdown", handler, { capture: true });
    cleanupRef.current = () => el.removeEventListener("pointerdown", handler, { capture: true });
  }, []);

  const statusColor = status === "loading" ? C.yellow
    : status === "error" ? C.red
    : status === "done" ? C.green
    : C.faint;

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
      <div style={nodeContainerStyle}>
        <div style={titleBarStyle}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, flexShrink: 0, boxShadow: status === "loading" ? `0 0 8px ${statusColor}` : "none" }} />
          <EditableLabel
            value={label}
            onChange={(v) => editor.updateShape({ id: shape.id, type: "ai-node", props: { label: v } })}
          />
          <span style={{ flex: 1, color: C.faint, fontSize: 9, textAlign: "right", fontFamily: FONT.mono, letterSpacing: "0.05em", textTransform: "uppercase" }}>
            {model.replace("claude-", "").replace("-20250514", "")}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); run(); }}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={status === "loading"}
            style={{
              background: status === "loading" ? C.bgHover : C.ai,
              border: "none",
              borderRadius: 4,
              color: status === "loading" ? C.muted : C.bg,
              fontSize: 10,
              padding: "3px 10px",
              cursor: status === "loading" ? "wait" : "pointer",
              fontWeight: 600,
              fontFamily: FONT.sans,
              letterSpacing: "0.02em",
            }}
          >
            {status === "loading" ? "\u2026" : "Run"}
          </button>
        </div>

        {/* Prompt */}
        <div style={{ padding: "8px 10px 0", flexShrink: 0 }}>
          <div style={{ fontFamily: FONT.mono, fontSize: 9, color: C.faint, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Prompt
          </div>
          <textarea
            ref={textareaRef}
            value={localPrompt}
            onChange={(e) => { setLocalPrompt(e.target.value); commitPrompt(e.target.value); }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
            }}
            placeholder="Ask Claude anything... Use {{field}} for upstream data"
            rows={3}
            style={{
              width: "100%", padding: "8px 10px",
              background: C.bgDeep,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              color: C.fg, fontSize: 13,
              fontFamily: FONT.sans,
              resize: "none", outline: "none",
              lineHeight: 1.6,
            }}
          />
        </div>

        {/* Response */}
        <div style={{
          flex: 1, margin: "8px 10px 10px", padding: 10,
          background: C.bgDeep,
          border: `1px solid ${C.borderSoft}`,
          borderRadius: 6,
          overflow: "auto",
          fontSize: 13, lineHeight: 1.7,
          color: C.fgSoft,
          fontFamily: FONT.serif,
        }}>
          {status === "loading" && <span style={{ color: C.yellow, fontFamily: FONT.mono, fontSize: 11 }}>Thinking\u2026</span>}
          {status === "error" && <span style={{ color: C.red, fontFamily: FONT.mono, fontSize: 12 }}>{errorMessage || "API error"}</span>}
          {(status === "done" || status === "idle") && (
            <span style={{ color: response ? C.fgSoft : C.dim, whiteSpace: "pre-wrap" }}>
              {response || "Response will appear here"}
            </span>
          )}
        </div>

        <Port side="left" type="data" name="context" shapeId={shape.id} index={0} total={1} />
        <Port side="right" type="text" name="response" shapeId={shape.id} />
      </div>
    </HTMLContainer>
  );
}
