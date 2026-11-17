import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SmartImage from './SmartImage';
import { capDensity, resolveLocal } from '@/lib/image-sizes';
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

  // Phones cache these by address. Re-shot photos kept their file names, so
  // lists showed the old cached thumbnail while the dish sheet showed the new
  // photo; the version in the address is what makes a new photo a new file.
  it('puts the photo’s version on every local address', () => {
    const v = (manifest as Record<string, { v?: string }>)[ID].v;
    expect(v).toMatch(/^[0-9a-f]{10}$/);
    const { container } = render(<SmartImage id={ID} src={ENTRY.src} alt="dish" width={108} height={108} square />);
    const img = container.querySelector(`img[src^="/menu/${ID}/"]`)!;
    expect(img.getAttribute('src')).toContain(`.webp?v=${v}`);
    for (const candidate of (img.getAttribute('srcset') ?? '').split(',')) expect(candidate).toContain(`?v=${v} `);
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

// The demo's dishes, Vera Italia's, and a dish that borrows another's photo
// have one of the built files as their image_url. They were served that one
// file "1x, 2x" to every slot (a 108 px thumbnail fetched the 768 or 1152 px
// file); they get the width ladder like any other dish.
describe('SmartImage when image_url is itself a local file', () => {
  const ownFile = `/menu/${ID}/768.webp`;

  it('uses the width ladder for the row’s own file', () => {
    const { container } = render(<SmartImage id={ID} src={ownFile} alt="dish" width={340} height={255} sizes="(max-width: 420px) 82vw, 340px" />);
    const srcset = container.querySelector(`img[src^="/menu/${ID}/"]`)!.getAttribute('srcset') ?? '';
    expect(srcset).toMatch(/ 96w/);
    expect(srcset).not.toMatch(/ [12]x/);
  });

  it('uses the ladder of the folder the address names when the row id is another', () => {
    const { container } = render(<SmartImage id="some-other-row" src={`/menu/${ID}/1152.webp`} alt="dish" width={108} height={108} square sizes="108px" />);
    const img = container.querySelector(`img[src^="/menu/${ID}/"]`)!;
    expect(img.getAttribute('srcset')).toMatch(/sq-160\.webp\?v=\w+ 160w/);
  });

  it('leaves an address it did not build alone', () => {
    expect(resolveLocal('nope', '/menu/not-a-built-folder/1152.webp')).toBeUndefined();
    expect(resolveLocal(undefined, '/covers/lasoul-food-1080.webp')).toBeUndefined();
  });
});

describe('capDensity', () => {
  it('states every width at two-thirds on 2.5 dppx screens and keeps the original after', () => {
    expect(capDensity('(max-width: 420px) 82vw, 340px')).toBe(
      '(max-width: 420px) and (min-resolution: 2.5dppx) 55vw, (min-resolution: 2.5dppx) 227px, (max-width: 420px) 82vw, 340px',
    );
    expect(capDensity('148px')).toBe('(min-resolution: 2.5dppx) 99px, 148px');
  });

  it('leaves anything it cannot read as it is', () => {
    expect(capDensity('calc(100vw - 40px)')).toBe('calc(100vw - 40px)');
  });
});
