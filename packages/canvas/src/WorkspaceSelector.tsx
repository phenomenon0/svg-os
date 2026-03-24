/**
 * WorkspaceSelector — Top bar for workspace management + preset launch modal.
 *
 * Renders a 36px bar above the canvas with:
 * - Workspace name (editable)
 * - Canvas/Tiled mode toggle
 * - Workspace switcher dropdown
 * - "+" button to open preset modal
 * - "×" to exit workspace mode
 */

import { useEditor } from "tldraw";
import { useState, useEffect, useCallback, useRef } from "react";
import { C, FONT } from "./theme";
import { useRuntime } from "./RuntimeContext";
import {
  type WorkspaceDescriptor,
  type WorkspaceSnapshot,
  type PresetId,
  PRESETS,
  listWorkspaces,
  loadWorkspace,
  saveWorkspace,
  deleteWorkspace,
  getActiveWorkspaceId,
  setActiveWorkspaceId,
  materializePreset,
  captureWorkspace,
  restoreWorkspace,
} from "./lib/workspace";
import {
  applyTiledLayout,
  restoreCanvasMode,
  clearSavedPositions,
  handleTiledResize,
} from "./TiledMode";
import { clearMappings } from "./lib/runtime-bridge";

// ── Bar height constant ──────────────────────────────────────────────────────

export const WORKSPACE_BAR_HEIGHT = 36;

// ── Main component ───────────────────────────────────────────────────────────

