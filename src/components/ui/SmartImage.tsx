import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import imageManifest from '@/lib/image-manifest.json';

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
}

interface ManifestEntry {
  widths: number[];
  blur: string;
  ext: string;
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
  src, id, layoutId, alt, width, height, priority = false, wrapperClassName, fallbackText, className, sizes, ...rest
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

  const local = id && !forceRemote ? manifest[id] : undefined;

  if ((!src && !local) || errored) {
    return (
      <div
        className={cn('flex items-center justify-center bg-primary/5 text-primary/40 font-serif', wrapperClassName)}
        style={{ aspectRatio: `${width}/${height}` }}
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

  if (local) {
    const base = `/menu/${id}`;
    blur = local.blur;
    srcSet = local.widths.map((w) => `${base}/${w}.webp ${w}w`).join(', ');
    // Default `src` = largest variant (browser overrides via srcSet+sizes).
    url1x = `${base}/${local.widths[local.widths.length - 1]}.webp`;
  } else {
    url1x = buildUrl(src!, width, height, 1);
    srcSet = `${url1x} 1x, ${buildUrl(src!, width, height, 2)} 2x`;
  }

  const resolvedSizes = sizes ?? (local ? `${width}px` : undefined);
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
