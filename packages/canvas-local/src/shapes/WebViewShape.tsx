/**
 * WebView — powerful live web renderer on the canvas.
 *
 * Three modes:
 * 1. URL mode — navigate to any URL (iframe)
 * 2. HTML mode — write raw HTML/JS/CSS that renders live (srcdoc)
 *    Full WebGL/WebGPU/Canvas2D access.
 * 3. Code mode — write JS that runs in an isolated context with a canvas
 *
 * Input port receives URL (in URL mode) or data (in HTML mode via window.SVG_OS_DATA).
 */

import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  TLBaseShape,
  Vec,
  useEditor,
} from "tldraw";
import { Port } from "../Port";
import { EditableLabel } from "../EditableLabel";
import { C, FONT } from "../theme";
import { useState, useRef, useCallback, useEffect } from "react";

export type WebViewShape = TLBaseShape<
  "web-view",
  {
    w: number;
    h: number;
    url: string;
    label: string;
    mode: string;     // "url" | "html" | "code"
    htmlContent: string;  // raw HTML for html/code modes
  }
>;

export class WebViewShapeUtil extends ShapeUtil<WebViewShape> {
  static override type = "web-view" as const;

  static override props = {
    w: T.number,
    h: T.number,
    url: T.string,
    label: T.string,
    mode: T.string,
    htmlContent: T.string,
  };

  getDefaultProps(): WebViewShape["props"] {
    return {
      w: 640,
      h: 480,
      url: "https://femiadeniran.com",
      label: "WebView",
      mode: "url",
      htmlContent: WEBGL_STARTER,
    };
  }

  override getGeometry(shape: WebViewShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override canBind() { return true; }
  override canEdit() { return false; }

  override getHandleSnapGeometry(shape: WebViewShape) {
    return { points: [new Vec(0, shape.props.h / 2)] };
  }

  override component(shape: WebViewShape) {
    return <WebViewContent shape={shape} />;
  }

  override indicator(shape: WebViewShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }

  override canResize() { return true; }

  override onResize(shape: WebViewShape, info: { scaleX: number; scaleY: number }) {
    return {
      props: {
        w: Math.max(200, shape.props.w * info.scaleX),
        h: Math.max(150, shape.props.h * info.scaleY),
      },
    };
  }
}

// ── WebGL starter template ───────────────────────────────────────────────────

const WEBGL_STARTER = `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; }
  body { background: #000; overflow: hidden; }
  canvas { display: block; width: 100vw; height: 100vh; }
</style>
</head>
<body>
<canvas id="c"></canvas>
<script>
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
canvas.width = canvas.clientWidth;
canvas.height = canvas.clientHeight;

const vs = \`#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0, 1);
}\`;

const fs = \`#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 color;
uniform float u_time;
void main() {
  vec2 uv = v_uv;
  float t = u_time * 0.5;
  float v = sin(uv.x * 10.0 + t) + sin(uv.y * 10.0 + t * 0.7);
  v += sin((uv.x + uv.y) * 10.0 + t * 1.3);
  v += sin(length(uv - 0.5) * 15.0 - t * 2.0);
  v *= 0.25;
  color = vec4(
    0.5 + 0.5 * sin(v * 3.14159 + 0.0),
    0.5 + 0.5 * sin(v * 3.14159 + 2.094),
    0.5 + 0.5 * sin(v * 3.14159 + 4.188),
    1.0
  );
}\`;

function createShader(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return s;
}

const prog = gl.createProgram();
gl.attachShader(prog, createShader(gl.VERTEX_SHADER, vs));
gl.attachShader(prog, createShader(gl.FRAGMENT_SHADER, fs));
gl.linkProgram(prog);
gl.useProgram(prog);

const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
const loc = gl.getAttribLocation(prog, 'a_pos');
gl.enableVertexAttribArray(loc);
gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

const uTime = gl.getUniformLocation(prog, 'u_time');
const start = performance.now();

function frame() {
  gl.uniform1f(uTime, (performance.now() - start) / 1000);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  requestAnimationFrame(frame);
}
frame();
</script>
</body>
</html>`;

// ── Component ────────────────────────────────────────────────────────────────

function WebViewContent({ shape }: { shape: WebViewShape }) {
  const editor = useEditor();
  const { w, h, url, label, mode, htmlContent } = shape.props;
  const [localUrl, setLocalUrl] = useState(url);
  const [activeUrl, setActiveUrl] = useState(url);
  const [editingHtml, setEditingHtml] = useState(false);
  const [localHtml, setLocalHtml] = useState(htmlContent);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Sync URL from props (upstream data flow)
  if (url !== activeUrl && url !== localUrl) {
    setLocalUrl(url);
    setActiveUrl(url);
  }
  if (htmlContent !== localHtml && !editingHtml) {
    setLocalHtml(htmlContent);
  }

  const normalizeUrl = (raw: string): string => {
    let u = raw.trim();
    if (!u) return "about:blank";
    if (!u.startsWith("http://") && !u.startsWith("https://") && !u.startsWith("about:")) {
      if (u.includes(".") && !u.includes(" ")) {
        u = "https://" + u;
      } else {
        u = `https://www.google.com/search?igu=1&q=${encodeURIComponent(u)}`;
      }
    }
    return u;
  };

  const commitUrl = (newUrl: string) => {
    const normalized = normalizeUrl(newUrl);
    setActiveUrl(normalized);
    setLocalUrl(newUrl);
    editor.updateShape({ id: shape.id as any, type: "web-view", props: { url: normalized } });
  };

  const commitHtml = (html: string) => {
    setLocalHtml(html);
    editor.updateShape({ id: shape.id as any, type: "web-view", props: { htmlContent: html } });
    setEditingHtml(false);
  };

  const switchMode = (newMode: string) => {
    editor.updateShape({ id: shape.id as any, type: "web-view", props: { mode: newMode } });
  };

  const refresh = () => {
    if (mode === "url") {
      setActiveUrl("about:blank");
      setTimeout(() => setActiveUrl(normalizeUrl(localUrl)), 100);
    } else {
      const cur = localHtml;
      setLocalHtml("");
      setTimeout(() => setLocalHtml(cur), 50);
    }
  };

  // Capture-phase for textarea
  const cleanupRef = useRef<(() => void) | null>(null);
  const textareaRef = useCallback((el: HTMLTextAreaElement | null) => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    if (!el) return;
    const handler = (e: PointerEvent) => { e.stopPropagation(); e.stopImmediatePropagation(); };
    el.addEventListener("pointerdown", handler, { capture: true });
    cleanupRef.current = () => el.removeEventListener("pointerdown", handler, { capture: true });
  }, []);

