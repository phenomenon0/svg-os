/**
 * CollabOverlay — full collaboration UI layer.
 *
 * Components:
 *  - UserIdentityModal: first-visit name/color picker
 *  - RoomBar: top bar with room info, users, chat toggle, share
 *  - RemoteCursors: smooth interpolated cursors for remote users
 *  - SelectionIndicators: colored outlines on remotely-selected shapes
 *  - ChatPanel: Slack-style chat drawer
 *  - ToastNotifications: join/leave toasts
 */

import { useEditor } from "tldraw";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  getCollabClient,
  getDocIdFromUrl,
  getOrCreateIdentity,
  hasIdentity,
  saveIdentity,
  type CollabUser,
  type ChatMessage,
  type ConnectionState,
  type UserIdentity,
} from "./lib/collab-client";
import { C, FONT } from "./theme";

// ── Constants ────────────────────────────────────────────────────────────────

const PALETTE = ["#6a9fcf", "#7eb59d", "#e6a756", "#cf7a9a", "#a78bca", "#d4946a"];
const CURSOR_FADE_MS = 5000;
const TOAST_DURATION = 3000;
const MAX_TOASTS = 3;

// ── Utility ──────────────────────────────────────────────────────────────────

function relativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function stopAll(e: React.SyntheticEvent): void {
  e.stopPropagation();
}

// ── Toast Type ───────────────────────────────────────────────────────────────

interface Toast {
  id: string;
  text: string;
  color: string;
  createdAt: number;
}

// =============================================================================
//  UserIdentityModal
// =============================================================================

function UserIdentityModal({ onJoin }: { onJoin: (identity: UserIdentity) => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleJoin = () => {
    const trimmed = name.trim() || `User ${Math.floor(Math.random() * 1000)}`;
    const identity: UserIdentity = {
      id: crypto.randomUUID(),
      name: trimmed,
      color,
    };
    saveIdentity(identity);
    onJoin(identity);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
        fontFamily: FONT.sans,
      }}
      onPointerDown={stopAll}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div
        style={{
          background: C.bgCard,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: "28px 32px",
          width: 320,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, color: C.fg, marginBottom: 4 }}>
          Join Collaboration
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>
          Pick a name and color so others can see you.
        </div>

        <label style={{ fontSize: 11, color: C.muted, fontWeight: 500, display: "block", marginBottom: 6 }}>
          Your name
        </label>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") handleJoin();
          }}
          placeholder="What should we call you?"
          maxLength={24}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "8px 12px",
            background: C.bgDeep,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            color: C.fg,
            fontSize: 13,
            fontFamily: FONT.sans,
            outline: "none",
            marginBottom: 16,
          }}
        />

        <label style={{ fontSize: 11, color: C.muted, fontWeight: 500, display: "block", marginBottom: 8 }}>
          Your color
        </label>
        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          {PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: c,
                border: color === c ? `2px solid ${C.fg}` : `2px solid transparent`,
                cursor: "pointer",
                transition: "border-color 0.15s, transform 0.15s",
                transform: color === c ? "scale(1.15)" : "scale(1)",
                outline: "none",
              }}
            />
          ))}
        </div>

        <button
          onClick={handleJoin}
          style={{
            width: "100%",
            padding: "10px 0",
            background: color,
            border: "none",
            borderRadius: 6,
            color: "#000",
            fontSize: 13,
            fontWeight: 600,
            fontFamily: FONT.sans,
            cursor: "pointer",
            letterSpacing: "0.02em",
          }}
        >
          Join
        </button>
      </div>
    </div>
  );
}

// =============================================================================
//  RoomBar
// =============================================================================

