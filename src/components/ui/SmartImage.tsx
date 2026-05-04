import React, { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface SmartImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'loading' | 'srcSet'> {
  src?: string;
  alt: string;
  width: number;
  height: number;
  priority?: boolean;
  wrapperClassName?: string;
  fallbackText?: string;
}

/**
 * Build optimized image URL.
 * - Supabase Storage URLs → use native render endpoint (?width=&quality=&format=webp)
 * - Other URLs → route through free wsrv.nl WebP CDN
 */
const WSRV = 'https://wsrv.nl/?';

const buildUrl = (src: string, w: number, h: number, dpr = 1) => {
  if (src.startsWith('data:') || src.startsWith('blob:')) return src;
  if (typeof window !== 'undefined' && src.startsWith(window.location.origin)) return src;

  // Supabase Storage public URL → use native image transform endpoint
  // /storage/v1/object/public/<bucket>/<path>  →  /storage/v1/render/image/public/<bucket>/<path>?...
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
  src, alt, width, height, priority = false, wrapperClassName, fallbackText, className, ...rest
}: SmartImageProps) => {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => { setLoaded(false); setErrored(false); }, [src]);
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0) setLoaded(true);
  }, [src]);

  if (!src || errored) {
    return (
      <div
        className={cn('flex items-center justify-center bg-primary/5 text-primary/40 font-serif', wrapperClassName)}
        style={{ aspectRatio: `${width}/${height}` }}
        aria-label={alt}
      >
        <span className="text-2xl">{(fallbackText || alt || '·')[0]}</span>
      </div>
    );
  }

  const url1x = buildUrl(src, width, height, 1);
  const url2x = buildUrl(src, width, height, 2);

  return (
    <div className={cn('relative overflow-hidden bg-muted', wrapperClassName)} style={{ aspectRatio: `${width}/${height}` }}>
      {!loaded && <div className="absolute inset-0 shimmer" />}
      <img
        ref={imgRef}
        src={url1x}
        srcSet={`${url1x} 1x, ${url2x} 2x`}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        // @ts-ignore
        fetchpriority={priority ? 'high' : 'auto'}
        onLoad={() => setLoaded(true)}
        onError={() => {
          if (imgRef.current && imgRef.current.src !== src) {
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
    </div>
  );
};

export default SmartImage;
