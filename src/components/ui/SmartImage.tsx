import React, { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface SmartImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'loading'> {
  src?: string;
  alt: string;
  /** Reserve space to avoid CLS */
  width: number;
  height: number;
  /** Eager + high priority for above-the-fold */
  priority?: boolean;
  /** Tailwind classes for the wrapper */
  wrapperClassName?: string;
  /** Fallback initial to render when image fails / missing */
  fallbackText?: string;
}

/**
 * Performance-tuned image:
 *  - lazy by default, eager + fetchpriority="high" when priority
 *  - decoding="async"
 *  - reserved width/height to kill CLS
 *  - skeleton shimmer until loaded
 *  - graceful fallback on error
 */
const SmartImage = ({
  src,
  alt,
  width,
  height,
  priority = false,
  wrapperClassName,
  fallbackText,
  className,
  ...rest
}: SmartImageProps) => {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setLoaded(false);
    setErrored(false);
  }, [src]);

  // If already cached, fire onLoad immediately
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0) setLoaded(true);
  }, [src]);

  if (!src || errored) {
    return (
      <div
        className={cn(
          'flex items-center justify-center bg-primary/5 text-primary/40 font-serif',
          wrapperClassName
        )}
        style={{ aspectRatio: `${width}/${height}` }}
        aria-label={alt}
      >
        <span className="text-2xl">{(fallbackText || alt || '·')[0]}</span>
      </div>
    );
  }

  return (
    <div className={cn('relative overflow-hidden bg-muted', wrapperClassName)} style={{ aspectRatio: `${width}/${height}` }}>
      {!loaded && (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-muted via-muted/60 to-muted" />
      )}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        // @ts-ignore - fetchpriority is valid HTML
        fetchpriority={priority ? 'high' : 'auto'}
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        className={cn(
          'w-full h-full object-cover transition-opacity duration-300',
          loaded ? 'opacity-100' : 'opacity-0',
          className
        )}
        {...rest}
      />
    </div>
  );
};

export default SmartImage;
