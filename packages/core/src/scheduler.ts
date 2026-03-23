import type { NodeId, ExecutionPlan, ExecContext, CoreEvent, NodeDef } from "./types";
import type { Graph } from "./graph";
import type { EventBus } from "./event-bus";

export class Scheduler {
  private outputCache = new Map<string, unknown>(); // "nodeId:portName" -> value
  private running = false;
  private cancelled = false;

  constructor(
    private graph: Graph,
    private events: EventBus,
  ) {}

  plan(): ExecutionPlan {
    const order = this.graph.topologicalSort();

    // Group into parallelizable levels
    const levels: NodeId[][] = [];
    const nodeLevel = new Map<NodeId, number>();

    for (const id of order) {
      const upstream = this.graph.getUpstream(id);
      let level = 0;
      for (const upId of upstream) {
        level = Math.max(level, (nodeLevel.get(upId) || 0) + 1);
      }
      nodeLevel.set(id, level);

      while (levels.length <= level) levels.push([]);
      levels[level].push(id);
    }

    return { order, levels };
  }

  async execute(plan?: ExecutionPlan): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.cancelled = false;
    this.outputCache.clear();

    const executionPlan = plan || this.plan();

    this.events.emit({
      type: "exec:start",
      source: "core",
      timestamp: Date.now(),
      payload: { nodeCount: executionPlan.order.length },
    });

    try {
      for (const nodeId of executionPlan.order) {
        if (this.cancelled) break;

        const node = this.graph.getNode(nodeId);
        if (!node) continue;

        const def = this.graph.getNodeDef(node.type);
        if (!def) continue;

        // Build execution context for this node
        const ctx = this.buildContext(nodeId, def);

        // Update status
        this.graph.updateNode(nodeId, { status: "running" });

        try {
          await def.execute(ctx, nodeId);

          this.graph.updateNode(nodeId, {
            status: "done",
            error: undefined,
            meta: {
              lastRun: Date.now(),
              runCount: (node.meta.runCount || 0) + 1,
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.graph.updateNode(nodeId, {
            status: "error",
            error: message,
          });

          this.events.emit({
            type: "exec:error",
            source: nodeId,
            timestamp: Date.now(),
            payload: { nodeId, error: message },
          });
        }
      }

      this.events.emit({
        type: "exec:complete",
        source: "core",
        timestamp: Date.now(),
        payload: { cancelled: this.cancelled },
      });
    } finally {
      this.running = false;
    }
  }

  async executeNode(nodeId: NodeId): Promise<void> {
    // Execute single node + all downstream
    const allOrder = this.graph.topologicalSort();
    const idx = allOrder.indexOf(nodeId);
    if (idx === -1) return;

    // Get this node and all nodes after it that are downstream
    const downstream = new Set<NodeId>();
    downstream.add(nodeId);

    for (let i = idx + 1; i < allOrder.length; i++) {
      const upstream = this.graph.getUpstream(allOrder[i]);
      if (upstream.some(u => downstream.has(u))) {
        downstream.add(allOrder[i]);
      }
    }

    const subPlan: ExecutionPlan = {
      order: allOrder.filter(id => downstream.has(id)),
      levels: [],
    };

    await this.execute(subPlan);
  }

  cancel(): void {
    this.cancelled = true;
  }

  isRunning(): boolean {
    return this.running;
  }

  getOutput(nodeId: NodeId, portName: string): unknown {
    return this.outputCache.get(`${nodeId}:${portName}`);
  }

  private buildContext(nodeId: NodeId, _def: NodeDef): ExecContext {
    return {
      getInput: (_nid: NodeId, portName: string) => {
        // Find edges that connect to this node's port
        const edges = this.graph.getEdgesTo(nodeId, portName);
        if (edges.length === 0) return undefined;
        if (edges.length === 1) {
          return this.outputCache.get(`${edges[0].from.node}:${edges[0].from.port}`);
        }
        // Multiple inputs: collect as array
        return edges.map(e =>
          this.outputCache.get(`${e.from.node}:${e.from.port}`)
        );
      },

      setOutput: (_nid: NodeId, portName: string, value: unknown) => {
        this.outputCache.set(`${nodeId}:${portName}`, value);
        // Also store in node state
        this.graph.updateNode(nodeId, {
          data: { [portName]: value },
        });
      },

      getConfig: (_nid: NodeId) => {
        return this.graph.getNode(nodeId)?.config || {};
      },

      emit: (event: CoreEvent) => {
        this.events.emit(event);
      },
    };
  }
}
