/**
 * Demo mode in the page (demo mode only): opens the shared in-browser
 * database and puts the demo backend where the network would be.
 *
 * Nothing in the app knows. Its Supabase client still sends HTTP requests to
 * its configured address and opens a WebSocket for the live feed; this file
 * answers both locally. It must run before the client is created, which is
 * why demo builds start from src/demo/entry.ts rather than src/main.tsx.
 */
import { PGliteWorker } from '@electric-sql/pglite/worker';
import { DemoBackend } from './backend/router';
import { DemoRealtimeSocket, publishChange, type DatabaseChange } from './backend/realtime-socket';
import type { BackendRequest } from './backend/types';
import { DEMO_CHANNEL, currentEpoch, databaseName, setEpoch, type DemoMessage } from './channel';
import { installFakeCardGateway } from './fake-card';
import { demoAuthStorage } from './session';

/** The address the app believes its backend lives at (.env.demo). */
const SUPABASE_URL = ((import.meta.env.VITE_SUPABASE_URL as string | undefined) || 'https://supabase-not-configured.invalid').replace(/\/$/, '');
const SUPABASE_HOST = new URL(SUPABASE_URL).host;

export interface DemoRuntime {
  backend: DemoBackend;
  db: PGliteWorker;
  /** Wipes the demo back to its first minute, in every open tab. */
  reset(): void;
}

declare global {
  interface Window {
    /** Read by src/integrations/supabase/client.ts when it creates the client. */
    __TABLEFLOW_DEMO__?: { authStorage: typeof demoAuthStorage; runtime?: DemoRuntime };
  }
}

let runtime: Promise<DemoRuntime> | null = null;

export function demoRuntime(): Promise<DemoRuntime> {
  if (!runtime) throw new Error('The demo has not started');
  return runtime;
}

function patchBroadcastChannel(): void {
  // supabase-js mirrors sign-in and sign-out to other tabs over a channel named
  // after its storage key. Each demo area is its own account (src/demo/session.ts),
  // so a waiter signing out must not sign the kitchen display out too.
  const Real = window.BroadcastChannel;
  if (!Real) return;
  const Quiet = function (this: unknown, name: string) {
    if (!name.startsWith('sb-')) return new Real(name);
    return { name, postMessage() {}, close() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, onmessage: null, onmessageerror: null };
  } as unknown as typeof BroadcastChannel;
  Quiet.prototype = Real.prototype;
  window.BroadcastChannel = Quiet;
}

function patchWebSocket(): void {
  const Real = window.WebSocket;
  const Routed = function (this: unknown, url: string | URL, protocols?: string | string[]) {
    const href = typeof url === 'string' ? url : url.href;
    let host = '';
    try { host = new URL(href).host; } catch { host = ''; }
    return host === SUPABASE_HOST ? new DemoRealtimeSocket(href) : new Real(url, protocols);
  } as unknown as typeof WebSocket;
  Object.assign(Routed, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  Routed.prototype = Real.prototype;
  window.WebSocket = Routed;
}

async function readBody(input: RequestInfo | URL, init: RequestInit | undefined, method: string): Promise<unknown> {
  if (method === 'GET' || method === 'HEAD') return null;
  let text: string | null = null;
  const raw = init?.body;
  if (typeof raw === 'string') text = raw;
  else if (raw != null) {
    if (raw instanceof FormData || raw instanceof Blob) return raw;
    text = await new Response(raw as BodyInit).text();
  } else if (input instanceof Request) text = await input.clone().text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function patchFetch(backend: Promise<DemoBackend>): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!href.startsWith(SUPABASE_URL)) return realFetch(input, init);
    const url = new URL(href);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).forEach((value, key) => { headers[key.toLowerCase()] = value; });
    const request: BackendRequest = {
      method, path: url.pathname, query: url.searchParams, headers,
      body: await readBody(input, init, method), pagePath: location.pathname,
    };
    const response = await (await backend).handle(request);
    // A status that must have no body (204, HEAD) is given none.
    const bodyless = response.status === 204 || response.status === 304 || method === 'HEAD';
    return new Response(bodyless ? null : response.body ?? '', { status: response.status, headers: response.headers });
  };
}

/** Removes databases left behind by earlier resets. */
function dropOldDatabases(epoch: number): void {
  const keep = `/pglite/${databaseName(epoch)}`;
  void indexedDB.databases?.().then((all) => {
    for (const { name } of all) {
      if (name && name.startsWith('/pglite/tableflow-demo-') && name !== keep) indexedDB.deleteDatabase(name);
    }
  }).catch(() => undefined);
}

/**
 * Starts demo mode. Resolves once the database is open and seeded;
 * `onProgress` hears what the first start is busy with.
 */
export function startDemoRuntime(onProgress: (message: DemoMessage) => void): Promise<DemoRuntime> {
  if (runtime) return runtime;

  window.__TABLEFLOW_DEMO__ = { authStorage: demoAuthStorage };
  patchBroadcastChannel();
  patchWebSocket();
  installFakeCardGateway();

  let resolveBackend!: (b: DemoBackend) => void;
  patchFetch(new Promise<DemoBackend>((resolve) => { resolveBackend = resolve; }));

  const epoch = currentEpoch();
  setEpoch(epoch);
  const channel = new BroadcastChannel(DEMO_CHANNEL);
  const reload = () => { window.location.reload(); };
  channel.addEventListener('message', (event: MessageEvent<DemoMessage>) => {
    if (event.data?.type === 'reset') reload();
    else onProgress(event.data);
  });

  runtime = (async () => {
    const db = await PGliteWorker.create(
      new Worker(new URL('./backend/db.worker.ts', import.meta.url), { type: 'module', name: 'tableflow-demo-db' }),
      { dataDir: `idb://${databaseName(epoch)}`, id: databaseName(epoch) },
    );
    await db.listen('demo_changes', (payload) => {
      try { publishChange(JSON.parse(payload) as DatabaseChange); } catch { /* not ours */ }
    });
    const backend = new DemoBackend(db);
    resolveBackend(backend);
    dropOldDatabases(epoch);
    const started: DemoRuntime = {
      backend,
      db,
      reset() {
        // Keep nothing of the visit: carts, table sessions, demo sign-ins.
        try { localStorage.clear(); sessionStorage.clear(); } catch { /* storage off */ }
        setEpoch(epoch + 1);
        channel.postMessage({ type: 'reset' } satisfies DemoMessage);
        reload();
      },
    };
    window.__TABLEFLOW_DEMO__!.runtime = started;
    return started;
  })();
  return runtime;
}
