import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import imageManifest from '@/lib/image-manifest.json';
import { localImageFile } from '@/lib/menu-image';

interface SmartImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'loading' | 'srcSet'> {
  src?: string;
  /** framer-motion shared-element id — morphs this image between views. */
  layoutId?: string;
  /**
   * Stable row id (menu_item / category). When this id exists in the local
   * image manifest, SmartImage serves the prebuilt same-origin WebP ladder
   * with blur-up instead of hitting an external CDN. Falls back to `src`
   * (via CDN) when the id is missing — so newly added rows never break.
   */
  id?: string;
  alt: string;
  width: number;
  height: number;
  priority?: boolean;
  wrapperClassName?: string;
  fallbackText?: string;
  /** Override the responsive `sizes` hint (defaults to the intrinsic width). */
  sizes?: string;
  /**
   * The box is square (list thumbnails, chips). Uses the pre-cut square crops
   * when the manifest has them: a landscape photo cover-cropped into a square
   * only uses its middle, so the regular ladder delivered fewer pixels than
   * the box needed and the thumbnail looked soft.
   */
  square?: boolean;
}

interface ManifestEntry {
  widths: number[];
  /** The image_url the local files were built for. */
  src?: string;
  /** Square crops (sq-<n>.webp), cut around the dish. Absent on old builds. */
  squares?: number[];
  blur: string;
  ext: string;
  /**
   * A hash of the files themselves (scripts/image-versions.mjs). It goes on
   * every local address, so a re-shot photo or re-cut crop is a new address:
   * the service worker caches these CacheFirst, and the same file name with
   * new content would otherwise keep showing the old picture.
   */
  v?: string;
}

type FetchPriorityAttributes = {
  fetchpriority?: 'high' | 'low' | 'auto';
};

const manifest = imageManifest as Record<string, ManifestEntry>;

/**
 * Build optimized CDN URL (fallback path — used only when an image is not in
 * the local manifest, e.g. added after the last `npm run images`).
 * - Supabase Storage URLs use the native render endpoint (?width=&quality=&format=webp)
 * - Other URLs use the free wsrv.nl WebP CDN
 */
const WSRV = 'https://wsrv.nl/?';

const buildUrl = (src: string, w: number, h: number, dpr = 1) => {
  if (src.startsWith('data:') || src.startsWith('blob:')) return src;
  // Same-origin paths (/img/…, /covers/…) are already ours; sending them to an
  // external resizer fails, because it cannot reach a relative URL.
  if (src.startsWith('/') && !src.startsWith('//')) return src;
  if (typeof window !== 'undefined' && src.startsWith(window.location.origin)) return src;

  const supaMatch = src.match(/^(https?:\/\/[^/]+)\/storage\/v1\/object\/public\/(.+)$/);
  if (supaMatch) {
    const [, origin, rest] = supaMatch;
    const params = new URLSearchParams({
      width: String(Math.round(w * dpr)),
      height: String(Math.round(h * dpr)),
      resize: 'cover',
      quality: '78',
    });
    return `${origin}/storage/v1/render/image/public/${rest}?${params.toString()}`;
  }

  const params = new URLSearchParams({
    url: src.replace(/^https?:\/\//, ''),
    w: String(Math.round(w * dpr)),
    h: String(Math.round(h * dpr)),
    fit: 'cover',
    output: 'webp',
    q: '78',
    we: '',
  });
  return WSRV + params.toString();
};

const SmartImage = ({
  src, id, layoutId, alt, width, height, priority = false, wrapperClassName, fallbackText, className, sizes, square = false, ...rest
}: SmartImageProps) => {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  // When the local asset 404s, drop to the CDN/original path for this render.
  const [forceRemote, setForceRemote] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => { setLoaded(false); setErrored(false); setForceRemote(false); }, [src, id]);
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0) setLoaded(true);
  }, [src, id]);

  // The local files stand in for the photo they were built from. When a new
  // photo is uploaded in the admin, `src` changes and the upload is shown
  // (through the CDN) until the next image build picks it up.
  const entry = id && !forceRemote ? manifest[id] : undefined;
  const local = entry && (!entry.src || !src || entry.src === src) ? entry : undefined;

  if ((!src && !local) || errored) {
    return (
      <div
        className={cn('flex items-center justify-center bg-primary/5 text-primary/40 font-serif', wrapperClassName)}
        style={{ aspectRatio: `${width}/${height}` }}
        role="img"
        aria-label={alt}
      >
        <span className="text-2xl">{(fallbackText || alt || '?')[0]}</span>
      </div>
    );
  }

  // ---- Resolve src / srcSet -------------------------------------------
  let url1x: string;
  let srcSet: string;
  let blur: string | undefined;

  if (local && square && local.squares?.length) {
    const file = localImageFile(id!, local);
    blur = local.blur;
    srcSet = local.squares.map((w) => `${file(`sq-${w}`)} ${w}w`).join(', ');
    url1x = file(`sq-${local.squares[local.squares.length - 1]}`);
  } else if (local) {
    const file = localImageFile(id!, local);
    blur = local.blur;
    srcSet = local.widths.map((w) => `${file(String(w))} ${w}w`).join(', ');
    // Default `src` = largest variant (browser overrides via srcSet+sizes).
    url1x = file(String(local.widths[local.widths.length - 1]));
  } else {
    url1x = buildUrl(src!, width, height, 1);
    srcSet = `${url1x} 1x, ${buildUrl(src!, width, height, 2)} 2x`;
  }

  /**
   * `sizes` describes the RENDERED width, which for most cards is a fraction
   * of the viewport rather than the intrinsic `width` prop. Passing a fixed
   * `${width}px` made the browser pick a variant sized for the smallest
   * possible slot, so a full-width card image rendered visibly soft on a
   * phone. The default now says "as wide as the card can get", and call sites
   * that genuinely are fixed-size pass their own.
   */
  const resolvedSizes = sizes
    ?? (local ? (square ? `${width}px` : `(max-width: 640px) 50vw, ${width}px`) : undefined);
  const fetchPriorityAttributes: FetchPriorityAttributes = {
    fetchpriority: priority ? 'high' : 'auto',
  };

  return (
    <motion.div
      layoutId={layoutId}
      className={cn('relative overflow-hidden bg-muted', wrapperClassName)}
      style={{ aspectRatio: `${width}/${height}` }}
    >
      {/* Placeholder: blur-up for local assets, shimmer otherwise. */}
      {!loaded && (
        blur ? (
          <img
            src={blur}
            alt=""
            aria-hidden
            className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl"
          />
        ) : (
          <div className="absolute inset-0 shimmer" />
        )
      )}
      <img
        ref={imgRef}
        src={url1x}
        srcSet={srcSet}
        sizes={resolvedSizes}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        {...fetchPriorityAttributes}
        onLoad={() => setLoaded(true)}
        onError={() => {
          // Local asset missing: retry via CDN/original for this id.
          if (local) { setForceRemote(true); return; }
          // CDN transform failed: try the raw original URL once.
          if (src && imgRef.current && imgRef.current.src !== src) {
            imgRef.current.srcset = '';
            imgRef.current.src = src;
            return;
          }
          setErrored(true);
        }}
        className={cn(
          'w-full h-full object-cover transition-[opacity,transform] duration-500 ease-out will-change-[opacity,transform]',
          loaded ? 'opacity-100 scale-100' : 'opacity-0 scale-[1.03]',
          className
        )}
        {...rest}
      />
    </motion.div>
  );
};

export default SmartImage;
