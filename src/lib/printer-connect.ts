/**
 * Direct Bluetooth thermal-printer client (Web Bluetooth + generic ESC/POS).
 *
 * Works with most 58/80 mm Bluetooth ESC/POS receipt printers on Chrome/Edge
 * (Android, Windows, macOS, ChromeOS). Web Bluetooth is NOT available on iOS
 * Safari, so the UI hides this option there.
 *
 * We don't assume a vendor — on connect we try the common ESC/POS BLE serial
 * service (0x18F0) and otherwise scan for any writable characteristic.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { UNKNOWN_STATUS, type PrintOutcome, type PrinterStatus } from '@/lib/print-outcome';

const ESC_POS_SERVICE = 0x18f0;
const ESC_POS_CHAR = 0x2af1;

/**
 * DLE EOT n — "real-time status transmission".
 *
 * The only ESC/POS command a printer answers WHILE it is jammed, out of paper,
 * or has its cover open; everything else queues behind the fault. n selects
 * which byte comes back.
 */
const DLE_EOT_PRINTER = Uint8Array.from([0x10, 0x04, 0x01]);
const DLE_EOT_OFFLINE = Uint8Array.from([0x10, 0x04, 0x02]);
const DLE_EOT_PAPER = Uint8Array.from([0x10, 0x04, 0x04]);

/** How long to wait for a status byte before deciding the device will not answer. */
const STATUS_TIMEOUT_MS = 1200;

export const bluetoothSupported = () =>
  typeof navigator !== 'undefined' && !!(navigator as any).bluetooth;

/** True when running inside an iframe (e.g. an editor/preview), where Web
 * Bluetooth is blocked unless the parent frame grants `allow="bluetooth"`. */
export const inEmbeddedFrame = (): boolean => {
  try { return typeof window !== 'undefined' && window.self !== window.top; }
  catch { return true; }
};

/** Map raw Web Bluetooth errors to plain, actionable guidance. */
export const friendlyBluetoothError = (e: unknown): string => {
  const msg = e instanceof Error ? e.message : String(e);
  if (/globally disabled|disabled in this context|permissions policy|SecurityError|secure context|not allowed in/i.test(msg)) {
    return inEmbeddedFrame()
      ? 'Bluetooth is blocked inside this embedded preview. Open the published site directly in Chrome (Android, Windows or Mac) and try again.'
      : 'Bluetooth is disabled in this browser. Use Chrome or Edge over HTTPS, and check that Bluetooth isn’t turned off by a device policy.';
  }
  if (/cancelled|canceled|No device selected|chooser/i.test(msg)) return 'No printer was selected.';
  if (/adapter|radio|turned off|powered/i.test(msg)) return 'No Bluetooth radio found, or Bluetooth is turned off on this device.';
  return msg;
};

let device: any = null;
let characteristic: any = null;
/** Set only when the device both has a notify channel and answered a probe. */
let notifyCharacteristic: any = null;
let statusCapable = false;
let bluetoothPrintQueue: Promise<void> = Promise.resolve();

const REMEMBER_ID = 'kitchen:btPrinterId';
const REMEMBER_NAME = 'kitchen:btPrinterName';

const remember = (d: any) => {
  try { localStorage.setItem(REMEMBER_ID, d.id); localStorage.setItem(REMEMBER_NAME, d.name || 'Bluetooth printer'); } catch { /* ignore */ }
};

export const connectedPrinterName = (): string | null =>
  device && device.gatt?.connected ? (device.name || 'Bluetooth printer') : null;

export const isBluetoothConnected = (): boolean => !!(characteristic && device?.gatt?.connected);

/** Name of the last paired printer (even if not currently connected). */
export const rememberedPrinterName = (): string | null => {
  try { return localStorage.getItem(REMEMBER_NAME); } catch { return null; }
};

async function findWritable(server: any) {
  // Preferred: the standard ESC/POS serial service.
  try {
    const svc = await server.getPrimaryService(ESC_POS_SERVICE);
    return await svc.getCharacteristic(ESC_POS_CHAR);
  } catch {
    /* fall through to scan */
  }
  const services = await server.getPrimaryServices();
  for (const svc of services) {
    const chars = await svc.getCharacteristics();
    for (const c of chars) {
      if (c.properties.write || c.properties.writeWithoutResponse) return c;
    }
  }
  throw new Error('No printable channel found on this device. Is it an ESC/POS printer?');
}

