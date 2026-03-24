import { useRef, useCallback } from "react";

export function usePointerCapture<T extends HTMLElement>(): (el: T | null) => void {
  const cleanupRef = useRef<(() => void) | null>(null);
  return useCallback((el: T | null) => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    if (!el) return;
    const handler = (e: PointerEvent) => { e.stopPropagation(); e.stopImmediatePropagation(); };
    el.addEventListener("pointerdown", handler, { capture: true });
    cleanupRef.current = () => el.removeEventListener("pointerdown", handler, { capture: true });
  }, []);
}
