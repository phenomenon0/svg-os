/**
 * mcp-bridge.ts — Browser-side WebSocket client that receives
 * MCP tool call commands from the Vite plugin and dispatches
 * them to the CanvasAPI.
 */

import type { CanvasAPI } from "./canvas-api";

interface MCPRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

interface MCPResponse {
  id: string;
  result?: unknown;
  error?: string;
}

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function initMcpBridge(api: CanvasAPI): { disconnect: () => void } {
  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${location.host}/__mcp_bridge`;

    try {
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      console.log("[mcp-bridge] connected");
    };

    ws.onmessage = (event) => {
      try {
        const req: MCPRequest = JSON.parse(event.data);
        const result = dispatch(api, req);
        const resp: MCPResponse = { id: req.id, result };
        ws?.send(JSON.stringify(resp));
      } catch (err) {
        console.error("[mcp-bridge] error handling message:", err);
      }
    };

    ws.onclose = () => {
      console.log("[mcp-bridge] disconnected");
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 2000);
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.onclose = null; // prevent reconnect
      ws.close();
      ws = null;
    }
  }

  connect();
  return { disconnect };
}

function dispatch(api: CanvasAPI, req: MCPRequest): unknown {
  const p = req.params || {};

  switch (req.method) {
    case "create_workspace":
      return api.createWorkspace(p.preset as string, p.name as string | undefined);
    case "list_workspaces":
      return api.listWorkspaces();
    case "switch_workspace":
      return api.switchWorkspace(p.id as string);
    case "get_workspace_state":
      return api.getWorkspaceState();
    case "split_panel":
      return api.splitPanel(
        p.shapeId as string,
        p.direction as string,
        p.nodeType as string,
      );
    case "add_shape":
      return api.addShape(
        p.nodeType as string,
        p.x as number | undefined,
        p.y as number | undefined,
      );
    case "connect_shapes":
      return api.connectShapes(p.fromId as string, p.toId as string);
    case "update_shape":
      return api.updateShape(p.shapeId as string, p.props as Record<string, unknown>);
    default:
      return { error: `Unknown method: ${req.method}` };
  }
}