/** The channel a printer answers a status query on, if it has one at all. */
async function findNotify(server: any) {
  try {
    const services = await server.getPrimaryServices();
    for (const svc of services) {
      const chars = await svc.getCharacteristics();
      for (const c of chars) {
        if (c.properties.notify || c.properties.indicate) return c;
      }
    }
  } catch { /* a device that will not enumerate simply has no status */ }
  return null;
}

/** One status byte, or null if the printer does not answer in time. */
async function askForByte(command: Uint8Array): Promise<number | null> {
  if (!characteristic || !notifyCharacteristic) return null;

  return new Promise<number | null>((resolve) => {
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try { notifyCharacteristic.removeEventListener('characteristicvaluechanged', onValue); } catch { /* ignore */ }
      resolve(value);
    };
    const onValue = (event: any) => {
      const view: DataView | undefined = event?.target?.value;
      finish(view && view.byteLength > 0 ? view.getUint8(0) : null);
    };
    const timer = window.setTimeout(() => finish(null), STATUS_TIMEOUT_MS);

    void (async () => {
      try {
        notifyCharacteristic.addEventListener('characteristicvaluechanged', onValue);
        await notifyCharacteristic.startNotifications();
        if (characteristic.properties.writeWithoutResponse) {
          await characteristic.writeValueWithoutResponse(command);
        } else {
          await characteristic.writeValue(command);
        }
      } catch {
        finish(null);
      }
    })();
  });
}

/**
 * Ask the printer how it is.
 *
 * Returns `known: false` rather than guessing when the device has no notify
 * channel or did not answer. That is the honest answer for most cheap
 * printers, and it is what makes a later timeout interpretable: silence from a
 * printer that CAN talk is a fault, silence from one that cannot is just
 * silence.
 *
 * Bit layout is the ESC/POS real-time status standard. Bit 4 is always 1 on a
 * valid reply, which is what makes it possible to tell a real status byte from
 * a stray echo of whatever was last written.
 */
export async function queryPrinterStatus(): Promise<PrinterStatus> {
  if (!isBluetoothConnected() || !notifyCharacteristic) return UNKNOWN_STATUS;

  const printer = await askForByte(DLE_EOT_PRINTER);
  if (printer === null || (printer & 0b0001_0000) === 0) return UNKNOWN_STATUS;

  const offline = await askForByte(DLE_EOT_OFFLINE);
  const paper = await askForByte(DLE_EOT_PAPER);

  return {
    known: true,
    // Bit 3 of the printer byte: 1 = offline.
    online: (printer & 0b0000_1000) === 0,
    // Bit 2 of the offline byte: cover open.
    coverOpen: offline !== null && (offline & 0b0000_0100) !== 0,
    // Bits 5+6 of the paper byte: paper end sensor.
    paperOut: paper !== null && (paper & 0b0110_0000) !== 0,
    // Bits 2+3: near-end sensor.
    paperLow: paper !== null && (paper & 0b0000_1100) !== 0,
  };
}

/**
 * Whether silence from this device means anything.
 *
 * Decided once, at connect, by actually probing it — not by trusting that a
 * notify characteristic exists, because plenty of modules expose one and never
 * send anything down it.
 */
export const printerStatusCapable = () => statusCapable;

async function classifyDevice(server: any) {
  notifyCharacteristic = await findNotify(server);
  statusCapable = false;
  if (!notifyCharacteristic) return;
  const probe = await askForByte(DLE_EOT_PRINTER);
  statusCapable = probe !== null && (probe & 0b0001_0000) !== 0;
  if (!statusCapable) notifyCharacteristic = null;
}

/** Open the browser pairing dialog and connect. Returns the printer name. */
export async function connectBluetoothPrinter(): Promise<string> {
  if (!bluetoothSupported()) throw new Error('Bluetooth printing is not supported in this browser.');
  device = await (navigator as any).bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [
      ESC_POS_SERVICE,
      '000018f0-0000-1000-8000-00805f9b34fb',
      '0000ff00-0000-1000-8000-00805f9b34fb',
      '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Microchip / common BT-SPP module
    ],
  });
  device.addEventListener('gattserverdisconnected', () => { characteristic = null; notifyCharacteristic = null; });
  const server = await device.gatt.connect();
  characteristic = await findWritable(server);
  await classifyDevice(server);
  remember(device);
  return device.name || 'Bluetooth printer';
}

/**
 * Reconnect to the previously-paired printer WITHOUT showing the chooser, using
 * the origin's granted-devices list. Lets the kitchen tablet "connect once" and
 * silently reconnect on every reload. Returns the name, or null if unavailable.
 */
