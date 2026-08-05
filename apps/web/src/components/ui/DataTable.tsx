import type { ReactNode } from 'react';
import clsx from 'clsx';
import { useLanguage } from '../../lib/useLanguage';
import { EmptyState } from './Feedback';

/**
 * A table that becomes readable on a phone.
 *
 * `Table`, `Th` and `Td` below this file are good and stay: sticky headers,
 * `scope` on every header, right-aligned `tabular-nums` for money. What they do
 * not do is the thing Phase 3 actually specified — **responsive stacking**. The
 * wrapper sets `overflow-x: auto`, which stops a wide table dragging the whole
 * page sideways, and that is a genuine improvement. It still leaves a rider
 * dragging a table strip left and right to read one delivery.
 *
 * Below the breakpoint each row becomes a labelled block: the header row is
 * hidden and every cell carries its own column name, drawn from `data-label`
 * through `::before`. One DOM, no JavaScript, no resize listener, correct at
 * any width the instant it renders.
 *
 * **The explicit ARIA roles are not decoration.** Changing `display` on a table
 * element makes browsers drop the implicit table semantics, so a screen reader
 * stops announcing "row 3 of 40, column Brand" and reads a flat run of text
 * instead. Restating the roles keeps the table a table in the accessibility
 * tree while CSS rearranges the pixels — which is why the axe gate can stay at
 * strict zero through the stacked layout as well as the wide one.
 *
 * Pages declare columns rather than markup, so the forty hand-built `<tbody>`
 * blocks this replaces cannot each get the alignment, the scope or the
 * stacking subtly different.
 */

export interface Column<Row> {
  /** Stable identity for the column, and the React key for its cells. */
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /**
   * Money, quantities and anything else read as a column of figures: right
   * aligned with fixed-width digits so it can be scanned rather than read.
   */
  numeric?: boolean;
  /**
   * The label shown beside the value once the row has stacked. Defaults to
   * `header` when that is a plain string, so most columns need nothing.
   */
  label?: string;
  /**
   * Dropped from the stacked layout. For a column that only makes sense
   * alongside others — a row-number, or an action repeated in the block's own
   * footer — rather than for hiding something a phone user still needs.
   */
  hideWhenStacked?: boolean;
}

export interface DataTableProps<Row> {
  columns: ReadonlyArray<Column<Row>>;
  rows: readonly Row[];
  /** React key. Use the domain reference, never an array index. */
  rowKey: (row: Row) => string;
  /**
   * The human reference emitted as `data-test="row-<reference>"`, which is the
   * contract `docs/TESTING.md` froze. Never a MongoDB id: `AGENTS.md` forbids
   * showing one, and a spec written against one is unreadable anyway.
   */
  rowTest?: (row: Row) => string;
  /** Announced to screen readers as the table's purpose. */
  caption: string;
  /** Shown instead of an empty `<tbody>`, which reads as a broken page. */
  empty?: ReactNode;
  className?: string;
}

function labelFor<Row>(column: Column<Row>): string | undefined {
  if (column.label) return column.label;
  return typeof column.header === 'string' ? column.header : undefined;
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  rowTest,
  caption,
  empty,
  className,
}: DataTableProps<Row>) {
  const { t } = useLanguage();
  if (rows.length === 0) {
    return <>{empty ?? <EmptyState title={t('common.nothingHere')} />}</>;
  }

  return (
    <div
      className={clsx(
        'w-full md:overflow-x-auto md:rounded-lg md:border md:border-border',
        className,
      )}
    >
      <table role="table" className="w-full border-collapse text-left md:bg-surface">
        <caption className="sr-only">{caption}</caption>
        {/* The header is meaningless once each cell carries its own label. */}
        <thead role="rowgroup" className="max-md:hidden">
          <tr role="row">
            {columns.map((column) => (
              <th
                key={column.key}
                role="columnheader"
                scope="col"
                className={clsx(
                  'sticky top-0 z-10 border-b border-border bg-surface-sunken px-3 py-2',
                  'text-sm font-semibold text-text-muted',
                  column.numeric && 'text-right',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup" className="max-md:flex max-md:flex-col max-md:gap-3">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              role="row"
              {...(rowTest ? { 'data-test': `row-${rowTest(row)}` } : {})}
              className={clsx(
                'md:hover:bg-surface-hover',
                'max-md:block max-md:rounded-lg max-md:border max-md:border-border',
                'max-md:bg-surface max-md:p-3 max-md:shadow-sm',
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  role="cell"
                  data-label={labelFor(column)}
                  className={clsx(
                    'border-b border-border px-3 py-2 align-middle',
                    column.numeric && 'text-right tabular-nums',
                    // Stacked: label on the left, value on the right, and the
                    // last cell loses its rule so the block does not end in a
                    // stray line.
                    'max-md:flex max-md:items-baseline max-md:justify-between max-md:gap-4',
                    'max-md:border-0 max-md:px-0 max-md:py-1 max-md:text-left',
                    column.hideWhenStacked && 'max-md:hidden',
                    // `attr()` is only valid for `content`, which is exactly
                    // what this needs and why the label rides on the element.
                    'max-md:before:content-[attr(data-label)]',
                    'max-md:before:text-sm max-md:before:font-medium max-md:before:text-text-muted',
                  )}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
