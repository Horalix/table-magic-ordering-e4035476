import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useNoIndex } from './noindex';
import { useStaffDocument } from '@/components/staff/useStaffDocument';

/**
 * "Not found" and the staff screens are served the home page's HTML, which
 * says "index" and names the home page as its canonical. Once the app runs
 * they say "noindex" and name no canonical, and the next page is left as it
 * would have been.
 */

const robots = () => document.head.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null;

beforeEach(() => {
  // What every address is served before the app runs: the home page's head.
  document.head.innerHTML = [
    '<meta name="robots" content="index, follow, max-image-preview:large" />',
    '<link rel="canonical" href="https://lasoul.net/" />',
    '<link rel="alternate" hreflang="bs" href="https://lasoul.net/bs/" />',
    '<link rel="alternate" hreflang="x-default" href="https://lasoul.net/" />',
  ].join('');
});

describe('useNoIndex', () => {
  it('says noindex, with no canonical or language alternates', () => {
    renderHook(() => useNoIndex());
    expect(robots()).toBe('noindex, nofollow');
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.head.querySelector('link[hreflang]')).toBeNull();
  });

  it('puts the robots tag back when the page closes', () => {
    const { unmount } = renderHook(() => useNoIndex());
    unmount();
    expect(robots()).toBe('index, follow, max-image-preview:large');
  });

  it('adds one where the page had none, and takes it away again', () => {
    document.head.innerHTML = '';
    const { unmount } = renderHook(() => useNoIndex());
    expect(robots()).toBe('noindex, nofollow');
    unmount();
    expect(robots()).toBeNull();
  });

  it('is what every staff screen says, sign-in screens included', () => {
    renderHook(() => useStaffDocument('Admin sign in'));
    expect(robots()).toBe('noindex, nofollow');
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
  });
});
