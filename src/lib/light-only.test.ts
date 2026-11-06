import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { LIGHT_ONLY, useLightOnly } from './light-only';
import { TV_PATH } from './tv-board';

/**
 * The menu board is shown as drawn on a browser set to darken pages: it says
 * "only light" while it is up, from the first paint, and the page after it
 * is left as it would have been.
 */

const scheme = () => document.head.querySelector('meta[name="color-scheme"]')?.getAttribute('content') ?? null;

beforeEach(() => {
  document.head.innerHTML = '';
  document.documentElement.style.colorScheme = '';
});

describe('useLightOnly', () => {
  it('says "only light", in the head and on the page', () => {
    renderHook(() => useLightOnly());
    expect(scheme()).toBe('only light');
    expect(document.documentElement.style.colorScheme).toBe(LIGHT_ONLY);
  });

  it('takes it away again when the page closes', () => {
    const { unmount } = renderHook(() => useLightOnly());
    unmount();
    expect(scheme()).toBeNull();
    expect(document.documentElement.style.colorScheme).toBe('');
  });

  it('puts back what the page said before', () => {
    document.head.innerHTML = '<meta name="color-scheme" content="light" />';
    const { unmount } = renderHook(() => useLightOnly());
    expect(scheme()).toBe('only light');
    unmount();
    expect(scheme()).toBe('light');
  });
});

describe('index.html', () => {
  const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');

  it("says it before the first paint, on the board's own address", () => {
    expect(html).toContain(TV_PATH.source);
    expect(html).toContain(`'${LIGHT_ONLY}'`);
  });
});
