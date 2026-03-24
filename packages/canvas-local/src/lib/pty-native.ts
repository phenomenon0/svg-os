import { listen } from "@tauri-apps/api/event";
import { ptySpawn, ptyKill } from "./ipc";

export async function startPtySession(
  nodeId: string,
  onData: (data: string) => void,
  onExit?: (code: number) => void,
  opts?: { shell?: string; cwd?: string; cols?: number; rows?: number },
): Promise<() => void> {
  await ptySpawn(nodeId, opts);

  const unlistenData = await listen<{ node_id: string; data: string }>("pty:output", (event) => {
    if (event.payload.node_id === nodeId) {
      onData(event.payload.data);
    }
  });

  const unlistenExit = await listen<{ node_id: string; exit_code: number }>("pty:exit", (event) => {
    if (event.payload.node_id === nodeId) {
      onExit?.(event.payload.exit_code);
    }
  });

  return () => {
    unlistenData();
    unlistenExit();
    ptyKill(nodeId).catch(() => {});
  };
}
