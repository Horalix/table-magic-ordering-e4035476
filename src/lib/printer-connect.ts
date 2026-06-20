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

let device: any = null;
let characteristic: any = null;

export const connectedPrinterName = (): string | null =>
  device && device.gatt?.connected ? (device.name || 'Bluetooth printer') : null;

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
  return device.name || 'Bluetooth printer';
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

/** Send plain text to the printer as an ESC/POS receipt (init + text + cut). */
export async function printTextBluetooth(text: string): Promise<void> {
  await ensureConnected();
  if (!characteristic) throw new Error('Not connected.');
  const enc = new TextEncoder();
  const INIT = [0x1b, 0x40];           // ESC @  (reset)
  const FEED_CUT = [0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x00]; // feed + full cut
  const body = Array.from(enc.encode(text));
  const payload = Uint8Array.from([...INIT, ...body, ...FEED_CUT]);

  // BLE writes are MTU-limited; chunk to be safe.
  const CHUNK = 180;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const slice = payload.slice(i, i + CHUNK);
    if (characteristic.properties.writeWithoutResponse) {
      await characteristic.writeValueWithoutResponse(slice);
    } else {
      await characteristic.writeValue(slice);
    }
    await new Promise((r) => setTimeout(r, 18));
  }
}

export function disconnectBluetoothPrinter(): void {
  try { device?.gatt?.disconnect(); } catch { /* ignore */ }
  device = null;
  characteristic = null;
}
