/**
 * Port — draggable connection point. Drag from port to port to connect.
 * Uses ref callback to attach native listener that fires before tldraw.
 */

import { useEditor } from "tldraw";
import { useCallback, useRef, useState } from "react";

interface PortProps {
  side: "left" | "right";
  color: string;
  shapeId: string;
}

export function Port({ side, color, shapeId }: PortProps) {
  const editor = useEditor();
  const [hovering, setHovering] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Ref callback: fires every time the DOM element is mounted/remounted
  const portRef = useCallback((el: HTMLDivElement | null) => {
    // Cleanup previous listener
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (!el) return;

    const handleDown = (e: PointerEvent) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();

      const rect = el.getBoundingClientRect();
      const startX = rect.left + rect.width / 2;
      const startY = rect.top + rect.height / 2;

      // Overlay for drag line
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
      line.setAttribute("stroke", "#ffffff");
      line.setAttribute("stroke-width", "2.5");
      line.setAttribute("stroke-dasharray", "8 4");
      line.setAttribute("opacity", "0.8");
      svg.appendChild(line);

      const dot = document.createElementNS(svgNs, "circle");
      dot.setAttribute("r", "7");
      dot.setAttribute("fill", "#ffffff");
      dot.setAttribute("opacity", "0.7");
      svg.appendChild(dot);

      overlay.appendChild(svg);
      document.body.appendChild(overlay);

      const onMove = (ev: PointerEvent) => {
        line.setAttribute("x2", String(ev.clientX));
        line.setAttribute("y2", String(ev.clientY));
        dot.setAttribute("cx", String(ev.clientX));
        dot.setAttribute("cy", String(ev.clientY));
        highlightNearbyPorts(ev.clientX, ev.clientY, shapeId);
      };

      const onUp = (ev: PointerEvent) => {
        overlay.removeEventListener("pointermove", onMove);
        overlay.removeEventListener("pointerup", onUp);
        overlay.remove();
        clearHighlights();

        const target = findPortAt(ev.clientX, ev.clientY, shapeId);
        if (target) {
          createConnection(editor, shapeId, target.shapeId);
        }
      };

      overlay.addEventListener("pointermove", onMove);
      overlay.addEventListener("pointerup", onUp);
    };

    el.addEventListener("pointerdown", handleDown, { capture: true });
    cleanupRef.current = () => el.removeEventListener("pointerdown", handleDown, { capture: true });
  }, [editor, shapeId, side, color]);

  const isLeft = side === "left";

  return (
    <div
      ref={portRef}
      data-port-shape={shapeId}
      data-port-side={side}
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
        transition: "background 0.15s, border-color 0.15s, box-shadow 0.15s",
        boxShadow: hovering ? `0 0 8px ${color}80` : "none",
      }}
    />
  );
}

function createConnection(editor: any, fromId: string, toId: string) {
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
        props: { terminal: "start", normalizedAnchor: { x: 1, y: 0.5 }, isExact: false, isPrecise: false },
      });
      editor.createBinding({
        type: "arrow", fromId: newArrow.id, toId: toId,
        props: { terminal: "end", normalizedAnchor: { x: 0, y: 0.5 }, isExact: false, isPrecise: false },
      });
    } catch (e) {
      console.warn("[port] binding failed:", e);
    }
  }
}

function findPortAt(x: number, y: number, excludeShapeId: string) {
  for (const port of document.querySelectorAll("[data-port-shape]")) {
    const sid = port.getAttribute("data-port-shape");
    if (sid === excludeShapeId) continue;
    const r = (port as HTMLElement).getBoundingClientRect();
    if (Math.abs(x - (r.left + r.width / 2)) < 20 && Math.abs(y - (r.top + r.height / 2)) < 20) {
      return { shapeId: sid!, side: port.getAttribute("data-port-side") || "left" };
    }
  }
  return null;
}

function highlightNearbyPorts(x: number, y: number, excludeShapeId: string) {
  for (const port of document.querySelectorAll("[data-port-shape]")) {
    const el = port as HTMLElement;
    if (el.getAttribute("data-port-shape") === excludeShapeId) continue;
    const r = el.getBoundingClientRect();
    const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
    el.style.transform = d < 30 ? "translateY(-50%) scale(1.5)" : "translateY(-50%)";
    el.style.boxShadow = d < 30 ? "0 0 12px rgba(255,255,255,0.6)" : "";
  }
}

function clearHighlights() {
  for (const port of document.querySelectorAll("[data-port-shape]")) {
    const el = port as HTMLElement;
    el.style.transform = "translateY(-50%)";
    el.style.boxShadow = "";
  }
}
