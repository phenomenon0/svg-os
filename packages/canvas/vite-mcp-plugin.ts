/**
 * vite-mcp-plugin.ts — Vite plugin that exposes canvas operations as MCP tools.
 *
 * Architecture:
 * 1. Mounts Streamable HTTP endpoint at /mcp (for Claude Code / MCP clients)
 * 2. Runs internal WebSocket at /__mcp_bridge (for browser canvas app)
 * 3. When an MCP tool is called, sends command to browser via WS, awaits response
 *
 * Claude Code config: claude mcp add svgos --transport http http://localhost:5190/mcp
 */

import type { Plugin, ViteDevServer } from "vite";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, ServerResponse } from "node:http";

// ── Browser bridge state ─────────────────────────────────────────────────────

let browserSocket: WebSocket | null = null;
const pendingRequests = new Map<
  string,
  { resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }
>();

let reqCounter = 0;
function nextReqId(): string {
  return `mcp_${Date.now()}_${reqCounter++}`;
}

function sendToBrowser(method: string, params: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!browserSocket || browserSocket.readyState !== WebSocket.OPEN) {
      reject(new Error("Browser not connected. Open the SVG OS canvas in a browser first."));
      return;
    }

    const id = nextReqId();
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error("Browser did not respond within 30 seconds"));
    }, 30000);

    pendingRequests.set(id, { resolve, timer });
    browserSocket.send(JSON.stringify({ id, method, params }));
  });
}

// ── Plugin ───────────────────────────────────────────────────────────────────

export function viteMcpPlugin(): Plugin {
  return {
    name: "svg-os-mcp",

    configureServer(server: ViteDevServer) {
      const httpServer = server.httpServer;
      if (!httpServer) return;

      // ── 1. Internal WebSocket for browser bridge ─────────────────────
      const wss = new WebSocketServer({ noServer: true });

      httpServer.on("upgrade", (req, socket, head) => {
        if (req.url === "/__mcp_bridge") {
          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req);
          });
        }
        // Don't handle other upgrades (Vite HMR handles its own)
      });

      wss.on("connection", (ws) => {
        console.log("[mcp] Browser connected");
        browserSocket = ws;

        ws.on("message", (data) => {
          try {
            const msg = JSON.parse(data.toString());
            const pending = pendingRequests.get(msg.id);
            if (pending) {
              clearTimeout(pending.timer);
              pendingRequests.delete(msg.id);
              pending.resolve(msg.result ?? msg.error ?? null);
            }
          } catch (err) {
            console.error("[mcp] Bad message from browser:", err);
          }
        });

        ws.on("close", () => {
          console.log("[mcp] Browser disconnected");
          if (browserSocket === ws) browserSocket = null;
        });
      });

      // ── 2. MCP Server with tools ────────────────────────────────────
      const mcpServer = new McpServer({
        name: "svg-os-canvas",
        version: "0.1.0",
      });

      // Tool: create_workspace
      mcpServer.tool(
        "create_workspace",
        "Create a new workspace from a preset. Available presets: claude-dev, musician, painter, hacker, programmer, designer, blank",
        {
          preset: z.enum(["claude-dev", "musician", "painter", "hacker", "programmer", "designer", "blank"]),
          name: z.string().optional().describe("Custom workspace name"),
        },
        async ({ preset, name }) => {
          const result = await sendToBrowser("create_workspace", { preset, name });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
      );

      // Tool: list_workspaces
      mcpServer.tool(
        "list_workspaces",
        "List all saved workspaces and the currently active one",
        {},
        async () => {
          const result = await sendToBrowser("list_workspaces", {});
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
      );

      // Tool: switch_workspace
      mcpServer.tool(
        "switch_workspace",
        "Switch to a different workspace by ID",
        { id: z.string().describe("Workspace ID to switch to") },
        async ({ id }) => {
          const result = await sendToBrowser("switch_workspace", { id });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
      );

      // Tool: get_workspace_state
      mcpServer.tool(
        "get_workspace_state",
        "Get the current workspace layout, shapes, and their properties",
        {},
        async () => {
          const result = await sendToBrowser("get_workspace_state", {});
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
      );

      // Tool: split_panel
      mcpServer.tool(
        "split_panel",
        "Split a panel in tiled mode. Creates a new shape and divides the panel.",
        {
          shapeId: z.string().describe("ID of the panel/shape to split"),
          direction: z.enum(["horizontal", "vertical"]).describe("Split direction"),
          nodeType: z.string().describe("Node type for the new panel (e.g. 'view:note', 'sys:terminal', 'view:webview', 'data:ai')"),
        },
        async ({ shapeId, direction, nodeType }) => {
          const result = await sendToBrowser("split_panel", { shapeId, direction, nodeType });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
      );

      // Tool: add_shape
      mcpServer.tool(
        "add_shape",
        "Add a new shape to the canvas. Node types: view:note, data:table, sys:terminal, data:json, sys:notebook, view:webview, data:ai, data:transform",
        {
          nodeType: z.string().describe("Node type to create"),
          x: z.number().optional().describe("X position (defaults to center)"),
          y: z.number().optional().describe("Y position (defaults to center)"),
        },
        async ({ nodeType, x, y }) => {
          const result = await sendToBrowser("add_shape", { nodeType, x, y });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
      );

      // Tool: connect_shapes
      mcpServer.tool(
        "connect_shapes",
        "Create a data flow arrow between two shapes",
        {
          fromId: z.string().describe("Source shape ID"),
          toId: z.string().describe("Target shape ID"),
        },
        async ({ fromId, toId }) => {
          const result = await sendToBrowser("connect_shapes", { fromId, toId });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
      );

      // Tool: update_shape
      mcpServer.tool(
        "update_shape",
        "Update properties of an existing shape (e.g. change URL, content, label)",
        {
          shapeId: z.string().describe("Shape ID to update"),
          props: z.record(z.unknown()).describe("Properties to update"),
        },
        async ({ shapeId, props }) => {
          const result = await sendToBrowser("update_shape", { shapeId, props });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
      );

      // ── 3. Mount Streamable HTTP at /mcp ────────────────────────────

      // We handle each request with a fresh stateless transport
      server.middlewares.use("/mcp", async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        // Handle CORS for browser-based MCP clients
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");
        res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        try {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined, // stateless
          });

          await mcpServer.connect(transport);
          await transport.handleRequest(req, res);
        } catch (err) {
          console.error("[mcp] Error handling request:", err);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal server error" }));
          }
        }
      });

      console.log("[mcp] SVG OS MCP server ready at /mcp");
      console.log("[mcp] Configure Claude Code: claude mcp add svgos --transport http http://localhost:5190/mcp");
    },
  };
}