export async function tryReconnectBluetoothPrinter(): Promise<string | null> {
  if (isBluetoothConnected()) return device.name || 'Bluetooth printer';
  if (!bluetoothSupported() || inEmbeddedFrame()) return null;
  let wantId: string | null = null;
  try { wantId = localStorage.getItem(REMEMBER_ID); } catch { /* ignore */ }
  if (!wantId) return null;
  try {
    const bt = (navigator as any).bluetooth;
    if (!bt.getDevices) return null; // older browsers: needs a manual reconnect
    const devices: any[] = await bt.getDevices();
    const found = devices.find((d) => d.id === wantId);
    if (!found) return null;
    device = found;
    device.addEventListener('gattserverdisconnected', () => { characteristic = null; notifyCharacteristic = null; });
    const server = await device.gatt.connect();
    characteristic = await findWritable(server);
    await classifyDevice(server);
    return device.name || 'Bluetooth printer';
  } catch {
    return null;
  }
}

async function ensureConnected() {
  if (characteristic && device?.gatt?.connected) return;
  if (device && device.gatt) {
    const server = await device.gatt.connect();
    characteristic = await findWritable(server);
    await classifyDevice(server);
    return;
  }
  throw new Error('No printer connected.');
}

/** Send one or more ESC/POS copies without allowing concurrent jobs to interleave. */
async function writeTextBluetooth(text: string, copies: number): Promise<void> {
  await ensureConnected();
  if (!characteristic) throw new Error('Not connected.');
  const enc = new TextEncoder();
  const INIT = [0x1b, 0x40];           // ESC @  (reset)
  const FEED_CUT = [0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x00]; // feed + full cut
  const body = Array.from(enc.encode(text));
  const payload = Uint8Array.from([...INIT, ...body, ...FEED_CUT]);
  const copyCount = Math.max(1, Math.min(3, Math.floor(copies)));

  // BLE writes are MTU-limited; chunk to be safe.
  const CHUNK = 180;
  for (let copy = 0; copy < copyCount; copy += 1) {
    for (let i = 0; i < payload.length; i += CHUNK) {
      const slice = payload.slice(i, i + CHUNK);
      if (characteristic.properties.writeWithoutResponse) {
        await characteristic.writeValueWithoutResponse(slice);
      } else {
        await characteristic.writeValue(slice);
      }
      await new Promise((resolve) => setTimeout(resolve, 18));
    }
  }
}

/**
 * Print, and say honestly what happened.
 *
 * Status is checked BEFORE the write — there is no point spooling a ticket at
 * a printer with its cover open — and again after, because paper runs out
 * mid-ticket more often than it runs out between them, and a half ticket is
 * indistinguishable from a whole one once it is in someone's hand.
 *
 * A device that cannot be queried still reports success, but flagged
 * `verified: false`. That is the truth, and the UI shows it.
 */
export async function printTextBluetooth(text: string, copies = 1): Promise<PrintOutcome> {
  const job = bluetoothPrintQueue.then(async (): Promise<PrintOutcome> => {
    const before = await queryPrinterStatus();
    const beforeProblem = statusProblem(before);
    if (beforeProblem) return { ok: false, reason: beforeProblem };

    await writeTextBluetooth(text, copies);

    const after = await queryPrinterStatus();
    const afterProblem = statusProblem(after);
    if (afterProblem) return { ok: false, reason: `${afterProblem} — the ticket may be incomplete` };

    return { ok: true, verified: after.known };
  });

  bluetoothPrintQueue = job.then(() => undefined, () => undefined);
  return job;
}

const statusProblem = (status: PrinterStatus): string | null => {
  if (!status.known) return null;
  if (!status.online) return 'The printer is offline';
  if (status.coverOpen) return 'The printer cover is open';
  if (status.paperOut) return 'The printer is out of paper';
  return null;
};

export function disconnectBluetoothPrinter(): void {
  try { device?.gatt?.disconnect(); } catch { /* ignore */ }
  device = null;
  characteristic = null;
  notifyCharacteristic = null;
  statusCapable = false;
}

/** Disconnect AND forget the remembered printer (stops auto-reconnect). */
export function forgetBluetoothPrinter(): void {
  disconnectBluetoothPrinter();
  try { localStorage.removeItem(REMEMBER_ID); localStorage.removeItem(REMEMBER_NAME); } catch { /* ignore */ }
}
