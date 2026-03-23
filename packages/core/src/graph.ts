import type { NodeId, EdgeId, Edge, NodeState, NodeDef, GraphSnapshot, CoreEvent } from "./types";
import type { EventBus } from "./event-bus";

export class Graph {
  private nodes = new Map<NodeId, NodeState>();
  private edges = new Map<EdgeId, Edge>();
  private nodeDefs = new Map<string, NodeDef>();
  private undoStack: GraphSnapshot[] = [];
  private redoStack: GraphSnapshot[] = [];
  private batching = false;

  constructor(private events: EventBus) {}

  // ── Node type registry ──────────────────────────────────────────────

  registerNodeDef(def: NodeDef): void {
    this.nodeDefs.set(def.type, def);
  }

  getNodeDef(type: string): NodeDef | undefined {
    return this.nodeDefs.get(type);
  }

  listNodeDefs(): NodeDef[] {
    return [...this.nodeDefs.values()];
  }

  // ── Nodes ───────────────────────────────────────────────────────────

  addNode(type: string, config?: Record<string, unknown>): NodeId {
    const def = this.nodeDefs.get(type);
    if (!def) throw new Error(`Unknown node type: ${type}`);

    const id = crypto.randomUUID();
    const now = Date.now();

    const state: NodeState = {
      id,
      type,
      config: config || {},
      data: {},
      status: "idle",
      meta: { created: now, lastRun: 0, runCount: 0 },
    };

    if (!this.batching) this.pushUndo();
    this.nodes.set(id, state);
    this.events.emit({
      type: "node:created",
      source: "core",
      timestamp: now,
      payload: { id, nodeType: type },
    });

    return id;
  }

  removeNode(id: NodeId): void {
    if (!this.nodes.has(id)) return;
    if (!this.batching) this.pushUndo();

    // Remove connected edges
    for (const [edgeId, edge] of this.edges) {
      if (edge.from.node === id || edge.to.node === id) {
        this.edges.delete(edgeId);
        this.events.emit({
          type: "edge:removed",
          source: "core",
          timestamp: Date.now(),
          payload: { id: edgeId },
        });
      }
    }

    this.nodes.delete(id);
    this.events.emit({
      type: "node:removed",
      source: "core",
      timestamp: Date.now(),
      payload: { id },
    });
  }

  getNode(id: NodeId): NodeState | undefined {
    return this.nodes.get(id);
  }

  getNodes(): NodeState[] {
    return [...this.nodes.values()];
  }

  updateNode(id: NodeId, updates: Partial<Pick<NodeState, "config" | "data" | "status" | "error">> & { meta?: Partial<NodeState["meta"]> }): void {
    const node = this.nodes.get(id);
    if (!node) return;

    if (updates.config) node.config = { ...node.config, ...updates.config };
    if (updates.data) node.data = { ...node.data, ...updates.data };
    if (updates.status !== undefined) node.status = updates.status;
    if (updates.error !== undefined) node.error = updates.error;
    if (updates.meta) node.meta = { ...node.meta, ...updates.meta };

    this.events.emit({
      type: "node:updated",
      source: id,
      timestamp: Date.now(),
      payload: { id, updates },
    });
  }

  // ── Edges ───────────────────────────────────────────────────────────

  addEdge(from: { node: NodeId; port: string }, to: { node: NodeId; port: string }): EdgeId {
    // Validate nodes exist
    const fromNode = this.nodes.get(from.node);
    const toNode = this.nodes.get(to.node);
    if (!fromNode || !toNode) throw new Error("Source or target node not found");

    // Validate ports exist
    const fromDef = this.nodeDefs.get(fromNode.type);
    const toDef = this.nodeDefs.get(toNode.type);
    if (!fromDef || !toDef) throw new Error("Node type definition not found");

    const sourcePort = fromDef.outputs.find(p => p.name === from.port);
    const targetPort = toDef.inputs.find(p => p.name === to.port);
    if (!sourcePort) throw new Error(`Output port "${from.port}" not found on ${fromNode.type}`);
    if (!targetPort) throw new Error(`Input port "${to.port}" not found on ${toNode.type}`);

    // Validate type compatibility
    if (!isTypeCompatible(sourcePort.type, targetPort.type)) {
      throw new Error(`Type mismatch: ${sourcePort.type} → ${targetPort.type}`);
    }

    // Check for duplicate
    for (const edge of this.edges.values()) {
      if (edge.from.node === from.node && edge.from.port === from.port &&
          edge.to.node === to.node && edge.to.port === to.port) {
        throw new Error("Edge already exists");
      }
    }

    if (!this.batching) this.pushUndo();

    const id = crypto.randomUUID();
    const edge: Edge = { id, from, to };
    this.edges.set(id, edge);

    this.events.emit({
      type: "edge:created",
      source: "core",
      timestamp: Date.now(),
      payload: { id, from, to },
    });

    return id;
  }

