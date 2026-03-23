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
      url: "https://example.com",
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
        <Port side="left" color="#06b6d4" shapeId={shape.id} />
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

  if (url !== activeUrl && url !== localUrl) {
    setLocalUrl(url);
    setActiveUrl(url);
  }

  const commitUrl = (newUrl: string) => {
    setActiveUrl(newUrl);
    editor.updateShape({ id: shapeId as any, type: "web-view", props: { url: newUrl } });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      commitUrl(localUrl);
    }
  };

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
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#06b6d4",
            flexShrink: 0,
          }}
        />
        <input
          type="text"
          value={localUrl}
          onChange={(e) => setLocalUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => { if (localUrl !== activeUrl) commitUrl(localUrl); }}
          placeholder="https://example.com"
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
        src={activeUrl}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
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
