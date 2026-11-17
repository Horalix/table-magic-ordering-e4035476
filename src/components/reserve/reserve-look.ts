import { siteImage, siteSrc, siteSrcSet, type SiteImageName } from '@/components/site/site-image-data';
import roomImages from '@/components/vera/room-images.json';

/**
 * What the booking pages (/reserve/, /reservation/<id>) look like for each
 * restaurant: its photographs and its wordmark. The colours, the serif and
 * the corners come from the restaurant's theme (src/index.css), as on its
 * menu. A restaurant without an entry here gets La Soul's linen table, which
 * shows no name.
 */

export interface ReservePhoto {
  src: string;
  srcSet: string;
  width: number;
  height: number;
  /** A few bytes of the photograph, shown while it loads. */
  blur: string;
  /** Where the eye should stay when the frame crops it (CSS object-position). */
  focus: string;
}

export interface ReserveLook {
  /** Landscape: the band across the top of a phone. */
  wide: ReservePhoto;
  /** The arch beside the form on a wide screen. */
  tall: ReservePhoto;
  /** The restaurant's name as it writes it; null draws the name in its serif. */
  wordmark: { src: string; width: number; height: number; className: string } | null;
}

const site = (name: SiteImageName, focus: string): ReservePhoto => {
  const { width, height, blur } = siteImage(name);
  return { src: siteSrc(name, 960), srcSet: siteSrcSet(name), width, height, blur, focus };
};

type Room = keyof typeof roomImages;
const room = (name: Room, focus: string): ReservePhoto => {
  const r = roomImages[name];
  return {
    src: `/site/vera/${name}-960.webp`,
    srcSet: r.widths.map((w) => `/site/vera/${name}-${w}.webp ${w}w`).join(', '),
    width: r.width, height: r.height, blur: r.blur, focus,
  };
};

const LA_SOUL: ReserveLook = {
  // The coffee pot and dates on linen; then the cakes, plated.
  wide: site('visit', '70% 55%'),
  tall: site('story-cake', '50% 55%'),
  wordmark: { src: '/brand/wordmark-dark.webp', width: 960, height: 124, className: 'h-[13px] w-auto' },
};

const LOOKS: Record<string, ReserveLook> = {
  lasoul: LA_SOUL,
  veraitalia: {
    // The dining room under its lit arches.
    wide: room('room-2', '50% 40%'),
    tall: room('room-2', '58% 50%'),
    wordmark: { src: '/brand/vera/wordmark-ink.webp', width: 1434, height: 193, className: 'h-[13px] w-auto' },
  },
};

export function reserveLook(venueSlug: string): ReserveLook {
  return LOOKS[venueSlug] ?? { ...LA_SOUL, wordmark: null };
}
