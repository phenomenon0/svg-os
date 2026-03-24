import type { NodeId, ExecutionPlan, ExecContext, CoreEvent, NodeDef } from "./types";
import type { Graph } from "./graph";
import type { EventBus } from "./event-bus";

export class Scheduler {
  private outputCache = new Map<string, unknown>(); // "nodeId:portName" -> value
  private running = false;
  private cancelled = false;
  private rerunRequested = false;
  private autoTriggerTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly concurrencyLimit = getDefaultConcurrency();

  constructor(
    private graph: Graph,
    private events: EventBus,
  ) {}

  /** Wire up auto-trigger: listen for graph changes, auto-run trigger:"auto" nodes */
  enableAutoTrigger(): void {
    const scheduleAuto = () => {
      if (this.autoTriggerTimer) clearTimeout(this.autoTriggerTimer);
      this.autoTriggerTimer = setTimeout(() => {
        this.executeAutoNodes().catch(() => {});
      }, 16); // ~1 frame debounce
    };

    this.events.on("node:updated", scheduleAuto);
    this.events.on("edge:created", scheduleAuto);
    this.events.on("edge:removed", scheduleAuto);
  }

  /** Execute only nodes with trigger:"auto" (or no trigger, defaulting to auto) */
  async executeAutoNodes(): Promise<void> {
    const fullPlan = this.plan();
    const autoNodeIds = new Set<NodeId>();

    for (const nodeId of fullPlan.order) {
      const node = this.graph.getNode(nodeId);
      if (!node) continue;
      const def = this.graph.getNodeDef(node.type);
      if (!def) continue;
      const trigger = def.trigger || "auto";
      if (trigger === "auto") {
        autoNodeIds.add(nodeId);
      }
    }

    if (autoNodeIds.size === 0) return;

    const subPlan: ExecutionPlan = {
      order: fullPlan.order.filter((id: NodeId) => autoNodeIds.has(id)),
      levels: fullPlan.levels
        .map((level: NodeId[]) => level.filter((id: NodeId) => autoNodeIds.has(id)))
        .filter((level: NodeId[]) => level.length > 0),
      cycleNodes: fullPlan.cycleNodes.filter((id: NodeId) => autoNodeIds.has(id)),
      hasCycle: fullPlan.cycleNodes.some((id: NodeId) => autoNodeIds.has(id)),
    };

    await this.execute(subPlan);
  }

  plan(): ExecutionPlan {
    return this.graph.planExecution();
  }

  async execute(plan?: ExecutionPlan): Promise<void> {
    if (this.running) {
      this.rerunRequested = true;
      this.events.emit({
        type: "exec:plan-invalidated",
        source: "core",
        timestamp: Date.now(),
        payload: { reason: "run-already-in-progress" },
      });
      return;
    }

    this.running = true;
    this.cancelled = false;

    try {
      do {
        this.rerunRequested = false;

        const executionPlan = plan || this.plan();

        // Only clear outputs for nodes in the current execution plan,
        // so that nodes not being re-executed retain their cached outputs.
        for (const nodeId of executionPlan.order) {
          const node = this.graph.getNode(nodeId);
          if (!node) continue;
          const def = this.graph.getNodeDef(node.type);
          if (!def) continue;
          for (const output of def.outputs) {
            this.outputCache.delete(`${nodeId}:${output.name}`);
          }
        }
        plan = undefined;

        this.events.emit({
          type: "exec:start",
          source: "core",
          timestamp: Date.now(),
          payload: { nodeCount: executionPlan.order.length },
        });

        if (executionPlan.hasCycle) {
          const cycleError = "Cycle detected in graph";
          for (const cycleNodeId of executionPlan.cycleNodes) {
            this.graph.updateNode(cycleNodeId, {
              status: "error",
              error: cycleError,
            });
          }
          this.events.emit({
            type: "exec:cycle",
            source: "core",
            timestamp: Date.now(),
            payload: { nodeIds: executionPlan.cycleNodes },
          });
        }

        for (const level of executionPlan.levels) {
          if (this.cancelled) break;
          await this.executeLevel(level);
        }

        this.events.emit({
          type: "exec:complete",
          source: "core",
          timestamp: Date.now(),
          payload: { cancelled: this.cancelled, rerunRequested: this.rerunRequested },
        });
      } while (this.rerunRequested && !this.cancelled);
    } finally {
      this.running = false;
    }
  }

