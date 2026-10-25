import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __directForTests, connectSerialPrinter, connectUsbPrinter, directPrinterName, findBulkOut, forgetDirectPrinters,
  printBytesDirect, tryReconnectUsbPrinter,
} from '@/lib/printer-direct';

/**
 * WebUSB and Web Serial, against fakes shaped like Chrome's objects. What is
 * pinned: the right endpoint is found, bytes reach it, a refused transfer is
 * a failure, a remembered printer comes back without a chooser, and a
 * Windows driver conflict is explained instead of thrown raw.
 */

const printerConfig = {
  interfaces: [{
    interfaceNumber: 0,
    alternates: [{ endpoints: [{ direction: 'in', type: 'bulk', endpointNumber: 2 }, { direction: 'out', type: 'bulk', endpointNumber: 1 }] }],
  }],
};

function fakeUsbDevice(over: Record<string, unknown> = {}) {
  const sent: Uint8Array[] = [];
  const device = {
    vendorId: 0x04b8, productId: 0x0e28, manufacturerName: 'EPSON', productName: 'TM-T20III',
    opened: false, configuration: null as unknown,
    open: vi.fn(async () => { device.opened = true; }),
    selectConfiguration: vi.fn(async () => { device.configuration = printerConfig; }),
    claimInterface: vi.fn(async () => {}),
    releaseInterface: vi.fn(async () => {}),
    close: vi.fn(async () => { device.opened = false; }),
    transferOut: vi.fn(async (_ep: number, data: Uint8Array) => { sent.push(data); return { status: 'ok' }; }),
    ...over,
  };
  return { device, sent };
}

beforeEach(() => { __directForTests.reset(); localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('USB', () => {
  it('finds the bulk OUT endpoint', () => {
    expect(findBulkOut(printerConfig)).toEqual({ iface: 0, endpoint: 1 });
    expect(findBulkOut({ interfaces: [] })).toBeNull();
  });

  it('connects, prints to the endpoint and reports an unverified success', async () => {
    const { device, sent } = fakeUsbDevice();
    vi.stubGlobal('navigator', { usb: { requestDevice: vi.fn(async () => device), getDevices: vi.fn(async () => [device]) } });
    expect(await connectUsbPrinter()).toBe('EPSON TM-T20III');
    expect(directPrinterName()).toBe('EPSON TM-T20III');
    const outcome = await printBytesDirect(Uint8Array.from([0x1b, 0x40, 0x41]));
    expect(outcome).toEqual({ ok: true, verified: false });
    expect(device.transferOut).toHaveBeenCalledWith(1, expect.any(Uint8Array));
    expect(Array.from(sent[0])).toEqual([0x1b, 0x40, 0x41]);
  });

  it('a refused transfer is a failure, not a print', async () => {
    const { device } = fakeUsbDevice({ transferOut: vi.fn(async () => ({ status: 'stall' })) });
    vi.stubGlobal('navigator', { usb: { requestDevice: vi.fn(async () => device) } });
    await connectUsbPrinter();
    expect(await printBytesDirect(Uint8Array.from([1]))).toEqual({ ok: false, reason: 'The USB printer refused the data (stall)' });
  });

  it('comes back after a reload without the chooser', async () => {
    const { device } = fakeUsbDevice();
    vi.stubGlobal('navigator', { usb: { requestDevice: vi.fn(async () => device), getDevices: vi.fn(async () => [device]) } });
    await connectUsbPrinter();
    __directForTests.reset();
    device.opened = false;
    expect(await tryReconnectUsbPrinter()).toBe('EPSON TM-T20III');
  });

  it('explains a Windows driver holding the printer', async () => {
    const { device } = fakeUsbDevice({ claimInterface: vi.fn(async () => { throw new Error('Unable to claim interface.'); }) });
    vi.stubGlobal('navigator', { usb: { requestDevice: vi.fn(async () => device) } });
    await expect(connectUsbPrinter()).rejects.toThrow(/printer driver is holding this printer/);
  });
});

describe('serial / classic Bluetooth', () => {
  it('writes the bytes to the port', async () => {
    const written: Uint8Array[] = [];
    const port = {
      writable: null as unknown,
      open: vi.fn(async () => {
        port.writable = { getWriter: () => ({ write: async (b: Uint8Array) => { written.push(b); }, releaseLock: () => {} }) };
      }),
      getInfo: () => ({ bluetoothServiceClassId: '00001101-0000-1000-8000-00805f9b34fb' }),
      close: vi.fn(async () => { port.writable = null; }),
    };
    vi.stubGlobal('navigator', { serial: { requestPort: vi.fn(async () => port), getPorts: vi.fn(async () => [port]) } });
    expect(await connectSerialPrinter()).toBe('Bluetooth printer');
    expect(port.open).toHaveBeenCalledWith({ baudRate: 9600 });
    expect(await printBytesDirect(Uint8Array.from([0x0a]))).toEqual({ ok: true, verified: false });
    expect(written).toHaveLength(1);
    await forgetDirectPrinters();
    expect(directPrinterName()).toBeNull();
  });

  it('says so when nothing is connected', async () => {
    expect(await printBytesDirect(Uint8Array.from([1]))).toEqual({ ok: false, reason: 'No USB or serial printer is connected' });
  });
});
