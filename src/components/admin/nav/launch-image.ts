/**
 * The picture an iPhone shows while the Manager app opens.
 *
 * Without one, a Home Screen web app opens on a white screen for a moment
 * before the admin paints: the flash that makes it feel like a web page.
 * iPhone takes the picture from <link rel="apple-touch-startup-image"> on the
 * page it was added from, and only uses one whose size is exactly the
 * screen's.
 *
 * Rather than ship a file for every iPhone and iPad ever made (a dozen or
 * more per restaurant, and a new one missing each September), the picture is drawn
 * here for the screen in hand: the admin's own background with the Manager
 * icon in the middle, portrait and landscape, as a data: address in the link.
 * It costs no download and fits a phone that did not exist when this was
 * written. (The same method as Google's PWACompat.) It is on the page well
 * before anyone can reach Share → Add to Home Screen.
 */

const REL = 'apple-touch-startup-image';
/** The icon's width on the launch picture, in points: what iPhone's own app launch screens use, near enough. */
const ICON_POINTS = 96;

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('icon'));
    img.src = src;
  });
}

function draw(width: number, height: number, ratio: number, background: string, icon: HTMLImageElement | null): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (icon) {
    const size = ICON_POINTS * ratio;
    const x = (canvas.width - size) / 2;
    const y = (canvas.height - size) / 2;
    const radius = size * 0.225;
    // The icon with iPhone's rounded corners, as it looks on the Home Screen.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + size, y, x + size, y + size, radius);
    ctx.arcTo(x + size, y + size, x, y + size, radius);
    ctx.arcTo(x, y + size, x, y, radius);
    ctx.arcTo(x, y, x + size, y, radius);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(icon, x, y, size, size);
    ctx.restore();
  }
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/**
 * Puts the launch picture on the page, once. `background` is any CSS colour;
 * `icon` the Manager icon's address. Does nothing where there is no canvas.
 */
export async function addLaunchImage(icon: string, background: string): Promise<void> {
  if (typeof document === 'undefined' || document.querySelector(`link[rel="${REL}"]`)) return;
  const short = Math.min(window.screen.width, window.screen.height);
  const long = Math.max(window.screen.width, window.screen.height);
  const ratio = window.devicePixelRatio || 1;
  if (!short || !long) return;
  const image = await load(icon).catch(() => null);
  // Asked for twice (two admin pages in a row) while the icon loaded.
  if (document.querySelector(`link[rel="${REL}"]`)) return;
  for (const [orientation, width, height] of [['portrait', short, long], ['landscape', long, short]] as const) {
    const href = draw(width, height, ratio, background, image);
    if (!href) continue;
    const link = document.createElement('link');
    link.rel = REL;
    link.media = `(orientation: ${orientation})`;
    link.href = href;
    document.head.appendChild(link);
  }
}
