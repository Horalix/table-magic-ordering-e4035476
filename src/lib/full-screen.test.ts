import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFullScreen, useTvApp } from './full-screen';

/**
 * The menu board offers a Full screen button until it fills the screen, and
 * names its own installable TV app, which opens it full screen every time.
 */

let fullscreenElement: Element | null = null;
const request = vi.fn(async () => {
  fullscreenElement = document.documentElement;
  document.dispatchEvent(new Event('fullscreenchange'));
});

beforeEach(() => {
  fullscreenElement = null;
  request.mockClear();
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement });
  Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: request });
});

afterEach(() => {
  delete (document as { fullscreenEnabled?: boolean }).fullscreenEnabled;
  delete (document as { fullscreenElement?: Element | null }).fullscreenElement;
  delete (document.documentElement as { requestFullscreen?: unknown }).requestFullscreen;
});

describe('useFullScreen', () => {
  it('offers the button until the page is full screen, then not', async () => {
    const { result } = renderHook(() => useFullScreen());
    expect(result.current.offer).toBe(true);
    await act(async () => result.current.enter());
    expect(request).toHaveBeenCalledWith({ navigationUI: 'hide' });
    expect(result.current.offer).toBe(false);
  });

  it('offers it again when the page leaves full screen', async () => {
    fullscreenElement = document.documentElement;
    const { result } = renderHook(() => useFullScreen());
    expect(result.current.offer).toBe(false);
    act(() => {
      fullscreenElement = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(result.current.offer).toBe(true);
  });

  it('offers nothing where the browser cannot go full screen', () => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => false });
    const { result } = renderHook(() => useFullScreen());
    expect(result.current.offer).toBe(false);
  });

  it('keeps the button when the browser refuses', async () => {
    request.mockRejectedValueOnce(new TypeError('Permissions check failed'));
    const { result } = renderHook(() => useFullScreen());
    await act(async () => result.current.enter());
    expect(result.current.offer).toBe(true);
  });
});

describe('useTvApp', () => {
  beforeEach(() => {
    document.head.innerHTML = '<link rel="manifest" href="/manifest.webmanifest" />';
  });
  const manifestHref = () => document.head.querySelector('link[rel="manifest"]')?.getAttribute('href');

  it("names the TV app's manifest while the board is up, and the page's own after", () => {
    const { unmount } = renderHook(() => useTvApp('/manifest-tv-lasoul.webmanifest'));
    expect(manifestHref()).toBe('/manifest-tv-lasoul.webmanifest');
    unmount();
    expect(manifestHref()).toBe('/manifest.webmanifest');
  });

  it.each(['lasoul', 'veraitalia'])("%s's TV app opens the board, full screen, as an app of its own", (venue) => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, `../../public/manifest-tv-${venue}.webmanifest`), 'utf8'));
    expect(manifest).toMatchObject({ id: '/tv', start_url: '/tv', scope: '/tv', display: 'fullscreen' });
    // What Chrome asks of an app it installs: a name and icons of 192 and 512 pixels.
    expect(manifest.name).toBeTruthy();
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    for (const icon of manifest.icons) expect(() => readFileSync(resolve(__dirname, `../../public${icon.src}`))).not.toThrow();
  });
});
