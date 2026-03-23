/**
 * RuntimeContext — provides the @svg-os/core Runtime to all canvas components.
 *
 * The Runtime owns the graph, scheduler, and event bus. During the Phase 2
 * migration it runs IN PARALLEL with the existing reactive-engine; shapes
 * still store their own data in tldraw props.
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
export function useRuntime(): Runtime {
  const rt = useContext(RuntimeCtx);
  if (!rt) throw new Error("useRuntime must be used inside <RuntimeProvider>");
  return rt;
}

/**
 * Provider that creates a single Runtime instance, registers all three
 * subsystems, and exposes it via context once initialisation completes.
 *
 * Children are not rendered until every subsystem has been registered so
 * downstream code can safely assume the Runtime is fully initialised.
 */
export function RuntimeProvider({ children }: { children: React.ReactNode }) {
  const [runtime, setRuntime] = useState<Runtime | null>(null);

  useEffect(() => {
    const rt = new Runtime();

    Promise.all([
      rt.register(systemSubsystem),
      rt.register(dataSubsystem),
      rt.register(viewSubsystem),
    ]).then(() => {
      setRuntime(rt);
    });

    return () => {
      rt.destroy();
    };
  }, []);

  if (!runtime) return null;

  return (
    <RuntimeCtx.Provider value={runtime}>{children}</RuntimeCtx.Provider>
  );
}
