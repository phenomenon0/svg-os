/**
 * AIChat — floating chat overlay accessible from anywhere.
 * Global canvas chat or per-node targeted chat.
 */

import { useEditor } from "tldraw";
import { useState, useCallback, useRef, useEffect } from "react";
import { callClaude, getApiKey } from "./lib/claude-api";
import { C, FONT } from "./theme";

interface Message {
  role: "user" | "assistant";
  text: string;
}

export function AIChat() {
  const editor = useEditor();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [targetNodeId, setTargetNodeId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const getTargetContext = useCallback(() => {
    if (!targetNodeId) return null;
    const shape = editor.getShape(targetNodeId as any);
    if (!shape) return null;
    return { type: shape.type, props: shape.props, id: shape.id };
  }, [editor, targetNodeId]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    if (!getApiKey()) {
      setMessages(prev => [...prev, { role: "user", text }, {
        role: "assistant", text: "No API key configured. Click the gear icon in the palette to set your Claude API key.",
      }]);
      setInput("");
      return;
    }

    setMessages(prev => [...prev, { role: "user", text }]);
    setInput("");
    setLoading(true);

    const shapes = editor.getCurrentPageShapes();
    const nodeCount = shapes.filter(s =>
      ["data-node", "table-node", "transform-node", "terminal-node", "view-node", "note-node", "notebook-node", "ai-node", "web-view"].includes(s.type)
    ).length;

    let contextPrompt = `You are an AI assistant for SVG OS Canvas. The canvas has ${nodeCount} nodes.\n\n`;
    const target = getTargetContext();
    if (target) contextPrompt += `Focused on ${target.type} node. Props: ${JSON.stringify(target.props, null, 2)}\n\n`;
    contextPrompt += `User: ${text}`;

    const { text: response, error } = await callClaude(contextPrompt);
    setMessages(prev => [...prev, { role: "assistant", text: error ? `Error: ${error}` : response }]);
    setLoading(false);
  }, [input, loading, editor, getTargetContext]);

  useEffect(() => {
    const handler = (e: CustomEvent<{ nodeId?: string }>) => {
      setOpen(true);
      if (e.detail?.nodeId) {
        setTargetNodeId(e.detail.nodeId);
        const shape = editor.getShape(e.detail.nodeId as any);
        if (shape) setMessages([{ role: "assistant", text: `Focused on ${shape.type} node. What would you like to do?` }]);
      }
    };
    window.addEventListener("svgos:ai-chat" as any, handler);
    return () => window.removeEventListener("svgos:ai-chat" as any, handler);
  }, [editor]);

  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true);
          setTargetNodeId(null);
          if (messages.length === 0) setMessages([{ role: "assistant", text: "How can I help with your canvas?" }]);
        }}
        style={{
          position: "absolute", bottom: 20, right: 20,
          width: 44, height: 44, borderRadius: "50%",
          background: C.ai, border: `2px solid ${C.ai}88`,
          color: C.bg, fontSize: 20, cursor: "pointer",
          zIndex: 1001, pointerEvents: "all",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: `0 4px 16px ${C.ai}44`,
          transition: "transform 0.15s ease, box-shadow 0.15s ease",
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.08)"; e.currentTarget.style.boxShadow = `0 6px 20px ${C.ai}66`; }}
        onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = `0 4px 16px ${C.ai}44`; }}
        title="AI Chat"
      >
        &#x2726;
      </button>
    );
  }

  return (
    <div style={{
      position: "absolute", bottom: 20, right: 20,
      width: 380, height: 500,
      background: C.bg,
      border: `1px solid ${C.border}`,
      borderRadius: 14,
      zIndex: 1001, pointerEvents: "all",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
      boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
      fontFamily: FONT.sans,
    }}>
      {/* Header */}
      <div style={{
        height: 44, padding: "0 14px",
        background: C.bgAlt, borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
      }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.ai }} />
        <span style={{ color: C.fg, fontSize: 13, fontWeight: 500, flex: 1, letterSpacing: "-0.01em" }}>
          {targetNodeId ? "Node Chat" : "Canvas Chat"}
        </span>
        {targetNodeId && (
          <button onClick={() => { setTargetNodeId(null); setMessages([]); }}
            style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 4, color: C.faint, fontSize: 9, padding: "2px 8px", cursor: "pointer", fontFamily: FONT.mono, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Global
          </button>
        )}
        <button onClick={() => setOpen(false)}
          style={{ background: "transparent", border: "none", color: C.faint, fontSize: 16, cursor: "pointer", padding: 0 }}>
          &#x2715;
        </button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflow: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.map((msg, i) => (
          <div key={i} style={{
            alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
            maxWidth: "85%",
            padding: "10px 14px",
            borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
            background: msg.role === "user" ? C.ai : C.bgCard,
            color: msg.role === "user" ? C.bg : C.fgSoft,
            fontSize: 13, lineHeight: 1.6,
            fontFamily: msg.role === "assistant" ? FONT.serif : FONT.sans,
            whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>
            {msg.text}
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: "flex-start", padding: "10px 14px", borderRadius: "14px 14px 14px 4px", background: C.bgCard, color: C.yellow, fontSize: 12, fontFamily: FONT.mono }}>
            Thinking\u2026
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "10px 14px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 8, flexShrink: 0 }}>
        <input ref={inputRef} type="text" value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") sendMessage(); }}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder="Ask anything\u2026"
          style={{
            flex: 1, padding: "8px 12px",
            background: C.bgCard, border: `1px solid ${C.border}`,
            borderRadius: 8, color: C.fg, fontSize: 13,
            outline: "none", fontFamily: FONT.sans,
            transition: "border-color 0.15s ease",
          }}
          onFocus={e => e.currentTarget.style.borderColor = C.ai}
          onBlur={e => e.currentTarget.style.borderColor = C.border}
        />
        <button onClick={sendMessage} disabled={loading}
          style={{
            background: C.ai, border: "none", borderRadius: 8,
            color: C.bg, padding: "8px 14px", fontSize: 12,
            cursor: loading ? "wait" : "pointer", fontWeight: 600, fontFamily: FONT.sans,
          }}>
          Send
        </button>
      </div>
    </div>
  );
}
