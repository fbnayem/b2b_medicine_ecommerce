import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Pill } from 'lucide-react';
import { mediaUrl } from '../../api/config';

/**
 * A product photograph, or the space where one would be.
 *
 * Two defects, one shape. The catalogue rendered `{picture && <img …>}`, so a
 * product without a photograph produced a card 8rem shorter than the ones
 * beside it — the grid stretches every card in a row to the tallest, and the
 * short one got the difference dumped into its footer. And when a photograph
 * failed to load there was no `onError`, so the browser drew its own
 * broken-image glyph inside a box whose `alt` was deliberately empty: the worst
 * of both, a picture of nothing with nothing to read.
 *
 * The box is therefore always reserved and always renders *something*. The
 * placeholder is the same tile the image sits on, so a catalogue of mixed
 * photographed and unphotographed products still reads as one grid.
 *
 * `alt` is empty by design. These sit directly above the brand name, and a
 * screen reader announcing the picture would read the product twice.
 */
export interface ProductImageProps {
  /** The stored path — `/media/catalogue/…` — or an absolute URL, or nothing. */
  path?: string;
  /** Tailwind height for the box. The list and the detail page differ. */
  className?: string;
}

export function ProductImage({ path, className }: ProductImageProps) {
  const source = mediaUrl(path);
  const [broken, setBroken] = useState(false);

  // A different product may render into this same position as a list
  // re-sorts or paginates, and a failure recorded for the previous one must
  // not suppress the new one's picture.
  useEffect(() => setBroken(false), [source]);

  const box = clsx(
    'flex w-full items-center justify-center rounded-control bg-surface-sunken',
    className ?? 'h-32',
  );

  if (!source || broken) {
    /*
     * Tinted rather than grey, and the icon in the brand rather than in a
     * washed-out neutral.
     *
     * Nothing in this catalogue has a photograph yet, so in practice every card
     * carries this box — a dozen identical grey rectangles down the page, each
     * the largest thing on its card and each saying nothing. It cannot become
     * smaller without the cards in a row losing their shared height, so instead
     * it stops looking like a failure and starts looking like part of the
     * product's own tile.
     */
    return (
      <div className={clsx(box, 'bg-brand-subtle')} aria-hidden="true">
        <Pill className="text-brand opacity-50" size={28} strokeWidth={1.5} />
      </div>
    );
  }

  return (
    <img
      src={source}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
      // `contain`, because these are photographs of packaging at whatever
      // aspect ratio the supplier shot them, and cropping a box loses the part
      // a person recognises it by.
      className={clsx(box, 'object-contain')}
    />
  );
}
