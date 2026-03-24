/**
 * Test helpers — re-exports core and subsystem modules for E2E test access.
 * Vite serves these via /src/lib/test-helpers.ts in dev mode.
 */

export { Runtime, EventBus, Graph, Scheduler } from "@svg-os/core";
export type { ExecResult, Lang, NodeDef, ExecContext, TriggerMode } from "@svg-os/core";

export { dataSubsystem } from "@svg-os/subsystem-data";
export { systemSubsystem, executeTerminal, executeNotebook, executeCode, evalJS } from "@svg-os/subsystem-system";
export { viewSubsystem } from "@svg-os/subsystem-view";
