/**
 * Port — named, typed connection point. Drag from port to port to connect.
 * Supports multiple ports per side, stacked vertically.
 * Color-coded by data type. Shows name label on hover.
 */

import { useEditor } from "tldraw";
import { useCallback, useRef, useState } from "react";
import { C, FONT } from "./theme";

// ── Port types and their colors ──────────────────────────────────────────────

export type PortType = "data" | "text" | "number" | "image" | "any";

const PORT_COLORS: Record<PortType, string> = {
  data:   C.green,
  text:   C.accent,
  number: C.blue,
  image:  C.pink,
  any:    C.faint,
};

export function getPortColor(type: PortType): string {
  return PORT_COLORS[type] || C.faint;
}

// ── Port component ───────────────────────────────────────────────────────────

interface PortProps {
  side: "left" | "right";
  color?: string;       // override color (backward compat)
  type?: PortType;      // port data type (determines color if no override)
  name?: string;        // port name (shown on hover, used in bindings)
  shapeId: string;
  index?: number;       // position index when multiple ports on same side
  total?: number;       // total ports on this side
}

export function Port({
  side,
  color: colorOverride,
  type = "any",
  name = "",
  shapeId,
  index = 0,
  total = 1,
}: PortProps) {
  const editor = useEditor();
  const [hovering, setHovering] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  const color = colorOverride || getPortColor(type);

  // Calculate vertical position for stacked ports
  const spacing = total > 1 ? Math.min(24, (100 - 20) / (total - 1)) : 0;
  const centerOffset = total > 1 ? (index - (total - 1) / 2) * spacing : 0;
  const topPercent = 50 + centerOffset;

  const portRef = useCallback((el: HTMLDivElement | null) => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    if (!el) return;

    const handleDown = (e: PointerEvent) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();

      const rect = el.getBoundingClientRect();
      const startX = rect.left + rect.width / 2;
      const startY = rect.top + rect.height / 2;

      const overlay = document.createElement("div");
      overlay.id = "port-drag-overlay";
      overlay.style.cssText = "position:fixed;inset:0;z-index:99999;cursor:crosshair;pointer-events:all;";
      const svgNs = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(svgNs, "svg");
      svg.style.cssText = "width:100%;height:100%;";

      // Colored drag line matching port type
      const line = document.createElementNS(svgNs, "line");
      line.setAttribute("x1", String(startX));
      line.setAttribute("y1", String(startY));
      line.setAttribute("x2", String(startX));
      line.setAttribute("y2", String(startY));
      line.setAttribute("stroke", color);
      line.setAttribute("stroke-width", "2");
      line.setAttribute("stroke-dasharray", "6 3");
      line.setAttribute("opacity", "0.9");
      svg.appendChild(line);

      const dot = document.createElementNS(svgNs, "circle");
      dot.setAttribute("r", "5");
      dot.setAttribute("fill", color);
      dot.setAttribute("opacity", "0.8");
      svg.appendChild(dot);

      // Glow around source port
      const glow = document.createElementNS(svgNs, "circle");
      glow.setAttribute("cx", String(startX));
      glow.setAttribute("cy", String(startY));
      glow.setAttribute("r", "12");
      glow.setAttribute("fill", "none");
      glow.setAttribute("stroke", color);
      glow.setAttribute("stroke-width", "1");
      glow.setAttribute("opacity", "0.4");
      svg.appendChild(glow);

      overlay.appendChild(svg);
      document.body.appendChild(overlay);

      const onMove = (ev: PointerEvent) => {
        line.setAttribute("x2", String(ev.clientX));
        line.setAttribute("y2", String(ev.clientY));
        dot.setAttribute("cx", String(ev.clientX));
        dot.setAttribute("cy", String(ev.clientY));
        highlightNearbyPorts(ev.clientX, ev.clientY, shapeId, color);
      };

      const onUp = (ev: PointerEvent) => {
        overlay.removeEventListener("pointermove", onMove);
        overlay.removeEventListener("pointerup", onUp);
        overlay.remove();
        clearHighlights();

        const target = findPortAt(ev.clientX, ev.clientY, shapeId);
        if (target) {
          createConnection(editor, shapeId, target.shapeId, name, target.name);
        }
      };

      overlay.addEventListener("pointermove", onMove);
      overlay.addEventListener("pointerup", onUp);
    };

    el.addEventListener("pointerdown", handleDown, { capture: true });
    cleanupRef.current = () => el.removeEventListener("pointerdown", handleDown, { capture: true });
  }, [editor, shapeId, side, color, name]);

  const isLeft = side === "left";
  const size = 8;

  return (
    <div
      ref={portRef}
      data-port-shape={shapeId}
      data-port-side={side}
      data-port-name={name}
      data-port-type={type}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        position: "absolute",
        [isLeft ? "left" : "right"]: 4,
        top: `${topPercent}%`,
        transform: "translateY(-50%)",
        width: hovering ? 10 : size,
        height: hovering ? 10 : size,
        borderRadius: "50%",
        background: color,
        border: hovering ? `2px solid #fff` : "none",
        cursor: "crosshair",
        zIndex: 10,
        transition: "all 0.12s ease",
        boxShadow: hovering ? `0 0 10px ${color}88` : "none",
      }}
    >
      {/* Name label on hover */}
      {hovering && name && (
        <div
          style={{
            position: "absolute",
            [isLeft ? "left" : "right"]: (hovering ? 10 : size) + 6,
            top: "50%",
            transform: "translateY(-50%)",
            background: C.bgCard,
            border: `1px solid ${C.border}`,
            borderRadius: 4,
            padding: "2px 6px",
            fontSize: 9,
            fontFamily: FONT.mono,
            color: color,
            whiteSpace: "nowrap",
            letterSpacing: "0.04em",
            pointerEvents: "none",
            boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          }}
        >
          {name}
        </div>
      )}
    </div>
  );
}

