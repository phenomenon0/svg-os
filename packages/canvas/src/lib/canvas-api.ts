/**
 * canvas-api.ts — Imperative API for canvas operations.
 *
 * Used by the MCP bridge to execute workspace/shape operations
 * from the browser side. Each method maps to one MCP tool.
 */

import type { Editor } from "tldraw";
import type { Runtime } from "@svg-os/core";
import type { WorkspaceDescriptor, PresetId, TiledLayout } from "./workspace";
import {
  listWorkspaces as listWS,
  loadWorkspace,
  saveWorkspace,
  setActiveWorkspaceId,
  materializePreset,
  captureWorkspace,
  restoreWorkspace,
  PRESETS,
} from "./workspace";
import {
  applyTiledLayout,
  restoreCanvasMode,
  clearSavedPositions,
  splitLayoutLeaf,
} from "../TiledMode";
import { clearMappings } from "./runtime-bridge";
import { NODE_TO_SHAPE, defaultPropsForShape } from "./node-registry";

export interface CanvasAPI {
  createWorkspace(preset: string, name?: string): unknown;
  listWorkspaces(): unknown;
  switchWorkspace(id: string): unknown;
  getWorkspaceState(): unknown;
  splitPanel(shapeId: string, direction: string, nodeType: string): unknown;
  addShape(nodeType: string, x?: number, y?: number): unknown;
  connectShapes(fromId: string, toId: string): unknown;
  updateShape(shapeId: string, props: Record<string, unknown>): unknown;
}

export function createCanvasAPI(
  editor: Editor,
  runtime: Runtime | null,
  getDescriptor: () => WorkspaceDescriptor | null,
  setDescriptor: (d: WorkspaceDescriptor | null) => void,
): CanvasAPI {
  return {
    createWorkspace(preset: string, name?: string) {
      const presetId = preset as PresetId;
      if (!PRESETS.find((p) => p.id === presetId)) {
        return { error: `Unknown preset: ${preset}. Available: ${PRESETS.map((p) => p.id).join(", ")}` };
      }

      // Save current workspace
      const current = getDescriptor();
      if (current && runtime) {
        saveWorkspace(captureWorkspace(editor, runtime, current));
        if (current.mode === "tiled") restoreCanvasMode(editor);
      }
      clearSavedPositions();
      clearMappings();

      // Clear canvas
      const allShapes = editor.getCurrentPageShapes();
      if (allShapes.length > 0) {
        editor.deleteShapes(allShapes.map((s) => s.id));
      }

      // Build new workspace
      const desc = materializePreset(editor, presetId, name);
      setDescriptor(desc);
      setActiveWorkspaceId(desc.id);

      if (desc.mode === "tiled" && desc.tiledLayout) {
        setTimeout(() => applyTiledLayout(editor, desc.tiledLayout!), 50);
      }

      return { id: desc.id, name: desc.name, preset: desc.preset, mode: desc.mode };
    },

    listWorkspaces() {
      const saved = listWS();
      const current = getDescriptor();
      return {
        active: current
          ? { id: current.id, name: current.name, preset: current.preset, mode: current.mode }
          : null,
        workspaces: saved.map((ws) => ({
          id: ws.descriptor.id,
          name: ws.descriptor.name,
          preset: ws.descriptor.preset,
          mode: ws.descriptor.mode,
        })),
      };
    },

    switchWorkspace(id: string) {
      const target = loadWorkspace(id);
      if (!target) return { error: `Workspace ${id} not found` };

      const current = getDescriptor();
      if (current && runtime) {
        saveWorkspace(captureWorkspace(editor, runtime, current));
        if (current.mode === "tiled") restoreCanvasMode(editor);
      }
      clearSavedPositions();
      clearMappings();

      restoreWorkspace(editor, runtime!, target);
      setDescriptor(target.descriptor);
      setActiveWorkspaceId(target.descriptor.id);

      if (target.descriptor.mode === "tiled" && target.descriptor.tiledLayout) {
        setTimeout(() => applyTiledLayout(editor, target.descriptor.tiledLayout!), 50);
      }

      return { id: target.descriptor.id, name: target.descriptor.name };
    },

    getWorkspaceState() {
      const desc = getDescriptor();
      const shapes = editor.getCurrentPageShapes().map((s) => ({
        id: s.id,
        type: s.type,
        x: s.x,
        y: s.y,
        props: s.props,
      }));

      return {
        workspace: desc
          ? { id: desc.id, name: desc.name, preset: desc.preset, mode: desc.mode }
          : null,
        tiledLayout: desc?.tiledLayout || null,
        shapes,
      };
    },

    splitPanel(shapeId: string, direction: string, nodeType: string) {
      const desc = getDescriptor();
      if (!desc || !desc.tiledLayout) return { error: "No tiled workspace active" };
      if (direction !== "horizontal" && direction !== "vertical") {
        return { error: "Direction must be 'horizontal' or 'vertical'" };
      }

      const shapeType = NODE_TO_SHAPE[nodeType];
      if (!shapeType) return { error: `Unknown node type: ${nodeType}` };

      const newShapeId = `shape:mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const props = defaultPropsForShape(shapeType);

      editor.createShape({
        id: newShapeId as never,
        type: shapeType as never,
        x: 0,
        y: 0,
        props: props as never,
      });

      const newLayout = splitLayoutLeaf(
        desc.tiledLayout,
        shapeId,
        direction as "horizontal" | "vertical",
        newShapeId,
      );

      const updated = { ...desc, tiledLayout: newLayout, updatedAt: Date.now() };
      setDescriptor(updated);

      setTimeout(() => applyTiledLayout(editor, newLayout), 50);

      return { newShapeId, layout: newLayout };
    },

    addShape(nodeType: string, x?: number, y?: number) {
      const shapeType = NODE_TO_SHAPE[nodeType];
      if (!shapeType) return { error: `Unknown node type: ${nodeType}` };

      const props = defaultPropsForShape(shapeType);
      const center = editor.getViewportScreenCenter();
      const px = x ?? center.x - ((props.w as number) || 300) / 2;
      const py = y ?? center.y - ((props.h as number) || 200) / 2;

      const shapeId = `shape:mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      editor.createShape({
        id: shapeId as never,
        type: shapeType as never,
        x: px,
        y: py,
        props: props as never,
      });

      return { shapeId, type: shapeType };
    },

    connectShapes(fromId: string, toId: string) {
      const arrowId = `shape:arrow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      editor.createShape({
        id: arrowId as never,
        type: "arrow" as never,
        x: 0,
        y: 0,
        props: {} as never,
      });
      editor.createBinding({
        fromId: arrowId as never,
        toId: fromId as never,
        type: "arrow",
        props: {
          terminal: "start",
          normalizedAnchor: { x: 0.5, y: 0.5 },
          isExact: false,
          isPrecise: true,
        },
      });
      editor.createBinding({
        fromId: arrowId as never,
        toId: toId as never,
        type: "arrow",
        props: {
          terminal: "end",
          normalizedAnchor: { x: 0.5, y: 0.5 },
          isExact: false,
          isPrecise: true,
        },
      });

      return { arrowId };
    },

    updateShape(shapeId: string, props: Record<string, unknown>) {
      const shape = editor.getShape(shapeId as never);
      if (!shape) return { error: `Shape ${shapeId} not found` };

      editor.updateShape({
        id: shapeId as never,
        type: shape.type as never,
        props: props as never,
      });

      return { shapeId, updated: Object.keys(props) };
    },
  };
}
