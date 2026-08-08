import { Link } from 'react-router-dom';
import type { Medicine } from '@medsupply/shared-types';
import { marginPercent } from '@medsupply/utilities';
import { Badge, ProductImage } from './ui';
import { useLanguage } from '../lib/useLanguage';
import { formatMinor } from '../lib/finance';

/**
 * One product, offered beside another.
 *
 * The old card was a row carrying a name, a manufacturer, one price and a stock
 * pill. A pharmacy choosing between two brands of the same molecule needs more
 * than that, and every field is already on the wire — `alternativesFor` returns
 * the whole `Medicine` plus `totalAvailable`, so the card was showing four of
 * about a dozen facts it had been handed.
 *
 * **What "offer price" means for a distributor.** A consumer pharmacy shows a
 * struck-through price and a discount. Here the two prices are the trade price
 * a pharmacy pays and the MRP printed on the pack, and the gap between them is
 * not a discount we are giving — it is the margin the pharmacy earns when they
 * sell it. That is the number this trade decides on, so it is the badge, and it
 * is labelled as margin rather than dressed up as a saving.
 *
 * The trade price is also the **list** price. A customer's own price list or a
 * running offer can take it lower, and only the server knows by how much — so
 * the caller passes `priceCaveat` where the viewer is somebody who buys.
 */

export interface ProductCardProps {
  item: Medicine & { totalAvailable?: number };
  /** Hidden from roles the server does not send prices to act on. */
  showPrices?: boolean;
  /** Rendered under the card — "Add to order", usually. */
  action?: React.ReactNode;
}

export function ProductCard({ item, showPrices = true, action }: ProductCardProps) {
  const { t } = useLanguage();
  const margin = marginPercent(item.defaultSellingPriceMinor, item.mrpMinor);
  const stock = item.totalAvailable ?? 0;

  return (
    <div
      className="flex h-full flex-col gap-2 rounded-panel border border-border bg-surface p-3"
      data-test={`product-card-${item.reference}`}
    >
      <Link className="flex flex-col gap-2 no-underline" to={`/medicines/${item._id}`}>
        <ProductImage path={item.productImageUrl} className="h-28" />

        {/*
          Name, then molecule, then maker — the order a pharmacist reads a pack
          in. `line-clamp-2` rather than `truncate`: a name like "Ceftriaxone
          Sodium 1gm IV Injection" loses its dose to a single-line truncation,
          and the dose is the part that distinguishes it from the row below.
        */}
        <span className="line-clamp-2 font-semibold text-text">
          {[item.brandName, item.strength].filter(Boolean).join(' ')}
        </span>
        {item.genericName && (
          <span className="line-clamp-1 text-sm text-text-muted">{item.genericName}</span>
        )}
        <span className="line-clamp-1 text-sm text-text-muted">{item.manufacturer}</span>
      </Link>

      {showPrices && (
        <div className="mt-auto flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-lg font-semibold tabular-nums text-text">
            {formatMinor(item.defaultSellingPriceMinor)}
          </span>
          {/*
            The MRP only earns its place when it is above the trade price. On a
            line where the two are equal — which is every line until a goods
            receipt supplies a real cost — a struck-through identical figure
            reads as a broken discount rather than as no margin.
          */}
          {item.mrpMinor !== undefined && item.mrpMinor > item.defaultSellingPriceMinor && (
            <span className="text-sm text-text-muted line-through tabular-nums">
              {formatMinor(item.mrpMinor)}
            </span>
          )}
          {margin !== undefined && margin > 0 && (
            <Badge tone="success">{t('catalogue.marginBadge', { percent: margin })}</Badge>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
        {/*
          `packSize` on its own is a bare number — "10" beside a stock pill
          reads as a second quantity. With the unit it is a pack: "10 box".
        */}
        <span>{[item.packSize, item.unit].filter(Boolean).join(' ')}</span>
        {/*
          Free stock, said plainly. A suggestion nobody can be sent is not a
          suggestion, and "0 in stock" is the difference between an alternative
          and a wasted telephone call.
        */}
        <Badge tone={stock > 0 ? 'success' : 'neutral'}>
          {stock > 0 ? t('alternatives.inStock', { count: stock }) : t('alternatives.noStock')}
        </Badge>
      </div>

      {action}
    </div>
  );
}
