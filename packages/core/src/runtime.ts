import type { NodeId, NodeDef, GraphSnapshot } from "./types";
import { EventBus } from "./event-bus";
import { Graph } from "./graph";
import { Scheduler } from "./scheduler";
import type { Subsystem } from "./subsystem";

export class Runtime {
  readonly graph: Graph;
  readonly scheduler: Scheduler;
  readonly events: EventBus;

  private subsystems = new Map<string, Subsystem>();

  constructor() {
    this.events = new EventBus();
    this.graph = new Graph(this.events);
    this.scheduler = new Scheduler(this.graph, this.events);
  }

  // ── Subsystem management ────────────────────────────────────────────

  async register(subsystem: Subsystem): Promise<void> {
    this.subsystems.set(subsystem.id, subsystem);

    // Register all node types from this subsystem
    for (const nodeDef of subsystem.nodeTypes) {
      this.graph.registerNodeDef(nodeDef);
    }

    // Initialize
    await subsystem.init(this);

    this.events.emit({
      type: "subsystem:registered",
      source: subsystem.id,
      timestamp: Date.now(),
      payload: {
        id: subsystem.id,
        name: subsystem.name,
        nodeTypes: subsystem.nodeTypes.map(n => n.type),
      },
    });
  }

  getSubsystem(id: string): Subsystem | undefined {
    return this.subsystems.get(id);
  }

  listSubsystems(): Subsystem[] {
    return [...this.subsystems.values()];
  }

  // ── Node type registry ──────────────────────────────────────────────

  getNodeDef(type: string): NodeDef | undefined {
    return this.graph.getNodeDef(type);
  }

  listNodeDefs(): NodeDef[] {
    return this.graph.listNodeDefs();
  }

  // ── Execution ───────────────────────────────────────────────────────

  async run(): Promise<void> {
    await this.scheduler.execute();
  }

  async runNode(id: NodeId): Promise<void> {
    await this.scheduler.executeNode(id);
  }

  // ── Persistence ─────────────────────────────────────────────────────

  save(): GraphSnapshot {
    const snapshot = this.graph.serialize();
    snapshot.subsystems = [...this.subsystems.keys()];
    return snapshot;
  }

  load(snapshot: GraphSnapshot): void {
    this.graph.deserialize(snapshot);
  }

  // ── Cleanup ─────────────────────────────────────────────────────────

  destroy(): void {
    for (const sub of this.subsystems.values()) {
      sub.teardown?.();
    }
    this.subsystems.clear();
    this.events.clear();
  }
}
