import type { SubsystemId, NodeDef, CoreEvent } from "./types";
import type { Runtime } from "./runtime";

export interface Subsystem {
  id: SubsystemId;
  name: string;
  nodeTypes: NodeDef[];
  init(runtime: Runtime): void | Promise<void>;
  teardown?(): void;
  middleware?: (event: CoreEvent, next: () => void) => void;
}