  async executeNode(nodeId: NodeId): Promise<void> {
    const fullPlan = this.plan();
    const idx = fullPlan.order.indexOf(nodeId);
    if (idx === -1) return;

    const downstream = new Set<NodeId>();
    downstream.add(nodeId);

    for (let i = idx + 1; i < fullPlan.order.length; i++) {
      const upstream = this.graph.getUpstream(fullPlan.order[i]);
      if (upstream.some(u => downstream.has(u))) {
        downstream.add(fullPlan.order[i]);
      }
    }

    const subPlan: ExecutionPlan = {
      order: fullPlan.order.filter((id: NodeId) => downstream.has(id)),
      levels: fullPlan.levels
        .map((level: NodeId[]) => level.filter((id: NodeId) => downstream.has(id)))
        .filter((level: NodeId[]) => level.length > 0),
      cycleNodes: fullPlan.cycleNodes.filter((id: NodeId) => downstream.has(id)),
      hasCycle: fullPlan.cycleNodes.some((id: NodeId) => downstream.has(id)),
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

  getAllOutputs(nodeId: NodeId): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of this.outputCache.entries()) {
      if (key.startsWith(`${nodeId}:`)) {
        const port = key.slice(nodeId.length + 1);
        result[port] = value;
      }
    }
    return result;
  }

  private async executeLevel(level: NodeId[]): Promise<void> {
    if (level.length === 0) return;

    const parallel: NodeId[] = [];
    const exclusiveGroups = new Map<string, NodeId[]>();

    for (const nodeId of level) {
      const node = this.graph.getNode(nodeId);
      const def = node ? this.graph.getNodeDef(node.type) : undefined;
      const execution = def?.execution;
      const exclusiveKey = execution?.mode === "exclusive"
        ? execution.concurrencyKey || `${nodeId}:exclusive`
        : execution?.concurrencyKey;

      if (exclusiveKey) {
        if (!exclusiveGroups.has(exclusiveKey)) exclusiveGroups.set(exclusiveKey, []);
        exclusiveGroups.get(exclusiveKey)!.push(nodeId);
      } else {
        parallel.push(nodeId);
      }
    }

    if (parallel.length > 0) {
      await runBounded(
        parallel,
        this.concurrencyLimit,
        async (nodeId) => this.executeSingleNode(nodeId),
      );
    }

    for (const nodeIds of exclusiveGroups.values()) {
      for (const nodeId of nodeIds) {
        if (this.cancelled) return;
        await this.executeSingleNode(nodeId);
      }
    }
  }

  private async executeSingleNode(nodeId: NodeId): Promise<void> {
    if (this.cancelled) return;

    const node = this.graph.getNode(nodeId);
    if (!node) return;

    const def = this.graph.getNodeDef(node.type);
    if (!def) return;

    const ctx = this.buildContext(nodeId, def);
    this.graph.updateNode(nodeId, {
      status: "running",
      error: undefined,
    });
    this.events.emit({
      type: "exec:node-start",
      source: nodeId,
      timestamp: Date.now(),
      payload: { nodeId, nodeType: node.type },
    });

    try {
      await def.execute(ctx);
      const completedAt = Date.now();

      // Auto-alias: if no explicit "out" port was set, alias the first named output
      if (!this.outputCache.has(`${nodeId}:out`)) {
        const firstOutput = def.outputs.find(o => o.name !== "out");
        if (firstOutput) {
          const firstValue = this.outputCache.get(`${nodeId}:${firstOutput.name}`);
          if (firstValue !== undefined) {
            this.outputCache.set(`${nodeId}:out`, firstValue);
            this.graph.updateNode(nodeId, { data: { out: firstValue } });
          }
        }
      }

      this.graph.updateNode(nodeId, {
        status: "done",
        error: undefined,
        meta: {
          lastRun: completedAt,
          runCount: (node.meta.runCount || 0) + 1,
        },
      });
      this.events.emit({
        type: "exec:node-complete",
        source: nodeId,
        timestamp: completedAt,
        payload: { nodeId, nodeType: node.type, status: "done" },
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
      this.events.emit({
        type: "exec:node-complete",
        source: nodeId,
        timestamp: Date.now(),
        payload: { nodeId, nodeType: node.type, status: "error", error: message },
      });
    }
  }

  private buildContext(nodeId: NodeId, _def: NodeDef): ExecContext {
    return {
      nodeId,

      getInput: (portName: string) => {
        const edges = this.graph.getEdgesTo(nodeId, portName);
        if (edges.length === 0) return undefined;
        if (edges.length === 1) {
          return this.outputCache.get(`${edges[0].from.node}:${edges[0].from.port}`);
        }
        return edges.map(e =>
          this.outputCache.get(`${e.from.node}:${e.from.port}`)
        );
      },

      setOutput: (portName: string, value: unknown) => {
        this.outputCache.set(`${nodeId}:${portName}`, value);
        this.graph.updateNode(nodeId, {
          data: { [portName]: value },
        });
      },

      getConfig: () => {
        return this.graph.getNode(nodeId)?.config || {};
      },

      emit: (event: CoreEvent) => {
        this.events.emit(event);
      },
    };
  }
}

async function runBounded<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const width = Math.max(1, Math.min(limit, items.length));
  let index = 0;

  await Promise.all(Array.from({ length: width }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  }));
}

function getDefaultConcurrency(): number {
  const hardware = typeof navigator !== "undefined"
    ? navigator.hardwareConcurrency || 4
    : 4;
  return Math.max(1, Math.min(8, hardware));
}