  removeEdge(id: EdgeId): void {
    if (!this.edges.has(id)) return;
    if (!this.batching) this.pushUndo();
    this.edges.delete(id);
    this.events.emit({
      type: "edge:removed",
      source: "core",
      timestamp: Date.now(),
      payload: { id },
    });
  }

  getEdges(): Edge[] {
    return [...this.edges.values()];
  }

  getEdgesFrom(nodeId: NodeId, port?: string): Edge[] {
    return this.getEdges().filter(e =>
      e.from.node === nodeId && (port === undefined || e.from.port === port)
    );
  }

  getEdgesTo(nodeId: NodeId, port?: string): Edge[] {
    return this.getEdges().filter(e =>
      e.to.node === nodeId && (port === undefined || e.to.port === port)
    );
  }

  // ── Query ───────────────────────────────────────────────────────────

  getUpstream(nodeId: NodeId): NodeId[] {
    return this.getEdgesTo(nodeId).map(e => e.from.node);
  }

  getDownstream(nodeId: NodeId): NodeId[] {
    return this.getEdgesFrom(nodeId).map(e => e.to.node);
  }

  topologicalSort(): NodeId[] {
    const nodeIds = [...this.nodes.keys()];
    const inDegree = new Map<NodeId, number>();
    const adj = new Map<NodeId, NodeId[]>();

    for (const id of nodeIds) {
      inDegree.set(id, 0);
      adj.set(id, []);
    }

    for (const edge of this.edges.values()) {
      adj.get(edge.from.node)?.push(edge.to.node);
      inDegree.set(edge.to.node, (inDegree.get(edge.to.node) || 0) + 1);
    }

    // Kahn's algorithm
    const queue: NodeId[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const sorted: NodeId[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      sorted.push(id);
      for (const next of adj.get(id) || []) {
        const newDeg = (inDegree.get(next) || 1) - 1;
        inDegree.set(next, newDeg);
        if (newDeg === 0) queue.push(next);
      }
    }

    return sorted;
  }

  // ── Undo/Redo ───────────────────────────────────────────────────────

  private pushUndo(): void {
    this.undoStack.push(this.serialize());
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): void {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return;
    this.redoStack.push(this.serialize());
    this.deserialize(snapshot);
  }

  redo(): void {
    const snapshot = this.redoStack.pop();
    if (!snapshot) return;
    this.undoStack.push(this.serialize());
    this.deserialize(snapshot);
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  batch(fn: () => void): void {
    this.pushUndo();
    this.batching = true;
    try { fn(); } finally { this.batching = false; }
  }

  // ── Persistence ─────────────────────────────────────────────────────

  serialize(): GraphSnapshot {
    return {
      nodes: this.getNodes().map(n => ({
        id: n.id,
        type: n.type,
        config: { ...n.config },
        meta: { ...n.meta },
      })),
      edges: this.getEdges().map(e => ({ ...e })),
      subsystems: [],
      version: 1,
    };
  }

  deserialize(snapshot: GraphSnapshot): void {
    this.nodes.clear();
    this.edges.clear();

    for (const n of snapshot.nodes) {
      this.nodes.set(n.id, {
        id: n.id,
        type: n.type,
        config: n.config,
        data: {},
        status: "idle",
        meta: n.meta,
      });
    }

    for (const e of snapshot.edges) {
      this.edges.set(e.id, e);
    }
  }
}

// ── Type compatibility ────────────────────────────────────────────────────────

const COMPATIBLE: Record<string, Set<string>> = {
  any:     new Set(["any", "data", "text", "number", "boolean", "array", "image", "stream", "void"]),
  data:    new Set(["any", "data", "array"]),
  text:    new Set(["any", "text", "number", "boolean"]),
  number:  new Set(["any", "number", "boolean"]),
  boolean: new Set(["any", "number", "boolean"]),
  array:   new Set(["any", "array"]),
  image:   new Set(["any", "image"]),
  stream:  new Set(["any", "stream"]),
  void:    new Set(["any", "void"]),
};

export function isTypeCompatible(from: string, to: string): boolean {
  if (to === "any") return true;
  return COMPATIBLE[from]?.has(to) ?? false;
}
