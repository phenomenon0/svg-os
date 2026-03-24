/**
 * MediaNode — inline media player for images, video, and audio.
 * Drop files directly onto the node or connect a URL from upstream.
 * Outputs base64/blob URL on data port and metadata on meta port.
 */

import {
  HTMLContainer, Rectangle2d, ShapeUtil, T, TLBaseShape, Vec, useEditor,
} from "tldraw";
import { useCallback, useState, useRef } from "react";
import { Port } from "../Port";
import { TitleBar } from "../TitleBar";
import { C, FONT, nodeContainerStyle } from "../theme";

export type MediaNodeShape = TLBaseShape<
  "media-node",
  {
    w: number;
    h: number;
    label: string;
    mediaType: string; // "image" | "video" | "audio" | "none"
    src: string;       // data URL, blob URL, or remote URL
    filename: string;
    mimeType: string;
    fileSize: number;
  }
>;

export class MediaNodeShapeUtil extends ShapeUtil<MediaNodeShape> {
  static override type = "media-node" as const;
  static override props = {
    w: T.number, h: T.number, label: T.string,
    mediaType: T.string, src: T.string,
    filename: T.string, mimeType: T.string, fileSize: T.number,
  };

  getDefaultProps(): MediaNodeShape["props"] {
    return {
      w: 320, h: 260, label: "Media",
      mediaType: "none", src: "", filename: "", mimeType: "", fileSize: 0,
    };
  }

  override getGeometry(shape: MediaNodeShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override canBind() { return true; }
  override canEdit() { return false; }

  override getHandleSnapGeometry(shape: MediaNodeShape) {
    return { points: [new Vec(0, shape.props.h / 2), new Vec(shape.props.w, shape.props.h / 2)] };
  }

  override component(shape: MediaNodeShape) { return <MediaComponent shape={shape} />; }

  override indicator(shape: MediaNodeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }

  override canResize() { return true; }

  override onResize(shape: MediaNodeShape, info: { scaleX: number; scaleY: number }) {
    return { props: { w: Math.max(120, shape.props.w * info.scaleX), h: Math.max(80, shape.props.h * info.scaleY) } };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function detectMediaType(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "none";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Component ────────────────────────────────────────────────────────────────

function MediaComponent({ shape }: { shape: MediaNodeShape }) {
  const editor = useEditor();
  const { w, h, label, mediaType, src, filename, mimeType, fileSize } = shape.props;
  const [dragOver, setDragOver] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const updateMedia = useCallback(async (file: File) => {
    const dataUrl = await readFileAsDataUrl(file);
    const type = detectMediaType(file.type);
    editor.updateShape({
      id: shape.id, type: "media-node",
      props: {
        src: dataUrl,
        mediaType: type,
        filename: file.name,
        mimeType: file.type,
        fileSize: file.size,
        label: file.name.split(".").slice(0, -1).join(".") || file.name,
      },
    });
  }, [editor, shape.id]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) updateMedia(file);
  }, [updateMedia]);

  const barHeight = 32;
  const contentH = h - barHeight;
  const hasMedia = mediaType !== "none" && src;

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
      <div
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        style={{
          ...nodeContainerStyle,
          border: dragOver ? `2px solid ${C.accent}` : `1px solid ${C.border}`,
        }}
      >
        <TitleBar label={label} color={C.pink} onChange={(v) => editor.updateShape({ id: shape.id, type: "media-node", props: { label: v } })}>
          {hasMedia && (
            <span style={{ fontSize: 8, color: C.faint, fontFamily: FONT.mono }}>
              {mediaType.toUpperCase()} {formatSize(fileSize)}
            </span>
          )}
        </TitleBar>

        <div style={{
          flex: 1, overflow: "hidden", display: "flex",
          alignItems: "center", justifyContent: "center",
          background: C.bgDeep,
        }}>
          {!hasMedia ? (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
              color: C.dim, fontSize: 11, fontFamily: FONT.mono,
            }}>
              <span style={{ fontSize: 24, opacity: 0.3 }}>&#128247;</span>
              <span>Drop image, video, or audio</span>
              <span style={{ fontSize: 9, color: C.faint }}>or connect a URL upstream</span>
            </div>
          ) : mediaType === "image" ? (
            <img
              src={src}
              alt={filename}
              style={{
                maxWidth: "100%", maxHeight: contentH,
                objectFit: "contain",
              }}
              draggable={false}
            />
          ) : mediaType === "video" ? (
            <video
              ref={videoRef}
              src={src}
              controls
              style={{ maxWidth: "100%", maxHeight: contentH }}
              onPointerDown={(e) => e.stopPropagation()}
            />
          ) : mediaType === "audio" ? (
            <div style={{ padding: 16, width: "100%", textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>&#9835;</div>
              <div style={{ color: C.fgSoft, fontSize: 11, marginBottom: 8 }}>{filename}</div>
              <audio
                src={src}
                controls
                style={{ width: "90%" }}
                onPointerDown={(e) => e.stopPropagation()}
              />
            </div>
          ) : null}
        </div>

        {hasMedia && (
          <div style={{
            height: 20, padding: "0 8px",
            borderTop: `1px solid ${C.borderSoft}`,
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 8, color: C.faint, fontFamily: FONT.mono,
          }}>
            <span>{filename}</span>
            <span style={{ flex: 1 }} />
            <span>{mimeType}</span>
          </div>
        )}

        <Port side="left" type="any" name="in" shapeId={shape.id} />
        <Port side="left" type="text" name="url" shapeId={shape.id} index={1} total={2} />
        <Port side="right" type="data" name="data" shapeId={shape.id} />
        <Port side="right" type="data" name="meta" shapeId={shape.id} index={1} total={2} />
      </div>
    </HTMLContainer>
  );
}
