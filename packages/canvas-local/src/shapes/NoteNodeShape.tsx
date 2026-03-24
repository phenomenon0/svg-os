/**
 * NoteNode — Obsidian-style markdown editor on the canvas.
 * Edit mode: raw markdown. Preview mode: rendered HTML.
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
import { EditableLabel } from "../EditableLabel";
import { C, FONT, nodeContainerStyle, titleBarStyle } from "../theme";

export type NoteNodeShape = TLBaseShape<
  "note-node",
  {
    w: number;
    h: number;
    label: string;
    content: string;
    mode: string;
  }
>;

export class NoteNodeShapeUtil extends ShapeUtil<NoteNodeShape> {
  static override type = "note-node" as const;

  static override props = {
    w: T.number,
    h: T.number,
    label: T.string,
    content: T.string,
    mode: T.string,
  };

  getDefaultProps(): NoteNodeShape["props"] {
    return { w: 360, h: 420, label: "Note", content: "", mode: "edit" };
  }

  override getGeometry(shape: NoteNodeShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override canBind() { return true; }
  override canEdit() { return false; }

  override getHandleSnapGeometry(shape: NoteNodeShape) {
    return {
      points: [
        new Vec(0, shape.props.h / 2),
        new Vec(shape.props.w, shape.props.h / 2),
      ],
    };
  }

  override component(shape: NoteNodeShape) {
    return <NoteComponent shape={shape} />;
  }

  override indicator(shape: NoteNodeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }

  override canResize() { return true; }

  override onResize(shape: NoteNodeShape, info: { scaleX: number; scaleY: number }) {
    return {
      props: {
        w: Math.max(200, shape.props.w * info.scaleX),
        h: Math.max(120, shape.props.h * info.scaleY),
      },
    };
  }
}

function NoteComponent({ shape }: { shape: NoteNodeShape }) {
  const editor = useEditor();
  const { w, h, label, content, mode } = shape.props;
  const [localContent, setLocalContent] = useState(content);

  if (content !== localContent) setLocalContent(content);

  const commitContent = useCallback((text: string) => {
    editor.updateShape({ id: shape.id, type: "note-node", props: { content: text } });
  }, [editor, shape.id]);

  const toggleMode = useCallback(() => {
    editor.updateShape({
      id: shape.id, type: "note-node",
      props: { mode: mode === "edit" ? "preview" : "edit" },
    });
  }, [editor, shape.id, mode]);

  const cleanupRef = useRef<(() => void) | null>(null);
  const textareaRef = useCallback((el: HTMLTextAreaElement | null) => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    if (!el) return;
    const handler = (e: PointerEvent) => { e.stopPropagation(); e.stopImmediatePropagation(); };
    el.addEventListener("pointerdown", handler, { capture: true });
    cleanupRef.current = () => el.removeEventListener("pointerdown", handler, { capture: true });
  }, []);

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
      <div style={nodeContainerStyle}>
        <div style={titleBarStyle}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.note, flexShrink: 0 }} />
          <EditableLabel
            value={label}
            onChange={(v) => editor.updateShape({ id: shape.id, type: "note-node", props: { label: v } })}
          />
          <span style={{ flex: 1 }} />
          <button
            onClick={(e) => { e.stopPropagation(); toggleMode(); }}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              background: mode === "preview" ? `${C.note}22` : "transparent",
              border: `1px solid ${C.note}55`,
              borderRadius: 4,
              color: C.note,
              fontSize: 9,
              padding: "1px 8px",
              cursor: "pointer",
              fontFamily: FONT.mono,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            {mode === "edit" ? "Preview" : "Edit"}
          </button>
        </div>

        {mode === "edit" ? (
          <textarea
            ref={textareaRef}
            value={localContent}
            onChange={(e) => { setLocalContent(e.target.value); commitContent(e.target.value); }}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Write markdown here..."
            style={{
              flex: 1, padding: 14,
              background: "transparent", border: "none",
              color: C.fg, fontSize: 14,
              fontFamily: FONT.mono,
              resize: "none", outline: "none",
              lineHeight: 1.7,
            }}
          />
        ) : (
          <div
            style={{
              flex: 1, padding: 14, overflow: "auto",
              fontSize: 14, lineHeight: 1.7,
              color: C.fgSoft,
              fontFamily: FONT.serif,
            }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(localContent) }}
          />
        )}

        <Port side="left" type="data" name="data" shapeId={shape.id} />
        <Port side="right" type="text" name="text" shapeId={shape.id} />
      </div>
    </HTMLContainer>
  );
}

function renderMarkdown(md: string): string {
  if (!md) return `<span style="color:${C.faint}">Empty note</span>`;
  return md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, `<h3 style="font-size:15px;margin:14px 0 6px;color:${C.fg};font-weight:600;font-family:${FONT.serif}">$1</h3>`)
    .replace(/^## (.+)$/gm, `<h2 style="font-size:18px;margin:16px 0 8px;color:${C.fg};font-weight:400;font-family:${FONT.serif}">$1</h2>`)
    .replace(/^# (.+)$/gm, `<h1 style="font-size:22px;margin:18px 0 10px;color:${C.fg};font-weight:400;font-family:${FONT.serif};letter-spacing:-0.02em">$1</h1>`)
    .replace(/\*\*(.+?)\*\*/g, `<strong style="color:${C.fg};font-weight:600">$1</strong>`)
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, `<code style="background:${C.bgDeep};padding:2px 5px;border-radius:3px;font-size:13px;color:${C.accent};font-family:${FONT.mono}">$1</code>`)
    .replace(/^- (.+)$/gm, `<div style="padding-left:16px;margin:3px 0">\u2022 $1</div>`)
    .replace(/^\d+\. (.+)$/gm, `<div style="padding-left:16px;margin:3px 0">$1</div>`)
    .replace(/^---$/gm, `<hr style="border:none;border-top:1px solid ${C.border};margin:14px 0"/>`)
    .replace(/\n\n/g, '<div style="height:12px"></div>')
    .replace(/\n/g, "<br>");
}
