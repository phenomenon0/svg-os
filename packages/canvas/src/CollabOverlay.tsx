/**
 * CollabOverlay — renders remote users' cursors + provides collab state.
 * Connects to Phoenix Channel on mount. Syncs tldraw changes to channel.
 */

import { useEditor } from "tldraw";
import { useState, useEffect, useRef, useCallback } from "react";
import { getCollabClient, getDocIdFromUrl, type CollabUser, type ChatMessage } from "./lib/collab-client";
import { C, FONT } from "./theme";

export function CollabOverlay() {
  const editor = useEditor();
  const [users, setUsers] = useState<CollabUser[]>([]);
  const [connected, setConnected] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const clientRef = useRef(getCollabClient());
  const myIdRef = useRef("");

  // Generate a random name/color for this user
  const userName = useRef(`User ${Math.floor(Math.random() * 1000)}`);
  const userColor = useRef(
    ["#6a9fcf", "#7eb59d", "#e6a756", "#cf7a9a", "#a78bca", "#d4946a"][Math.floor(Math.random() * 6)]
  );

  useEffect(() => {
    const client = clientRef.current;
    const docId = getDocIdFromUrl();

    client.onUsersChanged = (u) => setUsers(u);
    client.onChat = (msg) => setChatMessages(prev => [...prev, msg].slice(-100));
    client.onOperation = (type, payload) => {
      // Apply remote operations to tldraw
      if (type === "create" && payload.shape) {
        try { editor.createShape(payload.shape); } catch { /* shape might already exist */ }
      } else if (type === "update" && payload.id && payload.props) {
        try { editor.updateShape({ id: payload.id, type: payload.type, props: payload.props }); } catch { /* */ }
      } else if (type === "delete" && payload.id) {
        try { editor.deleteShape(payload.id as any); } catch { /* */ }
      }
    };

    client.connect(docId, userName.current, userColor.current)
      .then(({ chat }) => {
        setConnected(true);
        setChatMessages(chat);
        myIdRef.current = client.userId;
      })
      .catch((e) => console.warn("[collab] connect failed:", e));

    // Send cursor position on pointer move (throttled)
    let lastCursorSend = 0;
    const onPointerMove = (e: PointerEvent) => {
      const now = Date.now();
      if (now - lastCursorSend < 50) return; // 20fps max
      lastCursorSend = now;
      const point = editor.screenToPage({ x: e.clientX, y: e.clientY });
      client.sendCursor(point.x, point.y);
    };
    window.addEventListener("pointermove", onPointerMove);

    // Send shape operations when tldraw store changes
    const unsub = editor.store.listen((entry) => {
      for (const [_id, record] of Object.entries(entry.changes.added)) {
        if ((record as any).typeName === "shape") {
          client.sendOp("create", { shape: record });
        }
      }
      for (const [_id, [_before, after]] of Object.entries(entry.changes.updated)) {
        if ((after as any).typeName === "shape") {
          client.sendOp("update", {
            id: (after as any).id,
            type: (after as any).type,
            props: (after as any).props,
          });
        }
      }
      for (const [_id, record] of Object.entries(entry.changes.removed)) {
        if ((record as any).typeName === "shape") {
          client.sendOp("delete", { id: (record as any).id });
        }
      }
    }, { source: "user", scope: "document" });

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      unsub();
      client.disconnect();
    };
  }, [editor]);

  const sendChat = useCallback(() => {
    if (!chatInput.trim()) return;
    clientRef.current.sendChat(chatInput.trim());
    setChatInput("");
  }, [chatInput]);

  const remoteUsers = users.filter(u => u.id !== myIdRef.current);

  return (
    <>
      {/* Remote cursors */}
      {remoteUsers.map(user => user.cursor && (
        <div key={user.id} style={{
          position: "absolute",
          left: 0, top: 0,
          transform: `translate(${editor.pageToScreen(user.cursor).x}px, ${editor.pageToScreen(user.cursor).y}px)`,
          pointerEvents: "none",
          zIndex: 999,
          transition: "transform 0.1s ease-out",
        }}>
          {/* Cursor arrow */}
          <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
            <path d="M0 0L16 12L8 12L4 20L0 0Z" fill={user.color} stroke="#000" strokeWidth="1"/>
          </svg>
          {/* Name label */}
          <div style={{
            marginLeft: 16, marginTop: -4,
            background: user.color,
            color: "#000",
            fontSize: 10,
            fontFamily: FONT.sans,
            fontWeight: 600,
            padding: "1px 6px",
            borderRadius: 3,
            whiteSpace: "nowrap",
          }}>
            {user.name}
          </div>
        </div>
      ))}

      {/* Connection status + user count */}
      <div style={{
        position: "absolute",
        top: 8, right: 290,
        display: "flex", alignItems: "center", gap: 6,
        zIndex: 1000, pointerEvents: "all",
      }}>
        <div style={{
          width: 6, height: 6, borderRadius: "50%",
          background: connected ? "#22c55e" : "#ef4444",
        }} />
        <span style={{
          fontSize: 10, color: C.muted, fontFamily: FONT.mono,
        }}>
          {remoteUsers.length + 1} online
        </span>
        <button
          onClick={() => setChatOpen(!chatOpen)}
          style={{
            background: chatOpen ? `${C.accent}22` : "transparent",
            border: `1px solid ${C.border}`,
            borderRadius: 4,
            color: C.muted,
            fontSize: 9,
            padding: "2px 8px",
            cursor: "pointer",
            fontFamily: FONT.mono,
          }}
        >
          Chat
        </button>
      </div>

      {/* Chat panel */}
      {chatOpen && (
        <div style={{
          position: "absolute",
          top: 32, right: 290,
          width: 260, height: 300,
          background: C.bgCard,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          zIndex: 1000,
          pointerEvents: "all",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: FONT.sans,
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        }}>
          <div style={{
            flex: 1, overflow: "auto", padding: 8,
            display: "flex", flexDirection: "column", gap: 4,
          }}>
            {chatMessages.map((msg, i) => (
              <div key={i} style={{ fontSize: 11, lineHeight: 1.4 }}>
                <span style={{ color: C.accent, fontWeight: 600 }}>{msg.user_name}: </span>
                <span style={{ color: C.fgSoft }}>{msg.text}</span>
              </div>
            ))}
          </div>
          <div style={{
            padding: 6, borderTop: `1px solid ${C.border}`,
            display: "flex", gap: 4,
          }}>
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") sendChat(); }}
              onPointerDown={e => e.stopPropagation()}
              placeholder="Message..."
              style={{
                flex: 1, padding: "4px 6px",
                background: C.bgDeep, border: `1px solid ${C.border}`,
                borderRadius: 4, color: C.fg, fontSize: 11,
                outline: "none", fontFamily: FONT.sans,
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
