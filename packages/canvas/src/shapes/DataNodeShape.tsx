/**
 * DataNode — JSON data source with embedded tree renderer.
 * Compact pill mode when small, full JSON viewer when expanded.
 * Output port on the right edge.
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
import { JsonRenderer } from "../lib/JsonRenderer";
import { EditableLabel } from "../EditableLabel";
import { C, FONT, nodeContainerStyle, titleBarStyle } from "../theme";

export type DataNodeShape = TLBaseShape<
  "data-node",
  { w: number; h: number; dataJson: string; label: string }
>;

export class DataNodeShapeUtil extends ShapeUtil<DataNodeShape> {
  static override type = "data-node" as const;
  static override props = { w: T.number, h: T.number, dataJson: T.string, label: T.string };

  getDefaultProps(): DataNodeShape["props"] {
    return { w: 300, h: 200, dataJson: '{\n  "name": "Example",\n  "score": 95,\n  "tags": ["a", "b"]\n}', label: "Data" };
  }

  override getGeometry(shape: DataNodeShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override canBind() { return true; }
  override canEdit() { return false; }

  override getHandleSnapGeometry(shape: DataNodeShape) {
    return {
      points: [
        new Vec(0, shape.props.h / 2),
        new Vec(shape.props.w, shape.props.h / 2),
      ],
    };
  }

  override component(shape: DataNodeShape) {
    return <DataComponent shape={shape} />;
  }

  override indicator(shape: DataNodeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }

  override canResize() { return true; }

  override onResize(shape: DataNodeShape, info: { scaleX: number; scaleY: number }) {
    return {
      props: {
        w: Math.max(200, shape.props.w * info.scaleX),
        h: Math.max(100, shape.props.h * info.scaleY),
      },
    };
  }
}

// ── Data Component ───────────────────────────────────────────────────────────

function DataComponent({ shape }: { shape: DataNodeShape }) {
  const editor = useEditor();
  const { w, h, label, dataJson } = shape.props;
  const [mode, setMode] = useState<"tree" | "edit">("tree");
  const [localJson, setLocalJson] = useState(dataJson);

  if (dataJson !== localJson && mode === "tree") {
    setLocalJson(dataJson);
  }

  let parsed: unknown = null;
  let parseError = "";
  let summary = "";
  try {
    parsed = JSON.parse(dataJson);
    if (Array.isArray(parsed)) summary = `${parsed.length} items`;
    else if (typeof parsed === "object" && parsed !== null) summary = `${Object.keys(parsed).length} fields`;
    else summary = typeof parsed;
  } catch (e) {
    parseError = e instanceof Error ? e.message : "Invalid JSON";
  }

  const commitJson = useCallback((text: string) => {
    setLocalJson(text);
    editor.updateShape({
      id: shape.id,
      type: "data-node",
      props: { dataJson: text },
    });
  }, [editor, shape.id]);

  const toggleMode = useCallback(() => {
    if (mode === "edit") {
      // Commit on switch back to tree
      commitJson(localJson);
    }
    setMode(m => m === "tree" ? "edit" : "tree");
  }, [mode, localJson, commitJson]);

  // Capture-phase pointer interception for textarea
  const cleanupRef = useRef<(() => void) | null>(null);
  const textareaRef = useCallback((el: HTMLTextAreaElement | null) => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    if (!el) return;
    const handler = (e: PointerEvent) => { e.stopPropagation(); e.stopImmediatePropagation(); };
    el.addEventListener("pointerdown", handler, { capture: true });
    cleanupRef.current = () => el.removeEventListener("pointerdown", handler, { capture: true });
  }, []);

  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      try { JSON.parse(text); commitJson(text); } catch { /* not valid JSON */ }
    };
    reader.readAsText(file);
  }, [commitJson]);

  const isCompact = h < 150;

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
      <div
        style={{ ...nodeContainerStyle, borderColor: dragOver ? C.accent : C.border }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {/* Title bar */}
        <div style={titleBarStyle}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.data, flexShrink: 0 }} />
          <EditableLabel
            value={label}
            onChange={(v) => editor.updateShape({ id: shape.id, type: "data-node", props: { label: v } })}
          />
          <span style={{ flex: 1, textAlign: "right", color: C.faint, fontSize: 9, fontFamily: FONT.mono, letterSpacing: "0.05em" }}>
            {summary}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); toggleMode(); }}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              background: mode === "edit" ? `${C.data}22` : "transparent",
              border: `1px solid ${C.data}55`,
              borderRadius: 4,
              color: C.data,
              fontSize: 9,
              padding: "1px 8px",
              cursor: "pointer",
              fontFamily: FONT.mono,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            {mode === "tree" ? "Edit" : "Tree"}
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: "4px 8px" }}>
          {dragOver ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: C.accent, fontFamily: FONT.mono, fontSize: 12 }}>
              Drop JSON file here
            </div>
          ) : isCompact ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontFamily: FONT.mono, fontSize: 13, color: C.muted }}>
              {parseError ? <span style={{ color: C.red }}>invalid</span> : summary}
            </div>
          ) : mode === "tree" ? (
            parseError ? (
              <div style={{ padding: 8, color: C.red, fontFamily: FONT.mono, fontSize: 11 }}>
                {parseError}
              </div>
            ) : (
              <JsonRenderer data={parsed} rootOpen={true} />
            )
          ) : (
            <textarea
              ref={textareaRef}
              value={localJson}
              onChange={(e) => setLocalJson(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              onBlur={() => commitJson(localJson)}
              style={{
                width: "100%",
                height: "100%",
                padding: 6,
                background: "transparent",
                border: "none",
                color: C.fg,
                fontSize: 12,
                fontFamily: FONT.mono,
                resize: "none",
                outline: "none",
                lineHeight: 1.6,
              }}
            />
          )}
        </div>

        <Port side="left" type="data" name="in" shapeId={shape.id} />
        <Port side="right" type="data" name="data" shapeId={shape.id} />
      </div>
    </HTMLContainer>
  );
}
