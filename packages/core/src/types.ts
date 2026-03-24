// Identity
export type NodeId = string;
export type PortId = string;
export type EdgeId = string;
export type SubsystemId = string;

// Data types for ports
export type DataType =
  | "any" | "data" | "text" | "number" | "boolean"
  | "array" | "image" | "stream" | "void";

// Port definition
export interface PortDef {
  name: string;
  type: DataType;
  multiple?: boolean;
  optional?: boolean;
}

// Trigger mode: when does a node execute?
export type TriggerMode = "auto" | "manual" | "once";

// Node definition (registered by subsystems)
export interface NodeDef {
  type: string;
  subsystem: SubsystemId;
  inputs: PortDef[];
  outputs: PortDef[];
  execute: ExecuteFn;
  trigger?: TriggerMode;
  description?: string;
  icon?: string;
  lifecycle?: NodeLifecycle;
  schema?: Record<string, unknown>;
  capabilities?: Capability[];
  execution?: ExecutionPolicy;
}

export interface NodeLifecycle {
  prepare?: (nodeId: NodeId) => void | Promise<void>;
  teardown?: (nodeId: NodeId) => void;
}

// Node state (runtime instance)
export interface NodeState {
  id: NodeId;
  type: string;
  config: Record<string, unknown>;
  data: Record<string, unknown>;
  status: "idle" | "running" | "done" | "error";
  error?: string;
  meta: {
    created: number;
    lastRun: number;
    runCount: number;
    position?: { x: number; y: number };
    size?: { w: number; h: number };
  };
}

// Edge
export interface Edge {
  id: EdgeId;
  from: { node: NodeId; port: string };
  to: { node: NodeId; port: string };
}

// Events
export type EventType =
  | "node:created" | "node:removed" | "node:updated"
  | "edge:created" | "edge:removed"
  | "port:connected" | "port:disconnected"
  | "exec:start" | "exec:complete" | "exec:error"
  | "exec:node-start" | "exec:node-complete"
  | "exec:plan-invalidated" | "exec:cycle"
  | "state:changed"
  | "subsystem:registered" | "subsystem:ready";

export interface CoreEvent<T = unknown> {
  type: EventType;
  source: NodeId | SubsystemId | "core";
  timestamp: number;
  payload: T;
}

// Execution context — pre-bound to a node, no nodeId needed
export interface ExecContext {
  getInput(portName: string): unknown;
  setOutput(portName: string, value: unknown): void;
  getConfig(): Record<string, unknown>;
  emit(event: CoreEvent): void;
  /** Node ID this context is bound to (for execute functions that need it) */
  readonly nodeId: NodeId;
}

export type ExecuteFn = (ctx: ExecContext) => Promise<void> | void;

// Execution plan
export interface ExecutionPlan {
  order: NodeId[];
  levels: NodeId[][];
  cycleNodes: NodeId[];
  hasCycle: boolean;
}

export interface ExecutionPolicy {
  mode?: "sync" | "async" | "exclusive";
  concurrencyKey?: string;
  cache?: "none" | "inputs";
}

// Code execution result (canonical type, used by subsystems and canvas)
export type Lang = "js" | "python" | "ruby" | "c" | "cpp" | "sql" | "php";

export interface ExecResult {
  output: string[];
  result: unknown;
  error: string | null;
}

// Persistence
export interface GraphSnapshot {
  nodes: Array<{
    id: NodeId;
    type: string;
    config: Record<string, unknown>;
    meta: NodeState["meta"];
  }>;
  edges: Edge[];
  subsystems: SubsystemId[];
  version: number;
}

// Capabilities
export interface Capability {
  subsystem: SubsystemId;
  action: "read" | "write" | "execute" | "network" | "fs";
  scope?: string;
}

// Logging
export interface LogEntry {
  timestamp: number;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  nodeId?: NodeId;
}