// ── Connection creation ──────────────────────────────────────────────────────

function createConnection(
  editor: any,
  fromId: string,
  toId: string,
  fromPort: string = "",
  toPort: string = "",
) {
  const from = editor.getShape(fromId);
  const to = editor.getShape(toId);
  if (!from || !to) return;

  const fb = editor.getShapeGeometry(fromId).bounds;
  const tb = editor.getShapeGeometry(toId).bounds;

  editor.createShape({
    type: "arrow",
    props: {
      start: { x: from.x + fb.width, y: from.y + fb.height / 2 },
      end: { x: to.x, y: to.y + tb.height / 2 },
    },
  });

  const arrows = editor.getCurrentPageShapes().filter((s: any) => s.type === "arrow");
  const newArrow = arrows[arrows.length - 1];
  if (newArrow) {
    try {
      editor.createBinding({
        type: "arrow", fromId: newArrow.id, toId: fromId,
        props: {
          terminal: "start",
          portName: fromPort,
          portSide: "right",
          normalizedAnchor: { x: 1, y: 0.5 },
          isExact: false,
          isPrecise: false,
        },
      });
      editor.createBinding({
        type: "arrow", fromId: newArrow.id, toId: toId,
        props: {
          terminal: "end",
          portName: toPort,
          portSide: "left",
          normalizedAnchor: { x: 0, y: 0.5 },
          isExact: false,
          isPrecise: false,
        },
      });
    } catch (e) {
      console.warn("[port] binding failed:", e);
    }
  }
}

// ── Port detection helpers ───────────────────────────────────────────────────

function findPortAt(x: number, y: number, excludeShapeId: string) {
  for (const port of document.querySelectorAll("[data-port-shape]")) {
    const sid = port.getAttribute("data-port-shape");
    if (sid === excludeShapeId) continue;
    const r = (port as HTMLElement).getBoundingClientRect();
    if (Math.abs(x - (r.left + r.width / 2)) < 20 && Math.abs(y - (r.top + r.height / 2)) < 20) {
      return {
        shapeId: sid!,
        side: port.getAttribute("data-port-side") || "left",
        name: port.getAttribute("data-port-name") || "",
      };
    }
  }
  return null;
}

function highlightNearbyPorts(x: number, y: number, excludeShapeId: string, dragColor: string) {
  for (const port of document.querySelectorAll("[data-port-shape]")) {
    const el = port as HTMLElement;
    if (el.getAttribute("data-port-shape") === excludeShapeId) continue;
    const r = el.getBoundingClientRect();
    const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
    if (d < 30) {
      el.style.transform = "translateY(-50%) scale(1.4)";
      el.style.boxShadow = `0 0 14px ${dragColor}99`;
      el.style.background = "#fff";
    } else {
      el.style.transform = "translateY(-50%)";
      el.style.boxShadow = "";
      el.style.background = "";
    }
  }
}

function clearHighlights() {
  for (const port of document.querySelectorAll("[data-port-shape]")) {
    const el = port as HTMLElement;
    el.style.transform = "translateY(-50%)";
    el.style.boxShadow = "";
    el.style.background = "";
  }
}
