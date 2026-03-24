/**
 * NodeInspector — right-side panel that shows when a node is selected.
 * Reads from Runtime state (NodeDef + NodeState) to render config fields,
 * port listings, status, and action buttons.
 *
 * Replaces the former ParameterPanel.
 */

import { useEditor, useValue } from "tldraw";
import { useRuntime } from "./RuntimeContext";
import { getNodeId } from "./lib/runtime-bridge";
import { C, FONT } from "./theme";
import { useState, useCallback, useRef, useEffect } from "react";
import type { NodeDef, NodeState, PortDef } from "@svg-os/core";

// ── Subsystem colors ────────────────────────────────────────────────────────

const SUBSYSTEM_COLORS: Record<string, string> = {
  system: C.green,
  data: C.blue,
  view: C.accent,
};

// ── Subsystem descriptions (fallback when NodeDef lacks one) ────────────────

const TYPE_DESCRIPTIONS: Record<string, string> = {
  "data:json": "JSON data source",
  "data:table": "Tabular data editor",
  "data:transform": "Data transformer",
  "data:filter": "Filter data rows",
  "data:merge": "Merge multiple inputs",
  "data:fetch": "HTTP data fetcher",
  "data:ai": "AI-powered processor",
  "view:note": "Rich text note",
  "view:svg-template": "SVG template renderer",
  "view:webview": "Embedded web view",
  "view:metric": "Metric display",
  "view:chart": "Chart visualization",
  "sys:terminal": "Terminal emulator",
  "sys:notebook": "Code notebook",
  "sys:env": "Environment variables",
  "sys:disk": "Disk access",
  "sys:network": "Network interface",
  "sys:geolocation": "Geolocation sensor",
  "sys:clipboard-read": "Clipboard reader",
  "sys:clipboard-write": "Clipboard writer",
  "sys:screen-capture": "Screen capture",
  "sys:notify": "System notification",
  "sys:processes": "Process manager",
  "sys:file-open": "File reader",
  "sys:file-write": "File writer",
  "sys:folder": "Folder browser",
};

// ── Node shape types we recognize ───────────────────────────────────────────

const NODE_SHAPE_TYPES = [
  "data-node", "transform-node", "view-node", "table-node",
  "web-view", "terminal-node", "note-node", "notebook-node",
  "ai-node", "compact-node",
] as const;

// ── Main component ──────────────────────────────────────────────────────────

