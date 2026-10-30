import { useVenue } from '@/hooks/useVenue';

/** The restaurant's small mark, dark, for light screens: La Soul's emblem or Vera Italia's arch monogram. */
const BrandEmblem = ({ className }: { className?: string }) => {
  const venue = useVenue();
  return venue.slug === 'veraitalia'
    ? <img src="/brand/vera/monogram-ink.webp" alt="Vera Italia" width={501} height={664} className={`object-contain ${className ?? ''}`} />
    : <img src="/brand/emblem-dark.webp" alt="La Soul" width={480} height={480} className={className} />;
};

export default BrandEmblem;
