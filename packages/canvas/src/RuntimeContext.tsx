/**
 * RuntimeContext — provides the @svg-os/core Runtime to all canvas components.
 *
 * The Runtime owns graph execution, scheduling, and subsystem registration.
 * Canvas components consume runtime state; they do not run a second graph
 * evaluator alongside it.
 */

import { createContext, useContext, useEffect, useState } from "react";
import { Runtime } from "@svg-os/core";
import { systemSubsystem } from "@svg-os/subsystem-system";
import { dataSubsystem } from "@svg-os/subsystem-data";
import { viewSubsystem } from "@svg-os/subsystem-view";

const RuntimeCtx = createContext<Runtime | null>(null);

/**
 * Hook to access the Runtime from any component inside RuntimeProvider.
 * Throws if called outside the provider tree.
 */
export function useRuntime(): Runtime | null {
  return useContext(RuntimeCtx);
}

/**
 * Provider that creates a single Runtime instance, registers all three
 * subsystems, and exposes it via context once initialisation completes.
 *
 * Children are not rendered until every subsystem has been registered so
 * downstream code can safely assume the Runtime is fully initialised.
 */
export function RuntimeProvider({ children }: { children: React.ReactNode }) {
  const [runtime] = useState(() => new Runtime());

  useEffect(() => {
    Promise.all([
      runtime.register(systemSubsystem),
      runtime.register(dataSubsystem),
      runtime.register(viewSubsystem),
    ])
      .catch((e) => {
        console.error("[runtime] subsystem registration failed:", e);
      });

    return () => runtime.destroy();
  }, [runtime]);

  // Always render children — the runtime is available even if subsystems
  // are still registering. RuntimeBridge handles the sync timing.
  return (
    <RuntimeCtx.Provider value={runtime}>{children}</RuntimeCtx.Provider>
  );
}