export function NodeInspector() {
  const editor = useEditor();
  const runtime = useRuntime();

  const selected = useValue(
    "selected shape",
    () => {
      const ids = editor.getSelectedShapeIds();
      if (ids.length !== 1) return null;
      const shape = editor.getShape(ids[0]);
      if (!shape) return null;
      return shape;
    },
    [editor],
  );

  // Arrow selected → show EdgeInspector
  if (selected?.type === "arrow") {
    return <EdgeInspector editor={editor} arrowId={selected.id} />;
  }

  const selectedShape = selected;
  if (!selectedShape || !NODE_SHAPE_TYPES.includes(selectedShape.type as (typeof NODE_SHAPE_TYPES)[number])) return null;

  // Resolve runtime node
  const runtimeNodeId = getNodeId(selectedShape.id);
  const nodeState = runtimeNodeId ? runtime?.graph.getNode(runtimeNodeId) : undefined;

  // Determine nodeType from shape
  const props = selectedShape.props as Record<string, unknown>;
  const nodeType =
    (props.nodeType as string) ||
    SHAPE_TO_NODE_TYPE_MAP[selectedShape.type] ||
    selectedShape.type;

  const nodeDef = runtime?.getNodeDef(nodeType);
  const subsystem = nodeDef?.subsystem || (props.subsystem as string) || inferSubsystem(nodeType);
  const color = SUBSYSTEM_COLORS[subsystem] || C.faint;
  const description = TYPE_DESCRIPTIONS[nodeType] || nodeType;

  return (
    <div
      style={{
        position: "absolute",
        right: 0,
        top: 0,
        bottom: 0,
        width: 280,
        background: C.bg,
        borderLeft: `1px solid ${C.border}`,
        overflowY: "auto",
        zIndex: 1000,
        pointerEvents: "all",
        fontFamily: FONT.sans,
        fontSize: 12,
        color: C.fg,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 14px",
          borderBottom: `1px solid ${C.border}`,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: color,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              fontFamily: FONT.mono,
              color: color,
              letterSpacing: "0.03em",
            }}
          >
            {nodeType}
          </span>
        </div>
        <div
          style={{
            fontSize: 10,
            color: C.muted,
            paddingLeft: 16,
          }}
        >
          {description}
        </div>
      </div>

      {/* Config section */}
      {nodeState && (
        <ConfigSection
          nodeState={nodeState}
          runtime={runtime!}
          runtimeNodeId={runtimeNodeId!}
        />
      )}

      {/* Inputs section */}
      {nodeDef && nodeDef.inputs.length > 0 && (
        <PortSection
          title="INPUTS"
          ports={nodeDef.inputs}
          side="input"
          nodeId={runtimeNodeId}
          runtime={runtime}
        />
      )}

      {/* Outputs section */}
      {nodeDef && nodeDef.outputs.length > 0 && (
        <PortSection
          title="OUTPUTS"
          ports={nodeDef.outputs}
          side="output"
          nodeId={runtimeNodeId}
          runtime={runtime}
          outputValues={runtimeNodeId && runtime ? runtime.getAllOutputs(runtimeNodeId) : undefined}
        />
      )}

      {/* Status section */}
      <StatusSection nodeState={nodeState} />

      {/* Actions */}
      <ActionsSection
        runtimeNodeId={runtimeNodeId}
        shapeId={selectedShape.id}
        runtime={runtime}
        editor={editor}
      />
    </div>
  );
}

// ── Config section ──────────────────────────────────────────────────────────

function ConfigSection({
  nodeState,
  runtime,
  runtimeNodeId,
}: {
  nodeState: NodeState;
  runtime: { graph: { updateNode: (id: string, u: any) => void } };
  runtimeNodeId: string;
}) {
  const entries = Object.entries(nodeState.config).filter(
    ([key]) => !key.startsWith("_") && key !== "w" && key !== "h",
  );

  if (entries.length === 0) return null;

  const updateConfig = (key: string, value: unknown) => {
    runtime.graph.updateNode(runtimeNodeId, {
      config: { [key]: value },
    });
  };

  return (
    <div style={{ borderBottom: `1px solid ${C.border}` }}>
      <SectionHeader>CONFIG</SectionHeader>
      <div style={{ padding: "0 14px 12px" }}>
        {entries.map(([key, value]) => (
          <ConfigField
            key={key}
            name={key}
            value={value}
            onChange={(v) => updateConfig(key, v)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Config field renderer ───────────────────────────────────────────────────

function ConfigField({
  name,
  value,
  onChange,
}: {
  name: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const isJsonField = name === "dataJson" || name === "json" || name === "configJson";
  const isBoolean = typeof value === "boolean";
  const isNumber = typeof value === "number";

  if (isBoolean) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: C.muted, width: 70, flexShrink: 0, fontFamily: FONT.mono }}>
          {name}
        </span>
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          onPointerDown={(e) => e.stopPropagation()}
          style={{ accentColor: C.accent }}
        />
      </div>
    );
  }

  if (isJsonField || (typeof value === "string" && value.length > 80)) {
    return (
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 10, color: C.muted, marginBottom: 3, fontFamily: FONT.mono }}>
          {name}
        </div>
        <ConfigTextarea value={String(value ?? "")} onChange={(v) => onChange(v)} />
      </div>
    );
  }

  if (isNumber) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: C.muted, width: 70, flexShrink: 0, fontFamily: FONT.mono }}>
          {name}
        </span>
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          style={{
            flex: 1,
            padding: "3px 6px",
            background: C.bgDeep,
            border: `1px solid ${C.border}`,
            borderRadius: 3,
            color: C.fg,
            fontSize: 11,
            fontFamily: FONT.mono,
            outline: "none",
          }}
        />
      </div>
    );
  }

  // Default: string input
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 10, color: C.muted, width: 70, flexShrink: 0, fontFamily: FONT.mono }}>
        {name}
      </span>
      <input
        type="text"
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        style={{
          flex: 1,
          padding: "3px 6px",
          background: C.bgDeep,
          border: `1px solid ${C.border}`,
          borderRadius: 3,
          color: C.fg,
          fontSize: 11,
          fontFamily: FONT.sans,
          outline: "none",
        }}
      />
    </div>
  );
}

