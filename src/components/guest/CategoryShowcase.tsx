import SmartImage from '@/components/ui/SmartImage';
import type { ShowcasePhoto } from '@/lib/category-showcase';

interface CategoryShowcaseProps {
  /**
   * The category's own picture — several of its dishes photographed together
   * (scripts/category-photos.mjs) — as "/covers/<key>", served 3:2 at 640,
   * 1080 and 1600 px wide.
   */
  picture?: string;
  /** Without a picture: its dishes' own photographs (src/lib/category-showcase.ts). */
  photos: ShowcasePhoto[];
  /** The corners: La Soul's soft, Vera Italia's nearly square. */
  radius: string;
  /** The first category on the page: its picture loads first. */
  priority?: boolean;
}

/**
 * A category on the menu home. Each has its own picture of several of its
 * dishes on one table. One added later, before it has a picture, shows up to
 * three of its dishes instead: one large and two small beside it, every cell
 * square — the large one spans two columns and two rows of a three-column
 * grid — so no plate is cropped.
 */
const CategoryShowcase = ({ picture, photos, radius, priority = false }: CategoryShowcaseProps) => {
  if (picture) {
    return (
      <span aria-hidden className={`relative block aspect-[3/2] overflow-hidden bg-muted ${radius}`}>
        <img
          src={`${picture}-1080.webp`}
          srcSet={`${picture}-640.webp 640w, ${picture}-1080.webp 1080w, ${picture}-1600.webp 1600w`}
          sizes="(max-width: 640px) 92vw, 600px"
          alt=""
          width={1080}
          height={720}
          loading={priority ? 'eager' : 'lazy'}
          // React 18 only passes the lowercase attribute through.
          {...({ fetchpriority: priority ? 'high' : 'auto' } as Record<string, string>)}
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.02]"
        />
      </span>
    );
  }

  const shown = photos.slice(0, 3);
  if (!shown.length) return <span aria-hidden className={`block aspect-[3/2] bg-muted ${radius}`} />;
  const layout = shown.length === 3 ? 'grid-cols-3' : shown.length === 2 ? 'grid-cols-2' : 'grid-cols-1';
  return (
    <span aria-hidden className={`grid ${layout} gap-1`}>
      {shown.map((p, i) => {
        const large = shown.length === 3 && i === 0;
        const sizes = shown.length === 1 ? '(max-width: 640px) 92vw, 560px'
          : large || shown.length === 2 ? '(max-width: 640px) 62vw, 380px'
          : '(max-width: 640px) 31vw, 190px';
        return (
          <span key={p.id} className={`relative block aspect-square overflow-hidden bg-muted ${radius} ${large ? 'col-span-2 row-span-2' : ''}`}>
            <SmartImage
              id={p.id}
              src={p.src}
              alt=""
              width={large || shown.length < 3 ? 560 : 280}
              height={large || shown.length < 3 ? 560 : 280}
              sizes={sizes}
              priority={priority && i === 0}
              wrapperClassName="absolute inset-0 w-full h-full"
              className="w-full h-full object-cover"
            />
          </span>
        );
      })}
    </span>
  );
};

export default CategoryShowcase;
