/**
 * CompactNodeShape — generic pill shape for any node type that doesn't
 * have a dedicated custom shape. Desktop version without Runtime dependency.
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
import { useState, useRef, useCallback } from "react";
import { Port, type PortType } from "../Port";
import { EditableLabel } from "../EditableLabel";
import { C, FONT } from "../theme";

export type CompactNodeShape = TLBaseShape<
  "compact-node",
  {
    w: number;
    h: number;
    label: string;
    nodeType: string;
    subsystem: string;
    configJson: string;
  }
>;

const SUBSYSTEM_COLORS: Record<string, string> = {
  system: C.green,
  data: C.blue,
  view: C.accent,
};

function getSubsystemColor(subsystem: string): string {
  return SUBSYSTEM_COLORS[subsystem] || C.faint;
}

export class CompactNodeShapeUtil extends ShapeUtil<CompactNodeShape> {
  static override type = "compact-node" as const;

  static override props = {
    w: T.number,
    h: T.number,
    label: T.string,
    nodeType: T.string,
    subsystem: T.string,
    configJson: T.string,
  };

  getDefaultProps(): CompactNodeShape["props"] {
    return {
      w: 180,
      h: 48,
      label: "",
      nodeType: "",
      subsystem: "",
      configJson: "{}",
    };
  }

  override canEdit() { return false; }

  override getGeometry(shape: CompactNodeShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override canBind() { return true; }

  override getHandleSnapGeometry(shape: CompactNodeShape) {
    return {
      points: [
        new Vec(0, shape.props.h / 2),
        new Vec(shape.props.w, shape.props.h / 2),
      ],
    };
  }

  override component(shape: CompactNodeShape) {
    return <CompactComponent shape={shape} />;
  }

  override indicator(shape: CompactNodeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={24} />;
  }

  override canResize() { return true; }

  override onResize(shape: CompactNodeShape, info: { scaleX: number; scaleY: number }) {
    return {
      props: {
        w: Math.max(120, shape.props.w * info.scaleX),
        h: 48,
      },
    };
  }
}

const TYPE_LABELS: Record<string, string> = {
  "sys:file-open": "File Open", "sys:file-write": "File Write", "sys:folder": "Folder",
  "sys:disk": "Disk", "sys:processes": "Processes", "sys:network": "Network",
  "sys:geolocation": "Location", "sys:clipboard-read": "Clipboard In", "sys:clipboard-write": "Clipboard Out",
  "sys:screen-capture": "Screenshot", "sys:notify": "Notify", "sys:env": "Env",
  "data:filter": "Filter", "data:merge": "Merge", "data:fetch": "Fetch",
  "view:metric": "Metric", "view:chart": "Chart",
};

function CompactComponent({ shape }: { shape: CompactNodeShape }) {
  const editor = useEditor();
  const { w, h, label, nodeType, subsystem } = shape.props;
  const [pickerOpen, setPickerOpen] = useState(!nodeType);
  const [pickerFilter, setPickerFilter] = useState("");

  const isBlank = !nodeType;
  const color = isBlank ? C.faint : getSubsystemColor(subsystem);

  const assignType = useCallback((type: string) => {
    const sub = type.startsWith("sys:") ? "system" : type.startsWith("data:") ? "data" : "view";
    const name = TYPE_LABELS[type] || type.split(":")[1]?.replace(/-/g, " ") || type;
    editor.updateShape({
      id: shape.id,
      type: "compact-node",
      props: { nodeType: type, subsystem: sub, label: name, configJson: "{}" },
    });
    setPickerOpen(false);
  }, [editor, shape.id]);

  const cleanupRef = useRef<(() => void) | null>(null);
  const inputRef = useCallback((el: HTMLInputElement | null) => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    if (!el) return;
    el.focus();
    const handler = (e: PointerEvent) => { e.stopPropagation(); e.stopImmediatePropagation(); };
    el.addEventListener("pointerdown", handler, { capture: true });
    cleanupRef.current = () => el.removeEventListener("pointerdown", handler, { capture: true });
  }, []);

  const shortType = nodeType.includes(":") ? nodeType.split(":")[1] : nodeType;

  // Blank node: show type picker
  if (isBlank || pickerOpen) {
    const allTypes = Object.keys(TYPE_LABELS);
    const fq = pickerFilter.toLowerCase();
    const filtered = fq
      ? allTypes.filter(t => t.includes(fq) || (TYPE_LABELS[t] || "").toLowerCase().includes(fq))
      : allTypes;

    return (
      <HTMLContainer style={{ width: w, height: Math.max(h, 200), pointerEvents: "all" }}>
        <div style={{
          width: "100%", height: "100%",
          borderRadius: 12, background: C.bgCard,
          border: `1px dashed ${C.faint}55`,
          display: "flex", flexDirection: "column",
          fontFamily: FONT.sans, position: "relative",
          overflow: "hidden",
        }}>
          <div style={{
            padding: "8px 10px", display: "flex", alignItems: "center", gap: 6,
            borderBottom: `1px solid ${C.borderSoft}`,
          }}>
            <span style={{ color: C.faint, fontSize: 11 }}>?</span>
            <input
              ref={inputRef}
              type="text"
              value={pickerFilter}
              onChange={e => setPickerFilter(e.target.value)}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === "Escape") { setPickerOpen(false); setPickerFilter(""); }
                if (e.key === "Enter" && filtered.length > 0) assignType(filtered[0]);
              }}
              placeholder="Pick a type..."
              style={{
                flex: 1, background: "transparent", border: "none",
                color: C.fg, fontSize: 11, fontFamily: FONT.sans,
                outline: "none",
              }}
            />
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: 4 }}>
            {filtered.map(t => {
              const sub = t.startsWith("sys:") ? "system" : t.startsWith("data:") ? "data" : "view";
              const col = getSubsystemColor(sub);
              return (
                <div key={t}
                  onClick={e => { e.stopPropagation(); assignType(t); }}
                  onPointerDown={e => e.stopPropagation()}
                  style={{
                    padding: "4px 8px", borderRadius: 4, cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 6,
                    fontSize: 11, color: C.fgSoft,
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = C.bgHover}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: col, flexShrink: 0 }} />
                  {TYPE_LABELS[t] || t}
                  <span style={{ marginLeft: "auto", fontSize: 8, color: C.dim, fontFamily: FONT.mono }}>{t}</span>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ padding: 8, color: C.dim, fontSize: 10, textAlign: "center" }}>No match</div>
            )}
          </div>
        </div>
      </HTMLContainer>
    );
  }

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
      <div
        onDoubleClick={e => { e.stopPropagation(); setPickerOpen(true); }}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 24,
          background: C.bgAlt,
          border: `1px solid ${color}44`,
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          gap: 8,
          fontFamily: FONT.sans,
          position: "relative",
          boxShadow: `0 2px 8px rgba(0,0,0,0.25)`,
        }}
      >
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />

        <EditableLabel
          value={label || shortType}
          color={C.fgSoft}
          onChange={(v) => editor.updateShape({ id: shape.id, type: "compact-node", props: { label: v } })}
        />

        <div style={{
          fontSize: 9, color: C.faint, marginLeft: "auto",
          fontFamily: FONT.mono, letterSpacing: "0.04em",
        }}>
          {shortType}
        </div>

        <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.dim, flexShrink: 0 }} />

        {/* Fallback ports */}
        {!isBlank && (
          <>
            <Port side="left" type="any" name="in" shapeId={shape.id} />
            <Port side="right" type="any" name="out" shapeId={shape.id} />
          </>
        )}
      </div>
    </HTMLContainer>
  );
}
