/**
 * The demo's database, in a web worker (demo mode only).
 *
 * PGlite is PostgreSQL compiled to WebAssembly. Every tab starts this worker,
 * but only one — the leader, chosen with a Web Lock — opens the database; the
 * others send it their queries. So all the tabs of one browser share one
 * database, kept in IndexedDB between visits: an order placed on the guest's
 * phone page is on the kitchen display's page at once.
 *
 * The first time (or after a reset) the leader builds the schema from the
 * real migrations and seeds the restaurant; that takes a few seconds and is
 * reported on the 'tableflow-demo' channel for the loading screen.
 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { worker } from '@electric-sql/pglite/worker';
import shim from '../../../supabase/tests/harness/00_shim.sql?raw';
import pre from './sql/pre.sql?raw';
import post from './sql/post.sql?raw';
import { buildSchema, isSeeded } from './bootstrap';
import { keepAlive, markAlive, seedDemo } from '../seed';
import { runPrinters } from '../seed/printers';
import { DEMO_CHANNEL, type DemoMessage } from '../channel';

const migrations = import.meta.glob('../../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const channel = new BroadcastChannel(DEMO_CHANNEL);
const say = (message: DemoMessage) => channel.postMessage(message);

void worker({
  async init(options) {
    const db = await PGlite.create({
      dataDir: options.dataDir,
      extensions: { pgcrypto },
      // Writes reach IndexedDB a moment after the query returns: far faster, and a demo can afford it.
      relaxedDurability: true,
    });
    try {
      if (!(await isSeeded(db))) {
        say({ type: 'progress', step: 'schema' });
        await buildSchema(db, {
          shim, pre, post,
          migrations: Object.entries(migrations).map(([path, sql]) => ({ name: path.split('/').pop() ?? path, sql })),
        });
        say({ type: 'progress', step: 'seed' });
        await seedDemo(db, new Date());
      } else {
        // Reopened after a pause: bring the restaurant up to the present.
        await keepAlive(db, new Date());
      }
      say({ type: 'progress', step: 'ready' });
      // While any tab is open: the network printers poll for tickets, and the
      // demo remembers it is alive (seed/index.ts, keepAlive).
      setInterval(() => { void runPrinters(db).catch(() => undefined); }, 4000);
      setInterval(() => { void markAlive(db, new Date()).catch(() => undefined); }, 60_000);
    } catch (error) {
      say({ type: 'failed', message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    return db;
  },
});
