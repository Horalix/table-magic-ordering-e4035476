import { useVenue } from '@/hooks/useVenue';
import { DEMO_MODE } from '@/lib/demo-mode';
import { DemoMonogram } from '@/demo/ui/Brand';

/** The restaurant's small mark, dark, for light screens: La Soul's emblem or Vera Italia's arch monogram. */
const BrandEmblem = ({ className }: { className?: string }) => {
  const venue = useVenue();
  // The offline demo's restaurant has a drawn mark, not a logo file (docs/demo-mode.md).
  if (DEMO_MODE) return <DemoMonogram className={className} />;
  return venue.slug === 'veraitalia'
    ? <img src="/brand/vera/monogram-ink.webp" alt="Vera Italia" width={501} height={664} className={`object-contain ${className ?? ''}`} />
    : <img src="/brand/emblem-dark.webp" alt="La Soul" width={480} height={480} className={className} />;
};

export default BrandEmblem;
