import { useEffect, useRef } from "react";
import { useEditor } from "tldraw";
import { listen } from "@tauri-apps/api/event";

/**
 * NativeRuntimeBridge syncs tldraw shapes to the Rust graph engine via Tauri IPC.
 * - Watches tldraw store mutations -> sends to Rust backend
 * - Listens for Rust execution events -> updates tldraw shapes
 */
export function NativeRuntimeBridge() {
  const editor = useEditor();
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    // Listen for graph events from Rust backend
    const unlisteners: Array<() => void> = [];

    const setup = async () => {
      const unlisten = await listen<any>("graph:node-updated", (event) => {
        const { id, status, data, error } = event.payload;
        // Find the shape mapped to this node and update its props
        // This will be filled in as shapes are connected
      });
      unlisteners.push(unlisten);

      const unlistenExec = await listen<any>("graph:exec-complete", (_event) => {
        // Execution cycle complete
      });
      unlisteners.push(unlistenExec);
    };

    setup();

    // Watch tldraw store for shape changes
    const unsub = editor.store.listen((entry) => {
      // Debounce: batch mutations within 16ms
      if (debounceRef.current) {
        cancelAnimationFrame(debounceRef.current);
      }
      debounceRef.current = requestAnimationFrame(() => {
        // Process changes and send to Rust
        for (const [_id, change] of Object.entries(entry.changes.added)) {
          // New shapes added -- create nodes in Rust
        }
        for (const [_id, [_before, _after]] of Object.entries(entry.changes.updated)) {
          // Shape props changed -- update nodes in Rust
        }
        for (const [_id, _change] of Object.entries(entry.changes.removed)) {
          // Shapes removed -- remove nodes in Rust
        }
      });
    });

    return () => {
      unsub();
      unlisteners.forEach((fn) => fn());
      if (debounceRef.current) cancelAnimationFrame(debounceRef.current);
    };
  }, [editor]);

  return null;
}
