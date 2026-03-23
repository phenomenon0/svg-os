/**
 * Parameter Panel — per-type property editor for selected nodes.
 * Appears on the right when a DataNode, TransformNode, or ViewNode is selected.
 */

import { useEditor, useValue } from "tldraw";
import { listNodeTypes } from "@svg-os/bridge";
import type { DataNodeShape } from "./shapes/DataNodeShape";
import type { TransformNodeShape } from "./shapes/TransformNodeShape";
import type { ViewNodeShape } from "./shapes/ViewNodeShape";
import type { TableNodeShape } from "./shapes/TableNodeShape";
import type { MultiplexerNodeShape } from "./shapes/MultiplexerNodeShape";
import type { WebViewShape } from "./shapes/WebViewShape";

type AnyNodeShape = DataNodeShape | TransformNodeShape | ViewNodeShape | TableNodeShape | MultiplexerNodeShape | WebViewShape;

const NODE_TYPES = ["data-node", "transform-node", "view-node", "table-node", "multiplexer-node", "web-view"] as const;

export function ParameterPanel() {
  const editor = useEditor();

  const selectedShape = useValue(
    "selected shape",
    () => {
      const ids = editor.getSelectedShapeIds();
      if (ids.length !== 1) return null;
      const shape = editor.getShape(ids[0]);
      if (!shape) return null;
      if (!NODE_TYPES.includes(shape.type as (typeof NODE_TYPES)[number])) return null;
      return shape as AnyNodeShape;
    },
    [editor]
  );

  if (!selectedShape) return null;

  return (
    <div
      style={{
        position: "absolute",
        right: 0,
        top: 0,
        bottom: 0,
        width: 260,
        background: "#151d2e",
        borderLeft: "1px solid #334155",
        overflowY: "auto",
        zIndex: 1000,
        pointerEvents: "all",
        fontFamily: "'Inter', system-ui, sans-serif",
        fontSize: 12,
        color: "#e2e8f0",
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid #334155",
          fontSize: 11,
          fontWeight: 600,
          color: "#94a3b8",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        Parameters
      </div>

      {selectedShape.type === "data-node" && (
        <DataNodeParams shape={selectedShape as DataNodeShape} editor={editor} />
      )}
      {selectedShape.type === "transform-node" && (
        <TransformNodeParams
          shape={selectedShape as TransformNodeShape}
          editor={editor}
        />
      )}
      {selectedShape.type === "view-node" && (
        <ViewNodeParams shape={selectedShape as ViewNodeShape} editor={editor} />
      )}
      {selectedShape.type === "table-node" && (
        <TableNodeParams shape={selectedShape as TableNodeShape} editor={editor} />
      )}
      {selectedShape.type === "multiplexer-node" && (
        <MultiplexerNodeParams shape={selectedShape as MultiplexerNodeShape} editor={editor} />
      )}
      {selectedShape.type === "web-view" && (
        <WebViewParams shape={selectedShape as WebViewShape} editor={editor} />
      )}
    </div>
  );
}

// ── DataNode Panel ────────────────────────────────────────────────────────────

function DataNodeParams({
  shape,
  editor,
}: {
  shape: DataNodeShape;
  editor: ReturnType<typeof useEditor>;
}) {
  const { label, dataJson } = shape.props;

  let keyCount = 0;
  try {
    keyCount = Object.keys(JSON.parse(dataJson)).length;
  } catch {
    /* invalid */
  }

  const updateProp = (key: string, value: string) => {
    editor.updateShape({
      id: shape.id,
      type: "data-node",
      props: { [key]: value },
    });
  };

  return (
    <div style={{ padding: 12 }}>
      <ParamGroup label="Node">
        <ParamRow
          label="Label"
          value={label}
          onChange={(v) => updateProp("label", v)}
        />
      </ParamGroup>

      <ParamGroup label="Data">
        <div style={{ marginBottom: 8 }}>
          <div
            style={{
              fontSize: 10,
              color: "#64748b",
              marginBottom: 4,
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>JSON</span>
            <span>{keyCount} keys</span>
          </div>
          <textarea
            value={dataJson}
            onChange={(e) => updateProp("dataJson", e.target.value)}
            style={{
              width: "100%",
              minHeight: 100,
              padding: "6px 8px",
              background: "#0f172a",
              border: "1px solid #334155",
              borderRadius: 4,
              color: "#e2e8f0",
              fontSize: 11,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              resize: "vertical",
              lineHeight: 1.5,
            }}
          />
        </div>
      </ParamGroup>

      <ParamGroup label="Position">
        <ParamRow label="X" value={String(Math.round(shape.x))} readonly />
        <ParamRow label="Y" value={String(Math.round(shape.y))} readonly />
      </ParamGroup>
    </div>
  );
}

// ── TransformNode Panel ───────────────────────────────────────────────────────

function TransformNodeParams({
  shape,
  editor,
}: {
  shape: TransformNodeShape;
  editor: ReturnType<typeof useEditor>;
}) {
  const { label, expression } = shape.props;

  const updateProp = (key: string, value: string) => {
    editor.updateShape({
      id: shape.id,
      type: "transform-node",
      props: { [key]: value },
    });
  };

  // Check for upstream connections
  const shapes = editor.getCurrentPageShapes();
  const arrows = shapes.filter((s) => s.type === "arrow");
  let hasInput = false;
  for (const arrow of arrows) {
    const bindings = editor.getBindingsFromShape(arrow.id, "arrow");
    const endBinding = bindings.find(
      (b) => (b.props as Record<string, unknown>).terminal === "end"
    );
    if (endBinding && endBinding.toId === shape.id) {
      hasInput = true;
      break;
    }
  }

  return (
    <div style={{ padding: 12 }}>
      <ParamGroup label="Node">
        <ParamRow
          label="Label"
          value={label}
          onChange={(v) => updateProp("label", v)}
        />
      </ParamGroup>

      <ParamGroup label="Expression">
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>
            Expression
          </div>
          <textarea
            value={expression}
            onChange={(e) => updateProp("expression", e.target.value)}
            style={{
              width: "100%",
              minHeight: 48,
              padding: "6px 8px",
              background: "#0f172a",
              border: "1px solid #6d28d9",
              borderRadius: 4,
              color: "#c4b5fd",
              fontSize: 11,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              resize: "vertical",
              lineHeight: 1.5,
            }}
          />
        </div>
        <div
          style={{
            fontSize: 10,
            color: hasInput ? "#22c55e" : "#64748b",
            padding: "4px 0",
          }}
        >
          {hasInput ? "Input: connected" : "Input: waiting"}
        </div>
      </ParamGroup>

      <ParamGroup label="Position">
        <ParamRow label="X" value={String(Math.round(shape.x))} readonly />
        <ParamRow label="Y" value={String(Math.round(shape.y))} readonly />
      </ParamGroup>
    </div>
  );
}

// ── ViewNode Panel ────────────────────────────────────────────────────────────

function ViewNodeParams({
  shape,
  editor,
}: {
  shape: ViewNodeShape;
  editor: ReturnType<typeof useEditor>;
}) {
  const { viewType, typeId, variant } = shape.props;
  const viewData: Record<string, unknown> = (() => {
    try { return JSON.parse((shape.props as any).data || "{}"); } catch { return {}; }
  })();

  const isSvg = viewType === "svg-template";
  const displayType = isSvg ? `SVG: ${typeId || "unknown"}` : `HTML: ${variant || "card"}`;

  // Get slot definitions for SVG templates
  let slots: Array<{ field: string; bind_type: string }> = [];
  if (isSvg && typeId) {
    try {
      const types = listNodeTypes();
      const nt = types.find((t: { id: string }) => t.id === typeId);
      if (nt) slots = nt.slots;
    } catch { /* WASM not ready */ }
  }

  const updateSlotValue = (field: string, value: string) => {
    const current: Record<string, unknown> = { ...viewData };
    current[field] = value;
    editor.updateShape({
      id: shape.id,
      type: "view-node",
      props: { data: JSON.stringify(current) },
    });
  };

  // Check for upstream connection
  const shapes = editor.getCurrentPageShapes();
  const arrows = shapes.filter((s) => s.type === "arrow");
  let connectedSourceName = "";
  for (const arrow of arrows) {
    const bindings = editor.getBindingsFromShape(arrow.id, "arrow");
    const startBinding = bindings.find(
      (b) => (b.props as Record<string, unknown>).terminal === "start"
    );
    const endBinding = bindings.find(
      (b) => (b.props as Record<string, unknown>).terminal === "end"
    );
    if (endBinding && endBinding.toId === shape.id && startBinding) {
      const srcShape = editor.getShape(startBinding.toId);
      if (srcShape) {
        const srcProps = srcShape.props as Record<string, string>;
        connectedSourceName = srcProps.label || srcShape.type;
      }
      break;
    }
  }

  return (
    <div style={{ padding: 12 }}>
      <ParamGroup label="View">
        <ParamRow label="Type" value={displayType} readonly />
        {isSvg && typeId && (
          <ParamRow label="Template" value={typeId} readonly />
        )}
      </ParamGroup>

      {slots.length > 0 && (
        <ParamGroup label="Data Fields">
          {slots.map((slot) => (
            <ParamRow
              key={slot.field}
              label={slot.field}
              value={viewData[slot.field] != null ? String(viewData[slot.field]) : ""}
              placeholder={slot.bind_type}
              onChange={(val) => updateSlotValue(slot.field, val)}
            />
          ))}
        </ParamGroup>
      )}

      <ParamGroup label="Connection">
        <div
          style={{
            fontSize: 11,
            color: connectedSourceName ? "#22c55e" : "#64748b",
            padding: "2px 0",
          }}
        >
          {connectedSourceName
            ? `Connected to: ${connectedSourceName}`
            : "No input"}
        </div>
      </ParamGroup>

      <ParamGroup label="Size">
        <ParamRow
          label="Width"
          value={String(Math.round(shape.props.w))}
          readonly
        />
        <ParamRow
          label="Height"
          value={String(Math.round(shape.props.h))}
          readonly
        />
      </ParamGroup>

      <ParamGroup label="Position">
        <ParamRow label="X" value={String(Math.round(shape.x))} readonly />
        <ParamRow label="Y" value={String(Math.round(shape.y))} readonly />
      </ParamGroup>
    </div>
  );
}

// ── TableNode Panel ──────────────────────────────────────────────────────────

function TableNodeParams({ shape, editor }: { shape: TableNodeShape; editor: ReturnType<typeof useEditor> }) {
  const { label, dataJson, outputMode } = shape.props;
  let rowCount = 0;
  try { rowCount = JSON.parse(dataJson).length; } catch { /* */ }

  const updateProp = (key: string, value: unknown) => {
    editor.updateShape({ id: shape.id, type: "table-node", props: { [key]: value } });
  };

  return (
    <div style={{ padding: 12 }}>
      <ParamGroup label="Table">
        <ParamRow label="Label" value={label} onChange={(v) => updateProp("label", v)} />
        <ParamRow label="Rows" value={String(rowCount)} readonly />
        <ParamRow label="Mode" value={outputMode} onChange={(v) => updateProp("outputMode", v)} />
      </ParamGroup>
      <ParamGroup label="Data">
        <textarea
          value={dataJson}
          onChange={(e) => updateProp("dataJson", e.target.value)}
          style={{
            width: "100%", minHeight: 120, padding: "6px 8px",
            background: "#0f172a", border: "1px solid #334155",
            borderRadius: 4, color: "#e2e8f0", fontSize: 10,
            fontFamily: "'JetBrains Mono', monospace", resize: "vertical", lineHeight: 1.4,
          }}
        />
      </ParamGroup>
    </div>
  );
}

// ── MultiplexerNode Panel ───────────────────────────────────────────────────

function MultiplexerNodeParams({ shape, editor }: { shape: MultiplexerNodeShape; editor: ReturnType<typeof useEditor> }) {
  const { label, templateId, maxItems } = shape.props;

  let templates: Array<{ id: string; name: string }> = [];
  try { templates = listNodeTypes().map(t => ({ id: t.id, name: t.name })); } catch { /* */ }

  const updateProp = (key: string, value: unknown) => {
    editor.updateShape({ id: shape.id, type: "multiplexer-node", props: { [key]: value } });
  };

  return (
    <div style={{ padding: 12 }}>
      <ParamGroup label="Multiplexer">
        <ParamRow label="Label" value={label} onChange={(v) => updateProp("label", v)} />
        <ParamRow label="Max" value={String(maxItems)} onChange={(v) => updateProp("maxItems", parseInt(v) || 5)} />
      </ParamGroup>
      <ParamGroup label="Template">
        <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>Select template for rendering</div>
        <select
          value={templateId}
          onChange={(e) => updateProp("templateId", e.target.value)}
          style={{
            width: "100%", padding: "4px 6px",
            background: "#0f172a", border: "1px solid #334155",
            borderRadius: 4, color: "#e2e8f0", fontSize: 11,
          }}
        >
          <option value="">-- none --</option>
          {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </ParamGroup>
    </div>
  );
}

// ── WebView Panel ────────────────────────────────────────────────────────────

function WebViewParams({ shape, editor }: { shape: WebViewShape; editor: ReturnType<typeof useEditor> }) {
  const { label, url, w, h } = shape.props;

  const updateProp = (key: string, value: unknown) => {
    editor.updateShape({ id: shape.id, type: "web-view", props: { [key]: value } });
  };

  return (
    <div style={{ padding: 12 }}>
      <ParamGroup label="WebView">
        <ParamRow label="Label" value={label} onChange={(v) => updateProp("label", v)} />
        <ParamRow label="URL" value={url} onChange={(v) => updateProp("url", v)} />
      </ParamGroup>
      <ParamGroup label="Size">
        <ParamRow
          label="Width"
          value={String(Math.round(w))}
          onChange={(v) => updateProp("w", Math.max(200, parseInt(v) || 200))}
        />
        <ParamRow
          label="Height"
          value={String(Math.round(h))}
          onChange={(v) => updateProp("h", Math.max(150, parseInt(v) || 150))}
        />
      </ParamGroup>
      <ParamGroup label="Position">
        <ParamRow label="X" value={String(Math.round(shape.x))} readonly />
        <ParamRow label="Y" value={String(Math.round(shape.y))} readonly />
      </ParamGroup>
    </div>
  );
}

// ── Shared UI Components ──────────────────────────────────────────────────────

function ParamGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: "#475569",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function ParamRow({
  label,
  value,
  placeholder,
  readonly,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  readonly?: boolean;
  onChange?: (val: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 4,
      }}
    >
      <span
        style={{ fontSize: 11, color: "#94a3b8", width: 60, flexShrink: 0 }}
      >
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        readOnly={readonly}
        onChange={(e) => onChange?.(e.target.value)}
        style={{
          flex: 1,
          padding: "3px 6px",
          background: readonly ? "transparent" : "#0f172a",
          border: readonly ? "none" : "1px solid #334155",
          borderRadius: 3,
          color: "#e2e8f0",
          fontSize: 11,
          fontFamily: "inherit",
        }}
      />
    </div>
  );
}
