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
}

/** Connector info returned from getConnectors. */
export interface ConnectorInfo {
  path_node: NodeId;
  from: [NodeId, string];
  to: [NodeId, string];
  routing: ConnectorRouting;
  label: NodeId | null;
}