  const barHeight = 32;
  const isHtmlMode = mode === "html" || mode === "code";

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: "all", position: "relative", overflow: "hidden", borderRadius: 8 }}>
      <Port side="left" type="text" name="url" shapeId={shape.id} />
      <div data-webview-id={shape.id} style={{
        width: "100%", height: "100%",
        display: "flex", flexDirection: "column",
        background: C.bg, border: `1px solid ${C.border}`,
        borderRadius: 8, overflow: "hidden",
        fontFamily: FONT.sans,
        boxShadow: "0 2px 12px rgba(0,0,0,0.35)",
      }}>
        {/* Top bar — always draggable by tldraw */}
        <div style={{
          height: barHeight, display: "flex", alignItems: "center",
          gap: 4, padding: "0 6px",
          background: C.bgAlt, borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}>
          {/* Traffic lights */}
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", marginRight: 1 }} />
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b", marginRight: 1 }} />
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", marginRight: 4 }} />

          {/* Refresh */}
          <button
            onClick={(e) => { e.stopPropagation(); refresh(); }}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", fontSize: 11, padding: "0 2px" }}
          >{"\u21BB"}</button>

          {/* Mode tabs */}
          {(["url", "html", "code"] as const).map(m => (
            <button key={m}
              onClick={(e) => { e.stopPropagation(); switchMode(m); }}
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                background: mode === m ? `${C.accent}22` : "transparent",
                border: mode === m ? `1px solid ${C.accent}44` : "1px solid transparent",
                borderRadius: 3, color: mode === m ? C.accent : C.dim,
                fontSize: 9, padding: "1px 6px", cursor: "pointer",
                fontFamily: FONT.mono, textTransform: "uppercase", letterSpacing: "0.05em",
              }}
            >{m}</button>
          ))}

          {/* URL bar (only in URL mode) */}
          {mode === "url" && (
            <input
              type="text"
              value={localUrl}
              onChange={(e) => setLocalUrl(e.target.value)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commitUrl(localUrl); }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => { if (localUrl !== activeUrl) commitUrl(localUrl); }}
              placeholder="URL or search..."
              style={{
                flex: 1, padding: "2px 6px",
                background: C.bgDeep, border: `1px solid ${C.border}`,
                borderRadius: 3, color: C.fg, fontSize: 10,
                fontFamily: FONT.sans, outline: "none",
              }}
            />
          )}

          {/* Edit button (HTML/Code mode) */}
          {isHtmlMode && (
            <>
              <span style={{ flex: 1, fontSize: 9, color: C.faint, fontFamily: FONT.mono, textAlign: "center" }}>
                {mode === "html" ? "HTML" : "Canvas JS"} {editingHtml ? "— editing" : ""}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); setEditingHtml(!editingHtml); if (editingHtml) commitHtml(localHtml); }}
                onPointerDown={(e) => e.stopPropagation()}
                style={{
                  background: editingHtml ? C.accent : "transparent",
                  border: `1px solid ${editingHtml ? C.accent : C.border}`,
                  borderRadius: 3, color: editingHtml ? C.bg : C.faint,
                  fontSize: 9, padding: "1px 8px", cursor: "pointer",
                  fontFamily: FONT.mono,
                }}
              >{editingHtml ? "Run" : "Edit"}</button>
            </>
          )}
        </div>

        {/* Content area */}
        {editingHtml && isHtmlMode ? (
          <textarea
            ref={textareaRef}
            value={localHtml}
            onChange={(e) => setLocalHtml(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                commitHtml(localHtml);
              }
            }}
            style={{
              flex: 1, padding: 8,
              background: C.bgDeep, border: "none",
              color: C.fg, fontSize: 11,
              fontFamily: FONT.mono, resize: "none",
              outline: "none", lineHeight: 1.5,
            }}
          />
        ) : (
          <iframe
            ref={iframeRef}
            src={mode === "url" ? activeUrl : undefined}
            srcDoc={mode !== "url" ? localHtml : undefined}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-top-navigation allow-presentation allow-downloads"
            allow="accelerometer; camera; encrypted-media; fullscreen; geolocation; gyroscope; microphone; midi; payment; usb; xr-spatial-tracking; webgl; webgl2"
            style={{
              border: "none",
              width: "100%",
              flex: 1,
              background: mode === "url" ? "#ffffff" : "#000000",
            }}
            title={mode === "url" ? `WebView: ${activeUrl}` : "WebView: HTML"}
          />
        )}
      </div>
    </HTMLContainer>
  );
}
