/**
 * Collab Client — connects to Phoenix Channels for real-time collaboration.
 * Handles: cursor presence, shape sync, chat.
 */

import { Socket, Channel, Presence } from "phoenix";

export interface CollabUser {
  id: string;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
}

export interface ChatMessage {
  user_id: string;
  user_name: string;
  text: string;
  timestamp: string;
}

export class CollabClient {
  private socket: Socket;
  private channel: Channel | null = null;
  private presence: Presence | null = null;
  private _users: CollabUser[] = [];
  private _userId: string = "";

  onUsersChanged?: (users: CollabUser[]) => void;
  onOperation?: (type: string, payload: any) => void;
  onChat?: (msg: ChatMessage) => void;

  constructor(serverUrl: string) {
    this.socket = new Socket(`${serverUrl}/socket`, {
      params: {},
    });
  }

  get userId(): string { return this._userId; }
  get users(): CollabUser[] { return this._users; }

  async connect(docId: string, userName: string, userColor: string): Promise<{ snapshot: any; chat: ChatMessage[] }> {
    return new Promise((resolve, reject) => {
      this.socket.connect();

      this.channel = this.socket.channel(`room:${docId}`, {
        user_name: userName,
        user_color: userColor,
      });

      this.presence = new Presence(this.channel);
      this.presence.onSync(() => {
        const users: CollabUser[] = [];
        this.presence!.list((id: string, { metas }: any) => {
          const meta = metas[0];
          users.push({ id, name: meta.name, color: meta.color, cursor: meta.cursor });
        });
        this._users = users;
        this.onUsersChanged?.(users);
      });

      this.channel.on("op:create", (payload) => this.onOperation?.("create", payload));
      this.channel.on("op:update", (payload) => this.onOperation?.("update", payload));
      this.channel.on("op:delete", (payload) => this.onOperation?.("delete", payload));
      this.channel.on("chat:message", (msg) => this.onChat?.(msg as ChatMessage));

      this.channel
        .join()
        .receive("ok", (resp: any) => {
          this._userId = this.socket.params?.user_id || "local";
          resolve({ snapshot: resp.snapshot || {}, chat: resp.chat || [] });
        })
        .receive("error", (resp: any) => reject(resp));
    });
  }

  sendCursor(x: number, y: number): void {
    this.channel?.push("cursor:move", { x, y });
  }

  sendOp(type: "create" | "update" | "delete", payload: any): void {
    this.channel?.push(`op:${type}`, payload);
  }

  sendChat(text: string): void {
    this.channel?.push("chat:message", { text });
  }

  disconnect(): void {
    this.channel?.leave();
    this.socket.disconnect();
  }
}

// Singleton for the app
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
