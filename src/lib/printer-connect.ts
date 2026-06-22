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
const ESC_POS_SERVICE = 0x18f0;
const ESC_POS_CHAR = 0x2af1;

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
  device.addEventListener('gattserverdisconnected', () => { characteristic = null; });
  const server = await device.gatt.connect();
  characteristic = await findWritable(server);
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
    device.addEventListener('gattserverdisconnected', () => { characteristic = null; });
    const server = await device.gatt.connect();
    characteristic = await findWritable(server);
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

export function printTextBluetooth(text: string, copies = 1): Promise<void> {
  const printJob = bluetoothPrintQueue.then(() => writeTextBluetooth(text, copies));
  bluetoothPrintQueue = printJob.catch(() => undefined);
  return printJob;
}

export function disconnectBluetoothPrinter(): void {
  try { device?.gatt?.disconnect(); } catch { /* ignore */ }
  device = null;
  characteristic = null;
}

/** Disconnect AND forget the remembered printer (stops auto-reconnect). */
export function forgetBluetoothPrinter(): void {
  disconnectBluetoothPrinter();
  try { localStorage.removeItem(REMEMBER_ID); localStorage.removeItem(REMEMBER_NAME); } catch { /* ignore */ }
}
