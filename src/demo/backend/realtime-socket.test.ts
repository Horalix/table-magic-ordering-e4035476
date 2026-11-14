import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoRealtimeSocket, publishChange } from './realtime-socket';

type Frame = [string | null, string | null, string, string, Record<string, unknown>];

const TOPIC = 'realtime:staff-realtime';

function open() {
  const socket = new DemoRealtimeSocket('wss://demo.invalid/realtime/v1/websocket');
  const received: Frame[] = [];
  socket.onmessage = (event) => { received.push(JSON.parse(event.data!) as Frame); };
  let opened = false;
  socket.onopen = () => { opened = true; };
  vi.runAllTimers();
  return { socket, received, isOpen: () => opened };
}

const join = (socket: DemoRealtimeSocket, tables: string[]) => {
  socket.send(JSON.stringify(['1', '1', TOPIC, 'phx_join', {
    config: { postgres_changes: tables.map((table) => ({ event: '*', schema: 'public', table })) },
  }]));
  vi.runAllTimers();
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('the demo’s stand-in for the Supabase Realtime socket', () => {
  it('opens, and accepts a channel with an id for each table it was asked to watch', () => {
    const { socket, received, isOpen } = open();
    expect(isOpen()).toBe(true);
    join(socket, ['orders', 'order_items']);
    const reply = received.find((f) => f[3] === 'phx_reply')!;
    expect(reply[4].status).toBe('ok');
    const bindings = (reply[4].response as { postgres_changes: { id: number; table: string }[] }).postgres_changes;
    expect(bindings.map((b) => b.table)).toEqual(['orders', 'order_items']);
    expect(new Set(bindings.map((b) => b.id)).size).toBe(2);
    // The app treats the channel as live only once the server says its changes will come (src/lib/realtime.ts).
    expect(received.find((f) => f[3] === 'system')?.[4]).toMatchObject({ extension: 'postgres_changes', status: 'ok' });
    socket.close();
  });

  it('answers heartbeats, so the client does not think the connection died', () => {
    const { socket, received } = open();
    socket.send(JSON.stringify([null, '7', 'phoenix', 'heartbeat', {}]));
    vi.runAllTimers();
    expect(received).toContainEqual([null, '7', 'phoenix', 'phx_reply', { status: 'ok', response: {} }]);
    socket.close();
  });

  it('delivers a database change to the channels watching that table, with the restaurant it belongs to', () => {
    const { socket, received } = open();
    join(socket, ['orders', 'waiter_calls']);
    received.length = 0;
    publishChange({ t: 'orders', e: 'INSERT', v: 'venue-1', id: 'order-1' });
    publishChange({ t: 'tables', e: 'UPDATE', v: 'venue-1', id: 'table-1' });
    vi.runAllTimers();
    expect(received).toHaveLength(1);
    const [, , topic, event, payload] = received[0];
    expect(topic).toBe(TOPIC);
    expect(event).toBe('postgres_changes');
    const data = payload.data as { table: string; type: string; record: Record<string, unknown> };
    expect(data).toMatchObject({ table: 'orders', type: 'INSERT', record: { id: 'order-1', venue_id: 'venue-1' } });
    expect((payload.ids as number[]).length).toBe(1);
    socket.close();
  });

  it('puts a deleted row in old_record, where the client looks for it', () => {
    const { socket, received } = open();
    join(socket, ['bill_requests']);
    received.length = 0;
    publishChange({ t: 'bill_requests', e: 'DELETE', v: null, id: 'bill-1' });
    vi.runAllTimers();
    const data = received[0][4].data as { record: unknown; old_record: unknown };
    expect(data.record).toEqual({});
    expect(data.old_record).toEqual({ id: 'bill-1' });
    socket.close();
  });

  it('says nothing after the channel is left or the socket closed', () => {
    const { socket, received } = open();
    join(socket, ['orders']);
    socket.send(JSON.stringify(['1', '2', TOPIC, 'phx_leave', {}]));
    vi.runAllTimers();
    received.length = 0;
    publishChange({ t: 'orders', e: 'UPDATE', v: null, id: 'order-1' });
    vi.runAllTimers();
    expect(received).toHaveLength(0);
    socket.close();
    vi.runAllTimers();
    expect(socket.readyState).toBe(DemoRealtimeSocket.CLOSED);
  });
});