// ── Textarea with pointer capture ───────────────────────────────────────────

function ConfigTextarea({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Sync external changes
  useEffect(() => {
    setLocal(value);
  }, [value]);

  const ref = useCallback((el: HTMLTextAreaElement | null) => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    if (!el) return;
    const handler = (e: PointerEvent) => { e.stopPropagation(); e.stopImmediatePropagation(); };
    el.addEventListener("pointerdown", handler, { capture: true });
    cleanupRef.current = () => el.removeEventListener("pointerdown", handler, { capture: true });
  }, []);

  return (
    <textarea
      ref={ref}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onChange(local)}
      onKeyDown={(e) => e.stopPropagation()}
      style={{
        width: "100%",
        minHeight: 80,
        padding: "6px 8px",
        background: C.bgDeep,
        border: `1px solid ${C.border}`,
        borderRadius: 4,
        color: C.fg,
        fontSize: 10,
        fontFamily: FONT.mono,
        resize: "vertical",
        lineHeight: 1.5,
        outline: "none",
      }}
    />
  );
}

// ── Port section ────────────────────────────────────────────────────────────

const PORT_TYPE_COLORS: Record<string, string> = {
  data: C.green,
  text: C.accent,
  number: C.blue,
  array: C.cyan,
  image: C.pink,
  boolean: C.yellow,
  stream: C.purple,
  any: C.faint,
  void: C.dim,
};

