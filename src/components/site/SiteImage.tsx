import { useState, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { siteImage, siteSrc, siteSrcSet, type SiteImageName } from './site-image-data';

interface Props {
  name: SiteImageName;
  alt: string;
  /** The rendered width, for the browser's pick from the ladder. */
  sizes: string;
  className?: string;
  /** Fills its (positioned) parent with object-cover. */
  fill?: boolean;
  /** Above the fold: fetched first, never lazily. */
  priority?: boolean;
  style?: CSSProperties;
  /**
   * On a phone (under 640px), this photograph instead: the same picture cut
   * to the shape the phone shows (scripts/site-images.mjs), so it does not
   * download the part it crops away.
   */
  phone?: SiteImageName;
  /** The phone photograph's rendered width. */
  phoneSizes?: string;
}

/** Tailwind's `sm`: below it the page has its phone layout. */
const PHONE_MEDIA = '(max-width: 639px)';

/**
 * A website photograph: responsive WebP, real width and height so nothing
 * shifts while it loads, a 16-pixel blurred copy painted underneath until the
 * real one arrives, and lazy loading below the fold.
 */
const SiteImage = ({ name, alt, sizes, className, fill = false, priority = false, style, phone, phoneSizes }: Props) => {
  const entry = siteImage(name);
  const [loaded, setLoaded] = useState(false);
  const img = (
    <img
      src={siteSrc(name, 960)}
      srcSet={siteSrcSet(name)}
      sizes={sizes}
      alt={alt}
      width={entry.width}
      height={entry.height}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      // React 18 passes only the lowercase attribute through.
      {...({ fetchpriority: priority ? 'high' : 'auto' } as Record<string, string>)}
      onLoad={() => setLoaded(true)}
      className={cn(fill && 'absolute inset-0 h-full w-full object-cover', className)}
      style={{
        ...(loaded ? null : { backgroundImage: `url("${entry.blur}")`, backgroundSize: 'cover', backgroundPosition: 'center' }),
        ...style,
      }}
    />
  );
  if (!phone) return img;
  const small = siteImage(phone);
  return (
    <picture>
      <source media={PHONE_MEDIA} srcSet={siteSrcSet(phone)} sizes={phoneSizes ?? sizes} width={small.width} height={small.height} />
      {img}
    </picture>
  );
};

export default SiteImage;
