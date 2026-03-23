import type { CoreEvent, EventType } from "./types";

type Handler = (event: CoreEvent) => void;

export class EventBus {
  private handlers = new Map<EventType, Set<Handler>>();
  private log: CoreEvent[] = [];
  private maxLog = 1000;

  emit(event: CoreEvent): void {
    this.log.push(event);
    if (this.log.length > this.maxLog) this.log.shift();

    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try { handler(event); } catch (e) { console.error("[event-bus]", e); }
      }
    }
  }

  on(type: EventType, handler: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  once(type: EventType, handler: Handler): void {
    const unsub = this.on(type, (event) => {
      unsub();
      handler(event);
    });
  }

  getLog(since?: number): CoreEvent[] {
    if (since === undefined) return [...this.log];
    return this.log.filter(e => e.timestamp >= since);
  }

  clear(): void {
    this.handlers.clear();
    this.log = [];
  }
}
