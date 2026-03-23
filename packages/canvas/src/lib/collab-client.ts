/**
 * Collab Client — connects to Phoenix Channels for real-time collaboration.
 * Handles: cursor presence, shape sync, chat, selection, typing indicators.
 */

import { Socket, Channel, Presence } from "phoenix";

// ── Types ────────────────────────────────────────────────────────────────────

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface CollabUser {
  id: string;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
  selectedShapeIds: string[];
  isEditing: string | null;
  isTyping: boolean;
}

export interface ChatMessage {
  user_id: string;
  user_name: string;
  user_color: string;
  text: string;
  timestamp: string;
}

export interface UserIdentity {
  id: string;
  name: string;
  color: string;
}

// ── Identity ─────────────────────────────────────────────────────────────────

const IDENTITY_KEY = "svgos:user";
const PALETTE = ["#6a9fcf", "#7eb59d", "#e6a756", "#cf7a9a", "#a78bca", "#d4946a"];

export function getOrCreateIdentity(): UserIdentity {
  const stored = localStorage.getItem(IDENTITY_KEY);
  if (stored) {
    try { return JSON.parse(stored); } catch { /* fall through */ }
  }
  const identity: UserIdentity = {
    id: crypto.randomUUID(),
    name: `User ${Math.floor(Math.random() * 1000)}`,
    color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
  };
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  return identity;
}

export function hasIdentity(): boolean {
  return localStorage.getItem(IDENTITY_KEY) !== null;
}

export function saveIdentity(identity: UserIdentity): void {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
}

// ── Tombstone Set (prevents re-creation of deleted shapes) ───────────────────

class TombstoneSet {
  private entries = new Map<string, number>();
  private ttl: number;

  constructor(ttlMs = 5000) {
    this.ttl = ttlMs;
  }

  add(id: string): void {
    this.entries.set(id, Date.now());
  }

  has(id: string): boolean {
    const ts = this.entries.get(id);
    if (!ts) return false;
    if (Date.now() - ts > this.ttl) {
      this.entries.delete(id);
      return false;
    }
    return true;
  }

  prune(): void {
    const now = Date.now();
    for (const [id, ts] of this.entries) {
      if (now - ts > this.ttl) this.entries.delete(id);
    }
  }
}

// ── Debounced Shape Sync ─────────────────────────────────────────────────────

interface PendingShapeOp {
  type: "create" | "update" | "delete";
  payload: any;
}

// ── CollabClient ─────────────────────────────────────────────────────────────

export class CollabClient {
  private socket: Socket;
  private channel: Channel | null = null;
  private presence: Presence | null = null;
  private _users: CollabUser[] = [];
  private _userId: string = "";
  private _connectionState: ConnectionState = "disconnected";
  private _identity: UserIdentity;
  private tombstones = new TombstoneSet(5000);