function RoomBar({
  roomName,
  identity,
  users,
  myId,
  connectionState,
  chatOpen,
  unreadCount,
  onToggleChat,
  onIdentityUpdate,
}: {
  roomName: string;
  identity: UserIdentity;
  users: CollabUser[];
  myId: string;
  connectionState: ConnectionState;
  chatOpen: boolean;
  unreadCount: number;
  onToggleChat: () => void;
  onIdentityUpdate: (name: string, color: string) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(identity.name);
  const [copied, setCopied] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const remoteUsers = users.filter((u) => u.id !== myId);
  const onlineCount = users.length;

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus();
  }, [editingName]);

  const connDot =
    connectionState === "connected" ? "#22c55e"
    : connectionState === "reconnecting" ? "#eab308"
    : connectionState === "connecting" ? "#eab308"
    : "#ef4444";

  const handleNameSave = () => {
    const trimmed = nameInput.trim();
    if (trimmed && trimmed !== identity.name) {
      onIdentityUpdate(trimmed, identity.color);
    }
    setEditingName(false);
  };

  const handleShare = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomName);
    navigator.clipboard.writeText(url.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const barStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    left: 180,
    right: 0,
    height: 32,
    background: C.bgAlt,
    borderBottom: `1px solid ${C.border}`,
    display: "flex",
    alignItems: "center",
    gap: 0,
    fontFamily: FONT.sans,
    fontSize: 11,
    color: C.muted,
    zIndex: 1000,
    pointerEvents: "all",
    paddingLeft: 12,
    paddingRight: 12,
    userSelect: "none",
  };

  const sepStyle: React.CSSProperties = {
    width: 1,
    height: 16,
    background: C.border,
    margin: "0 10px",
    flexShrink: 0,
  };

  return (
    <div style={barStyle} onPointerDown={stopAll}>
      {/* Connection dot */}
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: connDot, flexShrink: 0 }} />
      <span style={{ marginLeft: 6, fontFamily: FONT.mono, fontSize: 11, color: C.fgSoft }}>
        {roomName}
      </span>

      <div style={sepStyle} />

      {/* User identity */}
      {editingName ? (
        <input
          ref={nameInputRef}
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onBlur={handleNameSave}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") handleNameSave();
            if (e.key === "Escape") { setNameInput(identity.name); setEditingName(false); }
          }}
          maxLength={24}
          style={{
            width: 100,
            padding: "2px 6px",
            background: C.bgDeep,
            border: `1px solid ${C.accent}`,
            borderRadius: 3,
            color: C.fg,
            fontSize: 11,
            fontFamily: FONT.sans,
            outline: "none",
          }}
        />
      ) : (
        <button
          onClick={() => { setNameInput(identity.name); setEditingName(true); }}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "2px 4px",
            borderRadius: 3,
          }}
          title="Click to edit name"
        >
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: identity.color }} />
          <span style={{ color: C.fgSoft, fontSize: 11, fontFamily: FONT.sans }}>{identity.name}</span>
        </button>
      )}

      <div style={sepStyle} />

      {/* Online count */}
      <div
        style={{ position: "relative", display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}
        onMouseEnter={() => setShowUsers(true)}
        onMouseLeave={() => setShowUsers(false)}
      >
        <span style={{ fontSize: 10 }}>
          {onlineCount} online
        </span>

        {/* User list dropdown */}
        {showUsers && remoteUsers.length > 0 && (
          <div
            style={{
              position: "absolute",
              top: 24,
              left: 0,
              background: C.bgCard,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: 8,
              minWidth: 140,
              boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
              zIndex: 1001,
            }}
          >
            {remoteUsers.map((u) => (
              <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: u.color }} />
                <span style={{ fontSize: 11, color: C.fgSoft }}>{u.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={sepStyle} />

      {/* Chat toggle */}
      <button
        onClick={onToggleChat}
        style={{
          background: chatOpen ? `${C.accent}22` : "transparent",
          border: `1px solid ${chatOpen ? C.accent + "55" : C.border}`,
          borderRadius: 4,
          color: chatOpen ? C.accent : C.muted,
          fontSize: 10,
          padding: "2px 8px",
          cursor: "pointer",
          fontFamily: FONT.sans,
          fontWeight: 500,
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        Chat
        {unreadCount > 0 && (
          <span
            style={{
              background: C.accent,
              color: "#000",
              fontSize: 9,
              fontWeight: 700,
              borderRadius: 8,
              padding: "0 5px",
              lineHeight: "16px",
              minWidth: 16,
              textAlign: "center",
            }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      <div style={sepStyle} />

      {/* Share */}
      <button
        onClick={handleShare}
        style={{
          background: "transparent",
          border: `1px solid ${C.border}`,
          borderRadius: 4,
          color: copied ? C.green : C.muted,
          fontSize: 10,
          padding: "2px 8px",
          cursor: "pointer",
          fontFamily: FONT.sans,
          fontWeight: 500,
          transition: "color 0.2s",
        }}
      >
        {copied ? "Copied!" : "Share"}
      </button>
    </div>
  );
}

// =============================================================================
//  RemoteCursors — smooth interpolation via rAF
// =============================================================================

interface InterpolatedCursor {
  targetX: number;
  targetY: number;
  currentX: number;
  currentY: number;
  lastUpdate: number;
}

function RemoteCursors({ users, myId }: { users: CollabUser[]; myId: string }) {
  const editor = useEditor();
  const cursorsRef = useRef<Map<string, InterpolatedCursor>>(new Map());
  const [, forceRender] = useState(0);
  const rafRef = useRef<number>(0);

  // Update target positions when presence changes
  useEffect(() => {
    const map = cursorsRef.current;
    for (const user of users) {
      if (user.id === myId || !user.cursor) continue;
      let entry = map.get(user.id);
      if (!entry) {
        const screen = editor.pageToScreen(user.cursor);
        entry = {
          targetX: screen.x,
          targetY: screen.y,
          currentX: screen.x,
          currentY: screen.y,
          lastUpdate: Date.now(),
        };
        map.set(user.id, entry);
      } else {
        const screen = editor.pageToScreen(user.cursor);
        entry.targetX = screen.x;
        entry.targetY = screen.y;
        entry.lastUpdate = Date.now();
      }
    }
    // Remove cursors for users who left
    const activeIds = new Set(users.filter((u) => u.id !== myId && u.cursor).map((u) => u.id));
    for (const id of map.keys()) {
      if (!activeIds.has(id)) map.delete(id);
    }
  }, [users, myId, editor]);

  // Animation loop
  useEffect(() => {
    const animate = () => {
      const map = cursorsRef.current;
      let moved = false;
      for (const entry of map.values()) {
        const dx = entry.targetX - entry.currentX;
        const dy = entry.targetY - entry.currentY;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          entry.currentX += dx * 0.3;
          entry.currentY += dy * 0.3;
          moved = true;
        }
      }
      if (moved) forceRender((n) => n + 1);
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Also update screen positions when camera moves
  useEffect(() => {
    const unsub = editor.store.listen(() => {
      const map = cursorsRef.current;
      for (const user of users) {
        if (user.id === myId || !user.cursor) continue;
        const entry = map.get(user.id);
        if (entry) {
          const screen = editor.pageToScreen(user.cursor);
          entry.targetX = screen.x;
          entry.targetY = screen.y;
        }
      }
    }, { source: "all", scope: "session" });
    return unsub;
  }, [editor, users, myId]);

  const remoteUsers = users.filter((u) => u.id !== myId && u.cursor);

  return (
    <>
      {remoteUsers.map((user) => {
        const entry = cursorsRef.current.get(user.id);
        if (!entry) return null;
        const elapsed = Date.now() - entry.lastUpdate;
        const opacity = elapsed > CURSOR_FADE_MS ? 0 : elapsed > CURSOR_FADE_MS - 1000 ? (CURSOR_FADE_MS - elapsed) / 1000 : 1;

        return (
          <div
            key={user.id}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              transform: `translate(${entry.currentX}px, ${entry.currentY}px)`,
              pointerEvents: "none",
              zIndex: 999,
              opacity,
              transition: "opacity 0.3s ease",
            }}
          >
            {/* SVG cursor arrow */}
            <svg width="16" height="20" viewBox="0 0 16 20" fill="none" style={{ display: "block" }}>
              <path
                d="M0.5 0.5L15 11.5L7.5 11.5L3.75 19L0.5 0.5Z"
                fill={user.color}
                stroke="#000"
                strokeWidth="1"
                strokeLinejoin="round"
              />
            </svg>
            {/* Name pill */}
            <div
              style={{
                marginLeft: 14,
                marginTop: -2,
                background: user.color,
                color: "#000",
                fontSize: 10,
                fontFamily: FONT.sans,
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: 4,
                whiteSpace: "nowrap",
                lineHeight: "16px",
                boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
              }}
            >
              {user.name}
            </div>
          </div>
        );
      })}
    </>
  );
}

// =============================================================================
//  SelectionIndicators — colored outlines on remotely-selected shapes
// =============================================================================

function SelectionIndicators({ users, myId }: { users: CollabUser[]; myId: string }) {
  const editor = useEditor();
  const [, forceRender] = useState(0);

  // Re-render when camera changes so outlines follow shapes
  useEffect(() => {
    const unsub = editor.store.listen(() => {
      forceRender((n) => n + 1);
    }, { source: "all", scope: "session" });
    return unsub;
  }, [editor]);

  const remoteSelections = users.filter(
    (u) => u.id !== myId && u.selectedShapeIds.length > 0
  );

  return (
    <>
      {remoteSelections.map((user) =>
        user.selectedShapeIds.map((shapeId) => {
          try {
            const geo = editor.getShapeGeometry(shapeId as any);
            if (!geo) return null;
            const bounds = geo.bounds;
            const pagePoint = editor.getShapePageTransform(shapeId as any);
            if (!pagePoint) return null;

            const topLeft = editor.pageToScreen({ x: pagePoint.x() + bounds.x, y: pagePoint.y() + bounds.y });
            const bottomRight = editor.pageToScreen({
              x: pagePoint.x() + bounds.x + bounds.w,
              y: pagePoint.y() + bounds.y + bounds.h,
            });

            const w = bottomRight.x - topLeft.x;
            const h = bottomRight.y - topLeft.y;

            return (
              <div
                key={`${user.id}-${shapeId}`}
                style={{
                  position: "absolute",
                  left: topLeft.x - 2,
                  top: topLeft.y - 2,
                  width: w + 4,
                  height: h + 4,
                  border: `2px dashed ${user.color}`,
                  borderRadius: 4,
                  pointerEvents: "none",
                  zIndex: 998,
                  opacity: 0.6,
                }}
              />
            );
          } catch {
            return null;
          }
        })
      )}
    </>
  );
}

// =============================================================================
//  ChatPanel
// =============================================================================

function ChatPanel({
  roomName,
  messages,
  users,
  myId,
  onSend,
  onClose,
  onTyping,
}: {
  roomName: string;
  messages: ChatMessage[];
  users: CollabUser[];
  myId: string;
  onSend: (text: string) => void;
  onClose: () => void;
  onTyping: (isTyping: boolean) => void;
}) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInput("");
    onTyping(false);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    onTyping(true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => onTyping(false), 2000);
  };

  const typingUsers = users.filter((u) => u.id !== myId && u.isTyping);

  // Group consecutive messages by same user
  const grouped = useMemo(() => {
    const groups: { user: string; color: string; messages: ChatMessage[] }[] = [];
    for (const msg of messages) {
      const last = groups[groups.length - 1];
      if (last && last.user === msg.user_name) {
        last.messages.push(msg);
      } else {
        groups.push({ user: msg.user_name, color: msg.user_color || C.accent, messages: [msg] });
      }
    }
    return groups;
  }, [messages]);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        width: 300,
        height: 400,
        background: C.bgCard,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        zIndex: 1001,
        pointerEvents: "all",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: FONT.sans,
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}
      onPointerDown={stopAll}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div
        style={{
          height: 36,
          padding: "0 12px",
          background: C.bgAlt,
          borderBottom: `1px solid ${C.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: C.fgSoft }}>
          Chat — {roomName}
        </span>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: C.muted,
            cursor: "pointer",
            fontSize: 14,
            padding: "0 2px",
            lineHeight: 1,
          }}
          title="Close chat"
        >
          ×
        </button>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "8px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {grouped.map((group, gi) => (
          <div key={gi}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: group.color }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: group.color }}>{group.user}</span>
              {group.messages[0].timestamp && (
                <span style={{ fontSize: 9, color: C.faint, marginLeft: "auto" }}>
                  {relativeTime(group.messages[0].timestamp)}
                </span>
              )}
            </div>
            {group.messages.map((msg, mi) => (
              <div key={mi} style={{ fontSize: 12, lineHeight: 1.5, color: C.fgSoft, paddingLeft: 11 }}>
                {msg.text}
              </div>
            ))}
          </div>
        ))}

        {/* Typing indicator */}
        {typingUsers.length > 0 && (
          <div style={{ fontSize: 10, color: C.faint, fontStyle: "italic", padding: "2px 0" }}>
            {typingUsers.map((u) => u.name).join(", ")}{" "}
            {typingUsers.length === 1 ? "is" : "are"} typing...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div
        style={{
          padding: 8,
          borderTop: `1px solid ${C.border}`,
          display: "flex",
          gap: 6,
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") handleSend();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder="Type a message..."
          style={{
            flex: 1,
            padding: "6px 10px",
            background: C.bgDeep,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            color: C.fg,
            fontSize: 12,
            outline: "none",
            fontFamily: FONT.sans,
          }}
        />
        <button
          onClick={handleSend}
          style={{
            background: input.trim() ? C.accent : C.dim,
            border: "none",
            borderRadius: 6,
            color: "#000",
            fontSize: 11,
            fontWeight: 600,
            padding: "0 12px",
            cursor: input.trim() ? "pointer" : "default",
            fontFamily: FONT.sans,
            transition: "background 0.15s",
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

// =============================================================================
//  ToastNotifications
// =============================================================================

function ToastNotifications({ toasts }: { toasts: Toast[] }) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        zIndex: 10001,
        pointerEvents: "none",
      }}
    >
      {toasts.slice(-MAX_TOASTS).map((toast) => (
        <div
          key={toast.id}
          style={{
            background: C.bgCard,
            border: `1px solid ${toast.color}44`,
            borderRadius: 6,
            padding: "6px 14px",
            fontSize: 11,
            fontFamily: FONT.sans,
            color: C.fgSoft,
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            animation: "collabToastIn 0.2s ease",
          }}
        >
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: toast.color }} />
          {toast.text}
        </div>
      ))}
    </div>
  );
}

// =============================================================================
//  CollabOverlay — main export
// =============================================================================

export function CollabOverlay() {
  const editor = useEditor();
  const [showIdentityModal, setShowIdentityModal] = useState(!hasIdentity());
  const [users, setUsers] = useState<CollabUser[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [identity, setIdentity] = useState<UserIdentity>(getOrCreateIdentity);
  const clientRef = useRef(getCollabClient());
  const myIdRef = useRef("");
  const chatOpenRef = useRef(false);
  const roomName = useMemo(() => getDocIdFromUrl(), []);

  // Keep ref in sync with state for use in callbacks
  chatOpenRef.current = chatOpen;

  // Inject toast animation keyframes
  useEffect(() => {
    const id = "collab-toast-style";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      @keyframes collabToastIn {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }, []);

  const addToast = useCallback((text: string, color: string) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, text, color, createdAt: Date.now() }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION);
  }, []);

  // Connect on mount (or after identity modal)
  useEffect(() => {
    if (showIdentityModal) return;

    const client = clientRef.current;

    client.onUsersChanged = (u) => setUsers(u);
    client.onConnectionStateChanged = (s) => setConnectionState(s);
    client.onChat = (msg) => {
      setChatMessages((prev) => [...prev, msg].slice(-200));
      if (!chatOpenRef.current) {
        setUnreadCount((n) => n + 1);
      }
    };
    client.onJoin = (user) => addToast(`${user.name} joined`, user.color);
    client.onLeave = (user) => addToast(`${user.name} left`, user.color);

    client.onOperation = (type, payload) => {
      if (type === "create" && payload.shape) {
        try { editor.createShape(payload.shape); } catch { /* shape might already exist */ }
      } else if (type === "update" && payload.id && payload.props) {
        try { editor.updateShape({ id: payload.id, type: payload.type, props: payload.props }); } catch { /* */ }
      } else if (type === "delete" && payload.id) {
        try { editor.deleteShape(payload.id as any); } catch { /* */ }
      }
    };

    client.connect(roomName)
      .then(({ chat }) => {
        setChatMessages(chat);
        myIdRef.current = client.userId;
        setIdentity(client.identity);
      })
      .catch((e) => console.warn("[collab] connect failed:", e));

    // Cursor tracking (throttled at 20fps)
    let lastCursorSend = 0;
    const onPointerMove = (e: PointerEvent) => {
      const now = Date.now();
      if (now - lastCursorSend < 50) return;
      lastCursorSend = now;
      const point = editor.screenToPage({ x: e.clientX, y: e.clientY });
      client.sendCursor(point.x, point.y);
    };
    window.addEventListener("pointermove", onPointerMove);

    // Selection tracking
    let lastSelection: string[] = [];
    const selectionCheck = setInterval(() => {
      const current = [...editor.getSelectedShapeIds()];
      const same =
        current.length === lastSelection.length &&
        current.every((id, i) => id === lastSelection[i]);
      if (!same) {
        lastSelection = current;
        client.sendSelection(current);
      }
    }, 200);

    // Shape sync
    const unsub = editor.store.listen((entry) => {
      for (const [, record] of Object.entries(entry.changes.added)) {
        if ((record as any).typeName === "shape") {
          client.sendOp("create", { shape: record });
        }
      }
      for (const [, [, after]] of Object.entries(entry.changes.updated)) {
        if ((after as any).typeName === "shape") {
          client.sendOp("update", {
            id: (after as any).id,
            type: (after as any).type,
            props: (after as any).props,
          });
        }
      }
      for (const [, record] of Object.entries(entry.changes.removed)) {
        if ((record as any).typeName === "shape") {
          client.sendOp("delete", { id: (record as any).id });
        }
      }
    }, { source: "user", scope: "document" });

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      clearInterval(selectionCheck);
      unsub();
      client.disconnect();
    };
  }, [editor, showIdentityModal, roomName, addToast]);

  const handleIdentityJoin = useCallback((id: UserIdentity) => {
    setIdentity(id);
    setShowIdentityModal(false);
  }, []);

  const handleIdentityUpdate = useCallback((name: string, color: string) => {
    clientRef.current.updateIdentity(name, color);
    setIdentity((prev) => ({ ...prev, name, color }));
  }, []);

  const handleToggleChat = useCallback(() => {
    setChatOpen((prev) => {
      if (!prev) setUnreadCount(0);
      return !prev;
    });
  }, []);

  const handleSendChat = useCallback((text: string) => {
    clientRef.current.sendChat(text);
  }, []);

  const handleTyping = useCallback((isTyping: boolean) => {
    clientRef.current.sendTyping(isTyping);
  }, []);

  return (
    <>
      {showIdentityModal && <UserIdentityModal onJoin={handleIdentityJoin} />}

      <RoomBar
        roomName={roomName}
        identity={identity}
        users={users}
        myId={myIdRef.current}
        connectionState={connectionState}
        chatOpen={chatOpen}
        unreadCount={unreadCount}
        onToggleChat={handleToggleChat}
        onIdentityUpdate={handleIdentityUpdate}
      />

      <RemoteCursors users={users} myId={myIdRef.current} />
      <SelectionIndicators users={users} myId={myIdRef.current} />

      {chatOpen && (
        <ChatPanel
          roomName={roomName}
          messages={chatMessages}
          users={users}
          myId={myIdRef.current}
          onSend={handleSendChat}
          onClose={() => setChatOpen(false)}
          onTyping={handleTyping}
        />
      )}

      <ToastNotifications toasts={toasts} />
    </>
  );
}
