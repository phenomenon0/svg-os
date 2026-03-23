/**
 * Port — a draggable connection point on a node.
 *
 * Drag from a port to another port to create an arrow connection.
 * No mode switching, no arrow tool. Just grab and connect.
 *
 * After connecting, the port stays visible for additional connections.
 */

import { useEditor } from "tldraw";
import { useCallback, useRef, useState } from "react";

interface PortProps {
  /** Which side: 'left' (input) or 'right' (output) */
  side: "left" | "right";
  /** Color of the port dot */
  color: string;
  /** The shape ID this port belongs to */
  shapeId: string;
  /** Whether this port has an active connection */
  connected?: boolean;
}

// Global state for drag-to-connect
let dragState: {
  fromShapeId: string;
  fromSide: string;
  startX: number;
  startY: number;
  lineEl: SVGLineElement | null;
} | null = null;

export function Port({ side, color, shapeId, connected }: PortProps) {
  const editor = useEditor();
  const ref = useRef<HTMLDivElement>(null);
  const [hovering, setHovering] = useState(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const portEl = ref.current;
    if (!portEl) return;

    // Get the port's position in page coordinates
    const rect = portEl.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + rect.height / 2;

    // Create a temporary SVG line overlay for the drag preview
    const overlay = document.createElement("div");
    overlay.id = "port-drag-overlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:99999;cursor:crosshair;pointer-events:all;";
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.style.cssText = "width:100%;height:100%;";
    const line = document.createElementNS(svgNs, "line");
    line.setAttribute("x1", String(startX));
    line.setAttribute("y1", String(startY));
    line.setAttribute("x2", String(startX));
    line.setAttribute("y2", String(startY));
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-dasharray", "6 3");
    svg.appendChild(line);

    // Add a circle at the cursor end
    const cursor = document.createElementNS(svgNs, "circle");
    cursor.setAttribute("r", "6");
    cursor.setAttribute("fill", color);
    cursor.setAttribute("opacity", "0.6");
    svg.appendChild(cursor);

    overlay.appendChild(svg);
    document.body.appendChild(overlay);

    dragState = { fromShapeId: shapeId, fromSide: side, startX, startY, lineEl: line };

    const onMove = (ev: MouseEvent) => {
      line.setAttribute("x2", String(ev.clientX));
      line.setAttribute("y2", String(ev.clientY));
      cursor.setAttribute("cx", String(ev.clientX));
      cursor.setAttribute("cy", String(ev.clientY));

      // Highlight ports under cursor
      highlightPortsUnder(ev.clientX, ev.clientY, shapeId);
    };

    const onUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      overlay.remove();
      clearHighlights();

      // Find if we dropped on a port
      const target = findPortUnder(ev.clientX, ev.clientY, shapeId);
      if (target) {
        // Create a tldraw arrow between the two shapes
        createArrowBetween(editor, shapeId, target.shapeId);
      }

      dragState = null;
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [editor, shapeId, side, color]);

  const isLeft = side === "left";

  return (
    <div
      ref={ref}
      data-port-shape={shapeId}
      data-port-side={side}
      onPointerDown={onPointerDown}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        position: "absolute",
        [isLeft ? "left" : "right"]: -7,
        top: "50%",
        transform: "translateY(-50%)",
        width: 14,
        height: 14,
        borderRadius: "50%",
        background: hovering ? "#fff" : color,
        border: `2px solid ${hovering ? color : "#0f172a"}`,
        cursor: "crosshair",
        zIndex: 10,
        transition: "all 0.15s ease",
        boxShadow: hovering ? `0 0 8px ${color}80` : "none",
      }}
    />
  );
}

/**
 * Create a tldraw arrow between two shapes.
 */
function createArrowBetween(editor: any, fromId: string, toId: string) {
  const from = editor.getShape(fromId);
  const to = editor.getShape(toId);
  if (!from || !to) return;

  // Calculate positions for the arrow
  const fromBounds = editor.getShapeGeometry(fromId).bounds;
  const toBounds = editor.getShapeGeometry(toId).bounds;

  editor.createShape({
    type: "arrow",
    props: {
      start: {
        x: from.x + fromBounds.width,
        y: from.y + fromBounds.height / 2,
      },
      end: {
        x: to.x,
        y: to.y + toBounds.height / 2,
      },
    },
  });

  // Also create bindings so arrow follows the shapes
  // tldraw handles this if we use the arrow tool, but for programmatic arrows
  // we need to explicitly bind
  const arrows = editor.getCurrentPageShapes().filter((s: any) => s.type === "arrow");
  const newArrow = arrows[arrows.length - 1];
  if (newArrow) {
    try {
      editor.createBinding({
        type: "arrow",
        fromId: newArrow.id,
        toId: fromId,
        props: { terminal: "start", normalizedAnchor: { x: 1, y: 0.5 }, isExact: false, isPrecise: false },
      });
      editor.createBinding({
        type: "arrow",
        fromId: newArrow.id,
        toId: toId,
        props: { terminal: "end", normalizedAnchor: { x: 0, y: 0.5 }, isExact: false, isPrecise: false },
      });
    } catch (e) {
      console.warn("[port] binding creation failed:", e);
    }
  }
}

/**
 * Find a port element under the given screen coordinates (excluding the source shape).
 */
function findPortUnder(clientX: number, clientY: number, excludeShapeId: string): { shapeId: string; side: string } | null {
  const ports = document.querySelectorAll("[data-port-shape]");
  for (const port of ports) {
    const portShapeId = port.getAttribute("data-port-shape");
    if (portShapeId === excludeShapeId) continue;

    const rect = (port as HTMLElement).getBoundingClientRect();
    const hitPadding = 16; // generous hit target
    if (
      clientX >= rect.left - hitPadding &&
      clientX <= rect.right + hitPadding &&
      clientY >= rect.top - hitPadding &&
      clientY <= rect.bottom + hitPadding
    ) {
      return {
        shapeId: portShapeId!,
        side: port.getAttribute("data-port-side") || "left",
      };
    }
  }
  return null;
}

/**
 * Highlight ports that are potential drop targets.
 */
function highlightPortsUnder(clientX: number, clientY: number, excludeShapeId: string) {
  const ports = document.querySelectorAll("[data-port-shape]");
  for (const port of ports) {
    const el = port as HTMLElement;
    const portShapeId = el.getAttribute("data-port-shape");
    if (portShapeId === excludeShapeId) {
      el.style.transform = "translateY(-50%)";
      continue;
    }

    const rect = el.getBoundingClientRect();
    const dist = Math.hypot(clientX - (rect.left + rect.width / 2), clientY - (rect.top + rect.height / 2));
    if (dist < 30) {
      el.style.transform = "translateY(-50%) scale(1.5)";
      el.style.boxShadow = "0 0 12px rgba(255,255,255,0.5)";
    } else {
      el.style.transform = "translateY(-50%)";
      el.style.boxShadow = "none";
    }
  }
}

function clearHighlights() {
  const ports = document.querySelectorAll("[data-port-shape]");
  for (const port of ports) {
    const el = port as HTMLElement;
    el.style.transform = "translateY(-50%)";
    el.style.boxShadow = "none";
  }
}
