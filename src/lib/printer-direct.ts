/**
 * USB and serial thermal printers, straight from Chrome — no print dialog.
 *
 * Two gaps the Bluetooth client (printer-connect.ts) cannot close:
 *
 *  - **USB on an Android tablet.** Chrome on Android can talk to a USB
 *    printer through an OTG cable with WebUSB, because Android has no printer
 *    driver holding the device. (On Windows the printer driver does hold it,
 *    so there the "This device" print-dialog route is the one that works.)
 *  - **"Classic" Bluetooth printers.** Most cheap 58/80 mm Bluetooth printers
 *    speak Bluetooth SPP, not Bluetooth Low Energy, and Web Bluetooth only
 *    does BLE — so they never appear in its chooser. Web Serial reaches them:
 *    desktop Chrome 117+, Android Chrome 137+. It also reaches USB-serial
 *    printers.
 *
 * Both are write-only: there is no status channel, so a success is reported
 * as unverified, and the UI says so. Chosen devices are remembered and
 * reconnected without a chooser on the next load.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PrintOutcome } from '@/lib/print-outcome';

const nav = () => (typeof navigator === 'undefined' ? undefined : (navigator as any));

export const usbSupported = () => !!nav()?.usb;
export const serialSupported = () => !!nav()?.serial;

const USB_KEY = 'kitchen:usbPrinter';
const SERIAL_KEY = 'kitchen:serialPrinter';

let usb: { device: any; endpoint: number; iface: number } | null = null;
let serial: { port: any; name: string } | null = null;
let queue: Promise<unknown> = Promise.resolve();

const usbName = (d: any) => [d.manufacturerName, d.productName].filter(Boolean).join(' ') || 'USB printer';

/** The bulk OUT endpoint a printer takes its data on. */
export function findBulkOut(configuration: any): { iface: number; endpoint: number } | null {
  for (const intf of configuration?.interfaces ?? []) {
    for (const alt of intf.alternates ?? []) {
      const out = (alt.endpoints ?? []).find((e: any) => e.direction === 'out' && e.type === 'bulk');
      if (out) return { iface: intf.interfaceNumber, endpoint: out.endpointNumber };
    }
  }
  return null;
}

async function openUsb(device: any): Promise<string> {
  await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);
  const target = findBulkOut(device.configuration);
  if (!target) throw new Error('This USB device has no printer output. Is it the receipt printer?');
  await device.claimInterface(target.iface);
  usb = { device, endpoint: target.endpoint, iface: target.iface };
  try { localStorage.setItem(USB_KEY, JSON.stringify({ vendorId: device.vendorId, productId: device.productId })); } catch { /* ignore */ }
  return usbName(device);
}

/** Pick a USB printer (Chrome shows its chooser). Printer-class devices first. */
export async function connectUsbPrinter(showAll = false): Promise<string> {
  if (!usbSupported()) throw new Error('USB printing needs Chrome on Android, Windows or a Mac.');
  const device = await nav().usb.requestDevice({ filters: showAll ? [] : [{ classCode: 7 }] });
  try {
    return await openUsb(device);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/access denied|unable to claim|SecurityError/i.test(msg)) {
      throw new Error('The computer’s own printer driver is holding this printer. On Windows use “This device” (the print dialog) instead; on an Android tablet unplug and plug it back in.');
    }
    throw error;
  }
}

/** Reconnect the remembered USB printer without the chooser. */
export async function tryReconnectUsbPrinter(): Promise<string | null> {
  if (usb?.device?.opened) return usbName(usb.device);
  if (!usbSupported()) return null;
  let want: { vendorId: number; productId: number } | null = null;
  try { want = JSON.parse(localStorage.getItem(USB_KEY) ?? 'null'); } catch { /* ignore */ }
  if (!want) return null;
  try {
    const devices: any[] = await nav().usb.getDevices();
    const found = devices.find((d) => d.vendorId === want?.vendorId && d.productId === want?.productId);
    return found ? await openUsb(found) : null;
  } catch {
    return null;
  }
}

/** Pick a serial port: a classic-Bluetooth printer, or a USB-serial one. */
export async function connectSerialPrinter(): Promise<string> {
  if (!serialSupported()) throw new Error('This browser cannot reach serial or classic-Bluetooth printers. Use Chrome 117+ (computer) or 137+ (Android).');
  const port = await nav().serial.requestPort();
  return openSerial(port);
}

async function openSerial(port: any): Promise<string> {
  // ESC/POS printers default to 9600 baud on serial; Bluetooth SPP ignores it.
  if (!port.writable) await port.open({ baudRate: 9600 });
  const info = typeof port.getInfo === 'function' ? port.getInfo() : {};
  const name = info?.bluetoothServiceClassId ? 'Bluetooth printer' : 'Serial printer';
  serial = { port, name };
  try { localStorage.setItem(SERIAL_KEY, '1'); } catch { /* ignore */ }
  return name;
}

export async function tryReconnectSerialPrinter(): Promise<string | null> {
  if (serial?.port?.writable) return serial.name;
  if (!serialSupported()) return null;
  try {
    if (localStorage.getItem(SERIAL_KEY) !== '1') return null;
    const ports: any[] = await nav().serial.getPorts();
    return ports[0] ? await openSerial(ports[0]) : null;
  } catch {
    return null;
  }
}

/** Which direct printer is ready, if any — the name for the kitchen header. */
export const directPrinterName = (): string | null =>
  usb?.device?.opened ? usbName(usb.device) : serial?.port?.writable ? serial.name : null;

export const isDirectConnected = () => directPrinterName() !== null;

/** Send ESC/POS bytes to whichever direct printer is connected. One job at a time. */
export function printBytesDirect(bytes: Uint8Array): Promise<PrintOutcome> {
  const job = queue.then(async (): Promise<PrintOutcome> => {
    try {
      if (usb?.device?.opened) {
        const CHUNK = 4096;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          const result = await usb.device.transferOut(usb.endpoint, bytes.slice(i, i + CHUNK));
          if (result?.status && result.status !== 'ok') return { ok: false, reason: `The USB printer refused the data (${result.status})` };
        }
        return { ok: true, verified: false };
      }
      if (serial?.port?.writable) {
        const writer = serial.port.writable.getWriter();
        try { await writer.write(bytes); } finally { writer.releaseLock(); }
        return { ok: true, verified: false };
      }
      return { ok: false, reason: 'No USB or serial printer is connected' };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'The printer did not accept the ticket' };
    }
  });
  queue = job.catch(() => undefined);
  return job;
}

/** Forget both, so the tablet stops printing directly. */
export async function forgetDirectPrinters(): Promise<void> {
  try { if (usb?.device?.opened) { await usb.device.releaseInterface(usb.iface).catch(() => {}); await usb.device.close(); } } catch { /* ignore */ }
  try { if (serial?.port?.writable) await serial.port.close(); } catch { /* ignore */ }
  usb = null;
  serial = null;
  try { localStorage.removeItem(USB_KEY); localStorage.removeItem(SERIAL_KEY); } catch { /* ignore */ }
}

/** Test seam. */
export const __directForTests = {
  reset() { usb = null; serial = null; queue = Promise.resolve(); },
};
