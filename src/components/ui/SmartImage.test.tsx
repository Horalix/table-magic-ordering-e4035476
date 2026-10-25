import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SmartImage from './SmartImage';
import manifest from '@/lib/image-manifest.json';

// Any dish with locally built files.
const [ID, ENTRY] = Object.entries(manifest as Record<string, { src?: string }>).find(([, e]) => e.src)!;

const imgSrc = (container: HTMLElement) =>
  [...container.querySelectorAll('img')].map((i) => i.getAttribute('src') ?? '').find((s) => !s.startsWith('data:')) ?? '';

describe('SmartImage local files', () => {
  it('serves the locally built photo while the row still points at the photo it was built from', () => {
    const { container } = render(<SmartImage id={ID} src={ENTRY.src} alt="dish" width={108} height={108} square />);
    expect(imgSrc(container)).toMatch(new RegExp(`^/menu/${ID}/`));
  });

  // The manager uploads a new photo in Admin → Menu: it must show at once,
  // not be hidden behind the old locally built one.
  it('shows a newly uploaded photo instead of the old local files', () => {
    const uploaded = 'https://example.supabase.co/storage/v1/object/public/menu-images/new-photo.jpg';
    const { container } = render(<SmartImage id={ID} src={uploaded} alt="dish" width={108} height={108} square />);
    expect(imgSrc(container)).not.toMatch(/^\/menu\//);
    expect(imgSrc(container)).toContain('new-photo.jpg');
  });
});
