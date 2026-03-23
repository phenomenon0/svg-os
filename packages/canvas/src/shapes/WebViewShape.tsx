/**
 * WebView — renders a live iframe of any URL inside the canvas.
 * Includes a URL bar at the top for navigation.
 * Input port on the left (cyan) for receiving URL data from upstream.
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
import { useState } from "react";

export type WebViewShape = TLBaseShape<
  "web-view",
  {
    w: number;
    h: number;
    url: string;
    label: string;
  }
>;

export class WebViewShapeUtil extends ShapeUtil<WebViewShape> {
  static override type = "web-view" as const;

  static override props = {
    w: T.number,
    h: T.number,
    url: T.string,
    label: T.string,
  };

  getDefaultProps(): WebViewShape["props"] {
    return {
      w: 480,
      h: 360,
      url: "https://en.wikipedia.org/wiki/Emergence",
      label: "WebView",
    };
  }

  override getGeometry(shape: WebViewShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override canBind() {
    return true;
  }

  override getHandleSnapGeometry(shape: WebViewShape) {
    return {
      points: [new Vec(0, shape.props.h / 2)],
    };
  }

  override component(shape: WebViewShape) {
    const { w, h, url } = shape.props;

    return (
      <HTMLContainer
        style={{
          width: w,
          height: h,
          pointerEvents: "all",
          position: "relative",
          overflow: "hidden",
          borderRadius: 8,
        }}
      >
        <Port side="left" type="text" name="url" shapeId={shape.id} />
        <WebViewContent w={w} h={h} url={url} shapeId={shape.id} />
      </HTMLContainer>
    );
  }

  override indicator(shape: WebViewShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }

  override canResize() {
    return true;
  }

  override onResize(shape: WebViewShape, info: { scaleX: number; scaleY: number }) {
    return {
      props: {
        w: Math.max(200, shape.props.w * info.scaleX),
        h: Math.max(150, shape.props.h * info.scaleY),
      },
    };
  }
}

function WebViewContent({
  w,
  h,
  url,
  shapeId,
}: {
  w: number;
  h: number;
  url: string;
  shapeId: string;
}) {
  const editor = useEditor();
  const [localUrl, setLocalUrl] = useState(url);
  const [activeUrl, setActiveUrl] = useState(url);
  // Proxy removed — no reliable CORS proxy for iframe embedding.
  // WebView works with: localhost, Wikipedia, MDN, CodePen, docs sites.

  if (url !== activeUrl && url !== localUrl) {
    setLocalUrl(url);
    setActiveUrl(url);
  }

  const normalizeUrl = (raw: string): string => {
    let u = raw.trim();
    if (!u) return "about:blank";
    // If it looks like a domain (has a dot, no spaces), add https://
    if (!u.startsWith("http://") && !u.startsWith("https://") && !u.startsWith("about:")) {
      if (u.includes(".") && !u.includes(" ")) {
        u = "https://" + u;
      } else {
        // Treat as search query
        u = `https://www.google.com/search?igu=1&q=${encodeURIComponent(u)}`;
      }
    }
    return u;
  };

  const commitUrl = (newUrl: string) => {
    const normalized = normalizeUrl(newUrl);
    setActiveUrl(normalized);
    setLocalUrl(newUrl);
    editor.updateShape({ id: shapeId as any, type: "web-view", props: { url: normalized } });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      commitUrl(localUrl);
    }
  };

  const refresh = () => {
    setActiveUrl("about:blank");
    setTimeout(() => setActiveUrl(normalizeUrl(localUrl)), 100);
  };

  const iframeSrc = activeUrl;

  const urlBarHeight = 32;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#0f172a",
        border: "1px solid #334155",
        borderRadius: 8,
        overflow: "hidden",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          height: urlBarHeight,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 8px",
          background: "#1e293b",
          borderBottom: "1px solid #334155",
          flexShrink: 0,
        }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); refresh(); }}
          onPointerDown={(e) => e.stopPropagation()}
          style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 12, padding: "0 2px", flexShrink: 0 }}
          title="Refresh"
        >↻</button>
        <input
          type="text"
          value={localUrl}
          onChange={(e) => setLocalUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => { if (localUrl !== activeUrl) commitUrl(localUrl); }}
          placeholder="Type URL or search..."
          style={{
            flex: 1,
            padding: "3px 8px",
            background: "#0f172a",
            border: "1px solid #334155",
            borderRadius: 4,
            color: "#e2e8f0",
            fontSize: 11,
            fontFamily: "'Inter', system-ui, sans-serif",
            outline: "none",
          }}
        />
      </div>
      <iframe
        src={iframeSrc}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation allow-modals allow-presentation allow-downloads"
        style={{
          border: "none",
          width: "100%",
          height: `calc(100% - ${urlBarHeight}px)`,
          background: "#ffffff",
        }}
        title={`WebView: ${activeUrl}`}
      />
    </div>
  );
}