  // Debounced shape ops
  private pendingOps: PendingShapeOp[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  // Callbacks
  onUsersChanged?: (users: CollabUser[]) => void;
  onOperation?: (type: string, payload: any) => void;
  onChat?: (msg: ChatMessage) => void;
  onConnectionStateChanged?: (state: ConnectionState) => void;
  onJoin?: (user: CollabUser) => void;
  onLeave?: (user: CollabUser) => void;

  constructor(serverUrl: string) {
    this._identity = getOrCreateIdentity();
    this.socket = new Socket(`${serverUrl}/socket`, {
      params: { user_id: this._identity.id },
      reconnectAfterMs: (tries) => [1000, 2000, 5000, 10000][Math.min(tries - 1, 3)],
    });

    this.socket.onOpen(() => {
      if (this._connectionState === "reconnecting") {
        this.setConnectionState("connected");
      }
    });

    this.socket.onError(() => {
      if (this._connectionState === "connected") {
        this.setConnectionState("reconnecting");
      }
    });

    this.socket.onClose(() => {
      this.setConnectionState("disconnected");
    });
  }

  private setConnectionState(state: ConnectionState): void {
    this._connectionState = state;
    this.onConnectionStateChanged?.(state);
  }

  get userId(): string { return this._userId; }
  get users(): CollabUser[] { return this._users; }
  get connectionState(): ConnectionState { return this._connectionState; }
  get identity(): UserIdentity { return this._identity; }

  async connect(docId: string): Promise<{ snapshot: any; chat: ChatMessage[] }> {
    this._identity = getOrCreateIdentity();
    this.setConnectionState("connecting");

    return new Promise((resolve, reject) => {
      this.socket.connect();

      this.channel = this.socket.channel(`room:${docId}`, {
        user_name: this._identity.name,
        user_color: this._identity.color,
        user_id: this._identity.id,
      });

      this.presence = new Presence(this.channel);

      // Track previous user set for join/leave detection
      let prevUserIds = new Set<string>();

      this.presence.onSync(() => {
        const users: CollabUser[] = [];
        this.presence!.list((id: string, { metas }: any) => {
          const meta = metas[0];
          users.push({
            id,
            name: meta.name || "Anonymous",
            color: meta.color || "#6a9fcf",
            cursor: meta.cursor || null,
            selectedShapeIds: meta.selected_shape_ids || [],
            isEditing: meta.is_editing || null,
            isTyping: meta.is_typing || false,
          });
        });

        // Detect joins and leaves
        const currentIds = new Set(users.map(u => u.id));
        for (const user of users) {
          if (!prevUserIds.has(user.id) && user.id !== this._userId) {
            this.onJoin?.(user);
          }
        }
        for (const id of prevUserIds) {
          if (!currentIds.has(id) && id !== this._userId) {
            const prev = this._users.find(u => u.id === id);
            if (prev) this.onLeave?.(prev);
          }
        }
        prevUserIds = currentIds;

        this._users = users;
        this.onUsersChanged?.(users);
      });

      this.channel.on("op:create", (payload) => {
        if (payload.shape?.id && this.tombstones.has(payload.shape.id)) return;
        this.onOperation?.("create", payload);
      });
      this.channel.on("op:update", (payload) => this.onOperation?.("update", payload));
      this.channel.on("op:delete", (payload) => {
        if (payload.id) this.tombstones.add(payload.id);
        this.onOperation?.("delete", payload);
      });
      this.channel.on("chat:message", (msg) => this.onChat?.(msg as ChatMessage));

      this.channel
        .join()
        .receive("ok", (resp: any) => {
          this._userId = this._identity.id;
          this.setConnectionState("connected");
          resolve({ snapshot: resp.snapshot || {}, chat: resp.chat || [] });
        })
        .receive("error", (resp: any) => {
          this.setConnectionState("disconnected");
          reject(resp);
        });
    });
  }

  // ── Cursor ──────────────────────────────────────────────────────────────

  sendCursor(x: number, y: number): void {
    this.channel?.push("cursor:move", { x, y });
  }

  // ── Selection ───────────────────────────────────────────────────────────

  sendSelection(shapeIds: string[]): void {
    this.channel?.push("presence:update", { selected_shape_ids: shapeIds });
  }

  // ── Editing ─────────────────────────────────────────────────────────────

  sendEditing(shapeId: string | null): void {
    this.channel?.push("presence:update", { is_editing: shapeId });
  }

  // ── Typing ──────────────────────────────────────────────────────────────

  sendTyping(isTyping: boolean): void {
    this.channel?.push("presence:update", { is_typing: isTyping });
  }

  // ── Shape Operations (debounced) ────────────────────────────────────────

  sendOp(type: "create" | "update" | "delete", payload: any): void {
    if (type === "delete" && payload.id) {
      this.tombstones.add(payload.id);
    }

    // For updates, only send the diff (changed props)
    this.pendingOps.push({ type, payload });
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushOps();
      this.flushTimer = null;
    }, 100);
  }

  private flushOps(): void {
    // Collapse updates: keep only the latest update per shape ID
    const collapsed = new Map<string, PendingShapeOp>();
    const ordered: PendingShapeOp[] = [];

    for (const op of this.pendingOps) {
      const key = op.type === "create"
        ? `create:${op.payload.shape?.id}`
        : `${op.type}:${op.payload.id}`;

      if (op.type === "update") {
        const existing = collapsed.get(key);
        if (existing) {
          // Merge props
          existing.payload.props = { ...existing.payload.props, ...op.payload.props };
        } else {
          collapsed.set(key, { ...op });
          ordered.push(collapsed.get(key)!);
        }
      } else {
        ordered.push(op);
      }
    }

    for (const op of ordered) {
      this.channel?.push(`op:${op.type}`, op.payload);
    }

    this.pendingOps = [];
  }

  // ── Chat ────────────────────────────────────────────────────────────────

  sendChat(text: string): void {
    this.channel?.push("chat:message", { text });
  }

  // ── Identity Update ─────────────────────────────────────────────────────

  updateIdentity(name: string, color: string): void {
    this._identity = { ...this._identity, name, color };
    saveIdentity(this._identity);
    this.channel?.push("presence:update", { name, color });
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  disconnect(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushOps(); // flush remaining
    }
    this.channel?.leave();
    this.socket.disconnect();
    this.setConnectionState("disconnected");
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

let _client: CollabClient | null = null;

export function getCollabClient(): CollabClient {
  if (!_client) {
    const wsUrl = window.location.hostname === "localhost"
      ? "ws://localhost:4000"
      : `wss://${window.location.host}/collab`;
    _client = new CollabClient(wsUrl);
  }
  return _client;
}

export function getDocIdFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("room") || "default";
}
