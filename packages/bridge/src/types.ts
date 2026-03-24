/** Unique node identifier (UUID string). */
export type NodeId = string;

/** SVG element tag names. */
export type SvgTagName =
  | "svg" | "g" | "defs" | "symbol" | "use"
  | "rect" | "circle" | "ellipse" | "line" | "polyline" | "polygon" | "path"
  | "text" | "tspan" | "image" | "foreignObject"
  | "linearGradient" | "radialGradient" | "stop" | "pattern"
  | "clipPath" | "mask"
  | "filter" | "feGaussianBlur" | "feColorMatrix" | "feComposite"
  | "feFlood" | "feMerge" | "feMergeNode" | "feOffset" | "feBlend";

/** SVG DOM mutation operation emitted by the Rust diff engine. */
export type SvgDomOp =
  | { op: "CreateElement"; id: string; tag: string; parent: string; index: number }
  | { op: "RemoveElement"; id: string }
  | { op: "SetAttribute"; id: string; key: string; value: string }
  | { op: "RemoveAttribute"; id: string; key: string }
  | { op: "ReorderChildren"; parent: string; order: string[] }
  | { op: "SetTextContent"; id: string; text: string };

/** Node attribute map (key → value as string). */
export type AttrMap = Record<string, string>;

/** Effect types matching the Rust Effect enum. */
export type Effect =
  | { GaussianBlur: { std_dev: number } }
  | { DropShadow: { dx: number; dy: number; blur: number; color: { r: number; g: number; b: number; a: number } } }
  | { ColorMatrix: { matrix: number[] } }
  | { PathOffset: { distance: number } }
  | { Transform: { matrix: number[] } }
  | { Custom: { name: string; params: unknown } };

/** Constraint types matching the Rust Constraint enum. */
export type Constraint =
  | { Pin: { node: NodeId; to: NodeId; anchor: string; target_anchor: string; offset: [number, number] } }
  | { Distribute: { group: NodeId; axis: string; gap: number } }
  | { AlignTo: { node: NodeId; target: NodeId; axis: string; alignment: string } }
  | { AspectLock: { node: NodeId; ratio: [number, number] } }
  | { RepeatGrid: { template: NodeId; count: number; columns: number; gap: [number, number] } }
  | { AutoResize: { node: NodeId; axis: string; min: number; max: number; padding: number } };

/** Data flow through a connector. */
export type DataFlow =
  | "None"
  | "PassThrough"
  | { Field: string }
  | { Expression: string };

/** Data binding definition. */
export interface Binding {
  source: { Static: { value: unknown } } | { Json: { url: string; refresh_secs?: number } } | { Csv: { url: string } };
  target: NodeId;
  mappings: Array<{ field: string; attr: string; transform?: string }>;
  fallback?: unknown;
}

/** Theme definition. */
export interface Theme {
  name: string;
  colors: Record<string, string>;
  fonts: Record<string, string>;
  spacing: Record<string, number>;
}

/** Port direction for connector routing. */
export type PortDirection = "Up" | "Down" | "Left" | "Right";

/** A port (anchor point) on a diagram node. */
export interface Port {
  name: string;
  position: [number, number];
  direction: PortDirection;
}

/** Connector routing style. */
export type ConnectorRouting = "Straight" | "Orthogonal";

/** Connector definition for creating a connection between two ports. */
export interface ConnectorDef {
  from: [NodeId, string]; // [nodeId, portName]
  to: [NodeId, string];
  routing: ConnectorRouting;
  dataFlow?: DataFlow;
}

/** Connector info returned from getConnectors. */
export interface ConnectorInfo {
  path_node: NodeId;
  from: [NodeId, string];
  to: [NodeId, string];
  routing: ConnectorRouting;
  label: NodeId | null;
}

// ── AI Context types ──────────────────────────────────────────────────────────

/** Semantic role of a node in the graph. */
export type NodeRole = "Element" | "Source" | "View" | "Transform" | "Container";

/** Bindable slot on a node type. */
export interface SlotDef {
  field: string;
  bind_type: string;
  target_attr: string;
  default_value?: string;
}

/** Compact semantic map of the entire document graph. */
export interface GraphManifest {
  nodes: ManifestNode[];
  edges: ManifestEdge[];
  summary: GraphSummary;
  /** Viewport state (populated by editor, null from raw WASM). */
  viewport?: ViewportInfo;
}

/** Lightweight node entry in the manifest. */
export interface ManifestNode {
  id: NodeId;
  name: string | null;
  role: NodeRole;
  node_type_id: string | null;
  category: string | null;
  slots: SlotDef[];
  output_fields: string[];
  has_data: boolean;
  position: [number, number];
}

/** Edge entry in the manifest. */
export interface ManifestEdge {
  from_node: NodeId;
  from_port: string;
  to_node: NodeId;
  to_port: string;
  data_flow: DataFlow;
  connector_id: NodeId;
}

/** Summary counts for the graph. */
export interface GraphSummary {
  total_nodes: number;
  source_count: number;
  view_count: number;
  transform_count: number;
  container_count: number;
  element_count: number;
  edge_count: number;
  data_flow_edge_count: number;
}

/** Focused context for a single node. */
export interface NodeContext {
  id: NodeId;
  name: string | null;
  role: NodeRole;
  node_type_id: string | null;
  input_slots: SlotDef[];
  output_shape: unknown | null;
  incoming: ConnectionInfoDetail[];
  outgoing: ConnectionInfoDetail[];
  current_data: unknown | null;
  depth: number;
  upstream_count: number;
  downstream_count: number;
}

/** Info about a connection to/from a node. */
export interface ConnectionInfoDetail {
  node_id: NodeId;
  node_name: string | null;
  port: string;
  data_flow: DataFlow;
}

/** AI-computed suggestion for connecting two nodes. */
export interface ConnectionSuggestion {
  source_output: unknown | null;
  target_slots: SlotDef[];
  suggested_mappings: SuggestedMapping[];
  suggested_data_flow: DataFlow;
}

/** A single field-to-slot mapping suggestion. */
export interface SuggestedMapping {
  source_field: string;
  target_slot: string;
  confidence: number;
  reason: string;
}

/** Viewport state — where the user is looking on the canvas. */
export interface ViewportInfo {
  /** Pan offset in screen pixels. */
  panX: number;
  panY: number;
  /** Zoom level (1.0 = 100%). */
  zoom: number;
  /** Visible area in document coordinates. */
  viewBox: { x: number; y: number; width: number; height: number };
  /** Screen/canvas size in pixels. */
  canvasWidth: number;
  canvasHeight: number;
}

/** AI transform configuration for a DataSource. */
export interface AiTransformConfig {
  prompt_template: string;
  model?: string;
  max_tokens?: number;
  output_schema?: unknown;
}

/** A pending AI evaluation that needs external resolution. */
export interface PendingAiEval {
  node_id: string;
  input_data: unknown;
  prompt_template: string;
  model?: string;
  max_tokens?: number;
  output_schema?: unknown;
}
