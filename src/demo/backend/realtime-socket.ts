/**
 * The live feed without a server (demo mode only).
 *
 * supabase-js opens a WebSocket to Supabase Realtime and speaks the Phoenix
 * channel protocol over it. This class stands in for that socket: it accepts
 * the joins, answers the heartbeats, and turns each change the in-browser
 * database announces (sql/post.sql, demo.announce_change) into the
 * `postgres_changes` message a real server would send. The app's own realtime
 * code (src/lib/realtime.ts) runs unchanged on top of it.
 *
 * Protocol version 2.0.0: every frame is `[join_ref, ref, topic, event, payload]`.
 */

export interface DatabaseChange {
  /** Table name. */
  t: string;
  /** INSERT | UPDATE | DELETE */
  e: string;
  /** The row's restaurant, when the table has one. */
  v: string | null;
  id: string | null;
}

interface Binding {
  id: number;
  event: string;
  schema: string;
  table?: string;
  filter?: string;
}

type Frame = [string | null, string | null, string, string, Record<string, unknown>];
type Listener = (event: { data?: string; code?: number; reason?: string }) => void;

const sockets = new Set<DemoRealtimeSocket>();
let nextBindingId = 1;

/** Hands a database change to every open socket in this tab. */
export function publishChange(change: DatabaseChange): void {
  sockets.forEach((socket) => socket.deliver(change));
}

export class DemoRealtimeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState = 0;
  binaryType = 'arraybuffer';
  bufferedAmount = 0;
  protocol = '';
  extensions = '';
  onopen: Listener | null = null;
  onmessage: Listener | null = null;
  onclose: Listener | null = null;
  onerror: Listener | null = null;

  private listeners = new Map<string, Set<Listener>>();
  private joined = new Map<string, { joinRef: string | null; bindings: Binding[] }>();

  constructor(readonly url: string) {
    sockets.add(this);
    setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.emit('open', {});
    }, 0);
  }

  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  private emit(type: 'open' | 'message' | 'close' | 'error', event: { data?: string; code?: number; reason?: string }): void {
    const handler = type === 'open' ? this.onopen : type === 'message' ? this.onmessage : type === 'close' ? this.onclose : this.onerror;
    handler?.call(this, event);
    this.listeners.get(type)?.forEach((listener) => listener.call(this, event));
  }

  private push(frame: Frame): void {
    if (this.readyState !== 1) return;
    // Asynchronous, as a network frame is: the client must be done sending first.
    setTimeout(() => { if (this.readyState === 1) this.emit('message', { data: JSON.stringify(frame) }); }, 0);
  }

  send(data: unknown): void {
    if (typeof data !== 'string') return; // binary frames are user broadcasts, which the app does not use
    let frame: Frame;
    try { frame = JSON.parse(data) as Frame; } catch { return; }
    const [joinRef, ref, topic, event, payload] = frame;
    const ok = (response: Record<string, unknown> = {}) => this.push([joinRef, ref, topic, 'phx_reply', { status: 'ok', response }]);

    if (event === 'heartbeat') { ok(); return; }
    if (event === 'phx_join') {
      const asked = ((payload?.config as { postgres_changes?: Omit<Binding, 'id'>[] } | undefined)?.postgres_changes) ?? [];
      const bindings = asked.map((b) => ({ ...b, id: nextBindingId++ }));
      this.joined.set(topic, { joinRef, bindings });
      ok({ postgres_changes: bindings });
      if (bindings.length) {
        this.push([joinRef, null, topic, 'system', {
          extension: 'postgres_changes', status: 'ok', message: 'Subscribed to PostgreSQL', channel: topic.replace(/^realtime:/, ''),
        }]);
      }
      return;
    }
    if (event === 'phx_leave') { this.joined.delete(topic); ok(); return; }
    // access_token refreshes, presence and broadcasts: accepted, nothing to do.
    if (ref) ok();
  }

  deliver(change: DatabaseChange): void {
    if (this.readyState !== 1) return;
    for (const [topic, { joinRef, bindings }] of this.joined) {
      const ids = bindings
        .filter((b) => (b.schema === '*' || b.schema === 'public')
          && (!b.table || b.table === change.t)
          && (b.event === '*' || b.event.toUpperCase() === change.e))
        .map((b) => b.id);
      if (!ids.length) continue;
      const row = { id: change.id, ...(change.v ? { venue_id: change.v } : {}) };
      this.push([joinRef, null, topic, 'postgres_changes', {
        ids,
        data: {
          schema: 'public', table: change.t, type: change.e, commit_timestamp: new Date().toISOString(), columns: [], errors: null,
          record: change.e === 'DELETE' ? {} : row,
          old_record: change.e === 'INSERT' ? {} : row,
        },
      }]);
    }
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.joined.clear();
    sockets.delete(this);
    setTimeout(() => this.emit('close', { code, reason }), 0);
  }
}
