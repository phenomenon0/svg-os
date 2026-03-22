/**
 * Parameter Panel — Houdini-style property editor for selected nodes.
 * Appears on the right when a node is selected.
 */

import { useEditor, useValue } from "tldraw";
import { listNodeTypes } from "@svg-os/bridge";

export function ParameterPanel() {
  const editor = useEditor();

  const selectedShape = useValue(
    "selected shape",
    () => {
      const ids = editor.getSelectedShapeIds();
      if (ids.length !== 1) return null;
      return editor.getShape(ids[0]);
    },
    [editor]
  );

  if (!selectedShape) return null;
  if (selectedShape.type !== "svg-template" && selectedShape.type !== "html") return null;

  return (
    <div style={{
      position: "absolute",
      right: 0, top: 0, bottom: 0,
      width: 260,
      background: "#151d2e",
      borderLeft: "1px solid #334155",
      overflowY: "auto",
      zIndex: 1000,
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: 12,
      color: "#e2e8f0",
    }}>
      {/* Header */}
      <div style={{
        padding: "10px 14px",
        borderBottom: "1px solid #334155",
        fontSize: 11, fontWeight: 600, color: "#94a3b8",
        textTransform: "uppercase", letterSpacing: "0.05em",
      }}>
        Parameters
      </div>

      {selectedShape.type === "svg-template" && (
        <SvgTemplateParams
          shape={selectedShape as any}
          editor={editor}
        />
      )}

      {selectedShape.type === "html" && (
        <HtmlParams
          shape={selectedShape as any}
          editor={editor}
        />
      )}
    </div>
  );
}

function SvgTemplateParams({ shape, editor }: { shape: any; editor: any }) {
  const typeId = shape.props.typeId;
  const shapeData: Record<string, unknown> = (() => {
    try { return JSON.parse(shape.props.data || "{}"); } catch { return {}; }
  })();

  // Get slot definitions for this type
  let slots: Array<{ field: string; bind_type: string; target_attr: string }> = [];
  try {
    const types = listNodeTypes();
    const nt = types.find((t: any) => t.id === typeId);
    if (nt) slots = nt.slots;
  } catch { /* WASM not ready */ }

  const updateSlotValue = (field: string, value: string) => {
    const currentData: Record<string, unknown> = (() => {
      try { return JSON.parse(shape.props.data || "{}"); } catch { return {}; }
    })();
    currentData[field] = value;
    editor.updateShape({
      id: shape.id,
      type: "svg-template",
      props: { data: JSON.stringify(currentData) },
    });
  };

  return (
    <div style={{ padding: 12 }}>
      <ParamGroup label="Node">
        <ParamRow label="Type" value={typeId || "\u2014"} readonly />
        <ParamRow label="Width" value={String(Math.round(shape.props.w))} readonly />
        <ParamRow label="Height" value={String(Math.round(shape.props.h))} readonly />
      </ParamGroup>

      {slots.length > 0 && (
        <ParamGroup label="Data Bindings">
          {slots.map((slot) => (
            <ParamRow
              key={slot.field}
              label={slot.field}
              value={shapeData[slot.field] != null ? String(shapeData[slot.field]) : ""}
              placeholder={`${slot.bind_type} \u2192 ${slot.target_attr}`}
              onChange={(val) => updateSlotValue(slot.field, val)}
            />
          ))}
        </ParamGroup>
      )}

      <ParamGroup label="Position">
        <ParamRow label="X" value={String(Math.round(shape.x))} readonly />
        <ParamRow label="Y" value={String(Math.round(shape.y))} readonly />
      </ParamGroup>
    </div>
  );
}

function HtmlParams({ shape, editor }: { shape: any; editor: any }) {
  const updateProp = (key: string, value: string) => {
    editor.updateShape({
      id: shape.id,
      type: "html",
      props: { [key]: value },
    });
  };

  return (
    <div style={{ padding: 12 }}>
      <ParamGroup label="Content">
        <ParamRow
          label="Title"
          value={shape.props.title}
          onChange={(v) => updateProp("title", v)}
        />
        <ParamRow
          label="Variant"
          value={shape.props.variant}
          onChange={(v) => updateProp("variant", v)}
        />
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>Content</div>
          <textarea
            value={shape.props.content}
            onChange={(e) => updateProp("content", e.target.value)}
            style={{
              width: "100%", minHeight: 60, padding: "6px 8px",
              background: "#0f172a", border: "1px solid #334155",
              borderRadius: 4, color: "#e2e8f0", fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              resize: "vertical",
            }}
          />
        </div>
      </ParamGroup>

      <ParamGroup label="Size">
        <ParamRow label="Width" value={String(Math.round(shape.props.w))}
          onChange={(v) => updateProp("w", v)} />
        <ParamRow label="Height" value={String(Math.round(shape.props.h))}
          onChange={(v) => updateProp("h", v)} />
      </ParamGroup>

      <ParamGroup label="Position">
        <ParamRow label="X" value={String(Math.round(shape.x))} readonly />
        <ParamRow label="Y" value={String(Math.round(shape.y))} readonly />
      </ParamGroup>
    </div>
  );
}

function ParamGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 10, fontWeight: 600, color: "#475569",
        textTransform: "uppercase", letterSpacing: "0.08em",
        marginBottom: 8,
      }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function ParamRow({
  label, value, placeholder, readonly, onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  readonly?: boolean;
  onChange?: (val: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
      <span style={{ fontSize: 11, color: "#94a3b8", width: 60, flexShrink: 0 }}>{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        readOnly={readonly}
        onChange={(e) => onChange?.(e.target.value)}
        style={{
          flex: 1, padding: "3px 6px",
          background: readonly ? "transparent" : "#0f172a",
          border: readonly ? "none" : "1px solid #334155",
          borderRadius: 3, color: "#e2e8f0", fontSize: 11,
          fontFamily: "inherit",
        }}
      />
    </div>
  );
}