export function WorkspaceSelector({
  descriptor,
  setDescriptor,
  onExit,
}: {
  descriptor: WorkspaceDescriptor;
  setDescriptor: (d: WorkspaceDescriptor | null) => void;
  onExit: () => void;
}) {
  const editor = useEditor();
  const runtime = useRuntime();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  // Window resize handler for tiled mode
  useEffect(() => {
    if (descriptor.mode !== "tiled" || !descriptor.tiledLayout) return;
    const handler = () => handleTiledResize(editor, descriptor.tiledLayout!);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [editor, descriptor.mode, descriptor.tiledLayout]);

  // ── Mode toggle ────────────────────────────────────────────────────────

  const toggleMode = useCallback(() => {
    const newMode = descriptor.mode === "tiled" ? "canvas" : "tiled";
    const updated = { ...descriptor, mode: newMode as "canvas" | "tiled", updatedAt: Date.now() };

    if (newMode === "tiled" && updated.tiledLayout) {
      applyTiledLayout(editor, updated.tiledLayout);
    } else {
      restoreCanvasMode(editor);
    }

    setDescriptor(updated);
  }, [descriptor, editor, setDescriptor]);

  // ── Switch workspace ───────────────────────────────────────────────────

  const switchTo = useCallback(
    (targetId: string) => {
      if (targetId === descriptor.id) {
        setDropdownOpen(false);
        return;
      }

      // Save current
      if (runtime) {
        const snapshot = captureWorkspace(editor, runtime, descriptor);
        saveWorkspace(snapshot);
      }

      // Restore canvas mode before switching
      if (descriptor.mode === "tiled") {
        restoreCanvasMode(editor);
      }
      clearSavedPositions();
      clearMappings();

      // Load target
      const target = loadWorkspace(targetId);
      if (target) {
        restoreWorkspace(editor, runtime!, target);
        setDescriptor(target.descriptor);
        setActiveWorkspaceId(target.descriptor.id);

        // Re-apply tiled if needed
        if (target.descriptor.mode === "tiled" && target.descriptor.tiledLayout) {
          requestAnimationFrame(() => {
            applyTiledLayout(editor, target.descriptor.tiledLayout!);
          });
        }
      }

      setDropdownOpen(false);
    },
    [descriptor, editor, runtime, setDescriptor],
  );

  // ── Delete workspace ───────────────────────────────────────────────────

  const handleDelete = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      deleteWorkspace(id);
      if (id === descriptor.id) {
        onExit();
      }
    },
    [descriptor.id, onExit],
  );

  // ── Create new workspace from preset ───────────────────────────────────

  const createFromPreset = useCallback(
    (presetId: PresetId) => {
      // Save current
      if (runtime) {
        const snapshot = captureWorkspace(editor, runtime, descriptor);
        saveWorkspace(snapshot);
      }

      // Clear for new workspace
      if (descriptor.mode === "tiled") {
        restoreCanvasMode(editor);
      }
      clearSavedPositions();
      clearMappings();

      // Clear canvas
      const allShapes = editor.getCurrentPageShapes();
      if (allShapes.length > 0) {
        editor.deleteShapes(allShapes.map((s) => s.id));
      }

      // Build new workspace
      const newDescriptor = materializePreset(editor, presetId);
      setDescriptor(newDescriptor);
      setActiveWorkspaceId(newDescriptor.id);

      // Apply tiled layout
      if (newDescriptor.mode === "tiled" && newDescriptor.tiledLayout) {
        requestAnimationFrame(() => {
          applyTiledLayout(editor, newDescriptor.tiledLayout!);
        });
      } else {
        editor.zoomToFit({ animation: { duration: 200 } });
      }

      setModalOpen(false);
    },
    [descriptor, editor, runtime, setDescriptor],
  );

  const workspaces = listWorkspaces();

  return (
    <>
      {/* Top bar */}
      <div
        style={{
          height: WORKSPACE_BAR_HEIGHT,
          background: C.bgDeep,
          borderBottom: `1px solid ${C.border}`,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          gap: 8,
          fontFamily: FONT.sans,
          fontSize: 12,
          zIndex: 2000,
          position: "relative",
          userSelect: "none",
        }}
      >
        {/* Preset icon */}
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            background: PRESETS.find((p) => p.id === descriptor.preset)?.color || C.faint,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            fontWeight: 700,
            color: C.bgDeep,
            flexShrink: 0,
          }}
        >
          {PRESETS.find((p) => p.id === descriptor.preset)?.icon || "W"}
        </span>

        {/* Workspace name */}
        <span
          style={{
            color: C.fg,
            fontWeight: 500,
            letterSpacing: "0.01em",
            maxWidth: 200,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {descriptor.name}
        </span>

        {/* Mode toggle pill */}
        <div
          style={{
            display: "flex",
            borderRadius: 4,
            border: `1px solid ${C.border}`,
            overflow: "hidden",
            marginLeft: 8,
          }}
        >
          {(["canvas", "tiled"] as const).map((mode) => (
            <button
              key={mode}
              onClick={toggleMode}
              style={{
                background: descriptor.mode === mode ? C.bgHover : "transparent",
                border: "none",
                color: descriptor.mode === mode ? C.fg : C.faint,
                fontSize: 10,
                fontFamily: FONT.sans,
                fontWeight: 500,
                padding: "3px 10px",
                cursor: "pointer",
                letterSpacing: "0.02em",
                textTransform: "uppercase",
              }}
            >
              {mode}
            </button>
          ))}
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Workspace switcher dropdown */}
        <div ref={dropdownRef} style={{ position: "relative" }}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            style={{
              background: "transparent",
              border: `1px solid ${C.border}`,
              borderRadius: 4,
              color: C.muted,
              fontSize: 10,
              fontFamily: FONT.sans,
              padding: "3px 8px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            Switch
            <span style={{ fontSize: 8 }}>&#x25BC;</span>
          </button>

          {dropdownOpen && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: 4,
                width: 220,
                background: C.bgCard,
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                zIndex: 3000,
                overflow: "hidden",
              }}
            >
              {workspaces.length === 0 && (
                <div style={{ padding: "12px 16px", color: C.faint, fontSize: 11 }}>
                  No other workspaces
                </div>
              )}
              {workspaces.map((ws) => (
                <div
                  key={ws.descriptor.id}
                  onClick={() => switchTo(ws.descriptor.id)}
                  style={{
                    padding: "8px 12px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                    background:
                      ws.descriptor.id === descriptor.id ? C.bgHover : "transparent",
                    borderBottom: `1px solid ${C.borderSoft}`,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = C.bgHover)
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background =
                      ws.descriptor.id === descriptor.id ? C.bgHover : "transparent")
                  }
                >
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 3,
                      background:
                        PRESETS.find((p) => p.id === ws.descriptor.preset)?.color ||
                        C.faint,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 8,
                      fontWeight: 700,
                      color: C.bgDeep,
                      flexShrink: 0,
                    }}
                  >
                    {PRESETS.find((p) => p.id === ws.descriptor.preset)?.icon || "W"}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      color: C.fg,
                      fontSize: 11,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {ws.descriptor.name}
                  </span>
                  <button
                    onClick={(e) => handleDelete(ws.descriptor.id, e)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: C.faint,
                      fontSize: 12,
                      cursor: "pointer",
                      padding: "0 2px",
                      lineHeight: 1,
                    }}
                  >
                    &#xd7;
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* New workspace */}
        <button
          onClick={() => setModalOpen(true)}
          style={{
            background: "transparent",
            border: `1px solid ${C.border}`,
            borderRadius: 4,
            color: C.accent,
            fontSize: 14,
            fontWeight: 500,
            padding: "1px 8px",
            cursor: "pointer",
            lineHeight: 1.4,
          }}
        >
          +
        </button>

        {/* Exit workspace mode */}
        <button
          onClick={onExit}
          style={{
            background: "transparent",
            border: "none",
            color: C.faint,
            fontSize: 14,
            cursor: "pointer",
            padding: "0 4px",
            lineHeight: 1,
          }}
          title="Exit workspace mode"
        >
          &#xd7;
        </button>
      </div>

      {/* Preset launch modal */}
      {modalOpen && (
        <PresetModal
          onSelect={createFromPreset}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}

// ── Preset launch modal ──────────────────────────────────────────────────────

export function PresetModal({
  onSelect,
  onClose,
}: {
  onSelect: (preset: PresetId) => void;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 5000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.6)",
        fontFamily: FONT.sans,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 560,
          background: C.bgCard,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: `1px solid ${C.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ color: C.fg, fontSize: 14, fontWeight: 600 }}>
            New Workspace
          </span>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: C.faint,
              fontSize: 16,
              cursor: "pointer",
            }}
          >
            &#xd7;
          </button>
        </div>

        {/* Preset grid */}
        <div
          style={{
            padding: 16,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
          }}
        >
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => onSelect(preset.id)}
              style={{
                background: C.bg,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: "14px 16px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 12,
                textAlign: "left",
                transition: "border-color 0.15s, background 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = preset.color;
                e.currentTarget.style.background = C.bgHover;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = C.border;
                e.currentTarget.style.background = C.bg;
              }}
            >
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 6,
                  background: preset.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  fontWeight: 700,
                  color: C.bgDeep,
                  flexShrink: 0,
                }}
              >
                {preset.icon}
              </span>
              <div>
                <div
                  style={{
                    color: C.fg,
                    fontSize: 13,
                    fontWeight: 600,
                    marginBottom: 2,
                  }}
                >
                  {preset.name}
                </div>
                <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.3 }}>
                  {preset.description}
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "10px 20px",
            borderTop: `1px solid ${C.border}`,
            fontSize: 10,
            color: C.dim,
            fontFamily: FONT.mono,
          }}
        >
          Presets create purpose-built layouts. Switch between workspaces anytime.
        </div>
      </div>
    </div>
  );
}