function PortSection({
  title,
  ports,
  side,
  nodeId,
  runtime,
  outputValues,
}: {
  title: string;
  ports: PortDef[];
  side: "input" | "output";
  nodeId: string | undefined;
  runtime: any;
  outputValues?: Record<string, unknown>;
}) {
  // Check connections
  const edges = nodeId && runtime ? runtime.graph.getEdges() : [];

  return (
    <div style={{ borderBottom: `1px solid ${C.border}` }}>
      <SectionHeader>{title}</SectionHeader>
      <div style={{ padding: "0 14px 12px" }}>
        {ports.map((port) => {
          const connected = edges.some((e: any) =>
            side === "input"
              ? e.to.node === nodeId && e.to.port === port.name
              : e.from.node === nodeId && e.from.port === port.name,
          );
          const color = PORT_TYPE_COLORS[port.type] || C.faint;
          const outputVal = side === "output" && outputValues ? outputValues[port.name] : undefined;
          const hasValue = outputVal !== undefined;

          return (
            <div key={port.name} style={{ marginBottom: 4 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: connected ? color : "transparent",
                    border: `1.5px solid ${color}`,
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: C.fgSoft, fontFamily: FONT.mono, fontSize: 10 }}>
                  {port.name}
                </span>
                <span style={{ color: C.faint, fontSize: 9, fontFamily: FONT.mono }}>
                  ({port.type})
                </span>
                {connected && (
                  <span style={{ marginLeft: "auto", fontSize: 9, color: C.green }}>
                    connected
                  </span>
                )}
                {!connected && hasValue && (
                  <span style={{ marginLeft: "auto", fontSize: 9, color: C.accent }}>
                    has data
                  </span>
                )}
              </div>
              {hasValue && (
                <div style={{
                  marginTop: 2,
                  marginLeft: 12,
                  padding: "3px 6px",
                  background: C.bgDeep,
                  borderRadius: 3,
                  fontSize: 10,
                  fontFamily: FONT.mono,
                  color: C.fgSoft,
                  maxHeight: 80,
                  overflow: "auto",
                  wordBreak: "break-all",
                  whiteSpace: "pre-wrap",
                }}>
                  {formatOutputValue(outputVal)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatOutputValue(val: unknown): string {
  if (val === undefined) return "undefined";
  if (val === null) return "null";
  if (typeof val === "string") {
    return val.length > 200 ? val.slice(0, 200) + "..." : val;
  }
  try {
    const json = JSON.stringify(val, null, 2);
    return json.length > 300 ? json.slice(0, 300) + "..." : json;
  } catch {
    return String(val);
  }
}

// ── Status section ──────────────────────────────────────────────────────────

function StatusSection({ nodeState }: { nodeState: NodeState | undefined }) {
  const status = nodeState?.status ?? "idle";
  const error = nodeState?.error;

  const statusColor =
    status === "done" ? C.green :
    status === "running" ? C.accent :
    status === "error" ? C.red :
    C.dim;

  return (
    <div style={{ borderBottom: `1px solid ${C.border}` }}>
      <SectionHeader>STATUS</SectionHeader>
      <div style={{ padding: "0 14px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: statusColor,
              flexShrink: 0,
            }}
          />
          <span style={{ color: C.fgSoft }}>{status}</span>
        </div>
        {error && (
          <div
            style={{
              marginTop: 6,
              padding: "4px 8px",
              background: `${C.red}11`,
              border: `1px solid ${C.red}33`,
              borderRadius: 4,
              fontSize: 10,
              fontFamily: FONT.mono,
              color: C.red,
              wordBreak: "break-word",
            }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Actions section ─────────────────────────────────────────────────────────

function ActionsSection({
  runtimeNodeId,
  shapeId,
  runtime,
  editor,
}: {
  runtimeNodeId: string | undefined;
  shapeId: string;
  runtime: any;
  editor: any;
}) {
  const [running, setRunning] = useState(false);

  const handleRun = async () => {
    if (!runtime || !runtimeNodeId) return;
    setRunning(true);
    try {
      await runtime.runNode(runtimeNodeId);
    } catch (e) {
      console.error("[inspector] run failed:", e);
    } finally {
      setRunning(false);
    }
  };

  const handleDelete = () => {
    editor.deleteShape(shapeId as any);
  };

  return (
    <div style={{ padding: "12px 14px", display: "flex", gap: 8 }}>
      <button
        onClick={handleRun}
        onPointerDown={(e) => e.stopPropagation()}
        disabled={running || !runtimeNodeId}
        style={{
          flex: 1,
          padding: "6px 12px",
          background: running ? `${C.green}22` : C.bgAlt,
          border: `1px solid ${C.green}55`,
          borderRadius: 6,
          color: C.green,
          fontSize: 11,
          fontWeight: 500,
          fontFamily: FONT.sans,
          cursor: runtimeNodeId ? "pointer" : "not-allowed",
          opacity: runtimeNodeId ? 1 : 0.4,
          letterSpacing: "0.02em",
        }}
      >
        {running ? "Running..." : "Run"}
      </button>
      <button
        onClick={handleDelete}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          flex: 1,
          padding: "6px 12px",
          background: C.bgAlt,
          border: `1px solid ${C.red}44`,
          borderRadius: 6,
          color: C.red,
          fontSize: 11,
          fontWeight: 500,
          fontFamily: FONT.sans,
          cursor: "pointer",
          letterSpacing: "0.02em",
        }}
      >
        Delete
      </button>
    </div>
  );
}

// ── Shared ──────────────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "8px 14px 4px",
        fontSize: 9,
        fontWeight: 600,
        color: C.faint,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        fontFamily: FONT.sans,
      }}
    >
      {children}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const SHAPE_TO_NODE_TYPE_MAP: Record<string, string> = {
  "data-node": "data:json",
  "table-node": "data:table",
  "transform-node": "data:transform",
  "note-node": "view:note",
  "view-node": "view:svg-template",
  "web-view": "view:webview",
  "terminal-node": "sys:terminal",
  "notebook-node": "sys:notebook",
  "ai-node": "data:ai",
};

function inferSubsystem(nodeType: string): string {
  if (nodeType.startsWith("sys:")) return "system";
  if (nodeType.startsWith("data:")) return "data";
  if (nodeType.startsWith("view:")) return "view";
  return "system";
}

// ── Edge Inspector ───────────────────────────────────────────────────────────
// Shows when an arrow is selected. Displays source→target info and available
// data fields with toggles to filter what passes through.

function EdgeInspector({ editor, arrowId }: { editor: any; arrowId: string }) {
  const runtime = useRuntime();
  const bindings = editor.getBindingsFromShape(arrowId, "arrow");
  const startBinding = bindings.find((b: any) => b.props?.terminal === "start");
  const endBinding = bindings.find((b: any) => b.props?.terminal === "end");

  const sourceShape = startBinding ? editor.getShape(startBinding.toId) : null;
  const targetShape = endBinding ? editor.getShape(endBinding.toId) : null;

  const sourceName = sourceShape
    ? (sourceShape.props as any).label || sourceShape.type
    : "?";
  const targetName = targetShape
    ? (targetShape.props as any).label || targetShape.type
    : "?";

  // Get the data currently flowing through this edge from the runtime scheduler
  const sourceNodeId = sourceShape ? getNodeId(sourceShape.id) : undefined;
  const sourceOutputs = sourceNodeId && runtime ? runtime.getAllOutputs(sourceNodeId) : null;

  // Flatten: if there's a single "out" key that is an object, show its fields
  let fields: [string, unknown][] = [];
  if (sourceOutputs) {
    const keys = Object.keys(sourceOutputs);
    if (keys.length === 1 && keys[0] === "out" && typeof sourceOutputs.out === "object" && sourceOutputs.out !== null && !Array.isArray(sourceOutputs.out)) {
      fields = Object.entries(sourceOutputs.out as Record<string, unknown>).filter(([k]) => !k.startsWith("_"));
    } else {
      fields = Object.entries(sourceOutputs).filter(([k]) => !k.startsWith("_"));
    }
  }

  return (
    <div style={{
      position: "absolute", right: 0, top: 0, bottom: 0, width: 280,
      background: C.bg, borderLeft: `1px solid ${C.border}`,
      overflowY: "auto", zIndex: 1000, pointerEvents: "all",
      fontFamily: FONT.sans, fontSize: 12, color: C.fg,
    }}>
      {/* Header */}
      <div style={{
        padding: "14px 16px", borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{
          fontFamily: FONT.mono, fontSize: 9, color: C.faint,
          textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4,
        }}>
          Connection
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <span style={{ color: C.green }}>{sourceName}</span>
          <span style={{ color: C.faint }}>{"\u2192"}</span>
          <span style={{ color: C.accent }}>{targetName}</span>
        </div>
      </div>

      {/* Data flowing */}
      <div style={{ padding: "12px 16px" }}>
        <div style={{
          fontFamily: FONT.mono, fontSize: 9, color: C.faint,
          textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8,
        }}>
          Data Flowing ({fields.length} fields)
        </div>

        {fields.length === 0 && (
          <div style={{ color: C.dim, fontSize: 11, fontStyle: "italic" }}>
            No data yet — run the source node first
          </div>
        )}

        {fields.map(([key, val]) => (
          <div key={key} style={{
            padding: "6px 8px", marginBottom: 2,
            borderRadius: 4, background: C.bgCard,
            display: "flex", alignItems: "flex-start", gap: 8,
          }}>
            <span style={{
              fontFamily: FONT.mono, fontSize: 11, color: C.accent,
              minWidth: 60, flexShrink: 0,
            }}>
              {key}
            </span>
            <span style={{
              fontSize: 11, color: C.fgSoft,
              overflow: "hidden", textOverflow: "ellipsis",
              whiteSpace: "nowrap", flex: 1,
            }}>
              {typeof val === "object" ? JSON.stringify(val) : String(val)}
            </span>
          </div>
        ))}
      </div>

      {/* Tip */}
      <div style={{
        padding: "12px 16px", borderTop: `1px solid ${C.borderSoft}`,
        fontSize: 10, color: C.dim, lineHeight: 1.5,
      }}>
        All fields pass through by default. Use a Transform node between to filter or reshape data.
      </div>
    </div>
  );
}
