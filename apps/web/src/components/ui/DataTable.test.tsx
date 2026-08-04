// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataTable, type Column } from './DataTable';

/**
 * The table has to survive being rearranged by CSS.
 *
 * Below the breakpoint each row becomes a labelled block, and the mechanism is
 * `display` changes on table elements — which is exactly what makes a browser
 * drop the implicit table semantics, so a screen reader stops saying "row 3,
 * column Brand" and reads a flat run of text. These assertions are about the
 * two things that keep that from happening: the roles are restated explicitly,
 * and every cell carries the label the stacked layout draws through `::before`.
 *
 * jsdom computes no layout, so the stacking itself is asserted as the classes
 * and attributes that produce it. The visual result is checked at 360px in the
 * browser suite, which is the only place that can honestly check it.
 */

interface Row {
  reference: string;
  brand: string;
  amount: string;
}

const rows: Row[] = [
  { reference: 'ORD-2026-000001', brand: 'Napa 500', amount: '৳1,234.56' },
  { reference: 'ORD-2026-000002', brand: 'Ace 500', amount: '৳90.00' },
];

const columns: ReadonlyArray<Column<Row>> = [
  { key: 'brand', header: 'Brand', cell: (row) => row.brand },
  { key: 'amount', header: 'Amount', cell: (row) => row.amount, numeric: true },
  { key: 'internal', header: 'Row', cell: () => '—', hideWhenStacked: true },
];

function renderTable(overrides: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  return render(
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.reference}
      rowTest={(row) => row.reference}
      caption="Orders"
      {...overrides}
    />,
  );
}

describe('DataTable', () => {
  it('stays a table in the accessibility tree', () => {
    renderTable();
    const table = screen.getByRole('table', { name: 'Orders' });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(3);
    // Two data rows plus the header row.
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getAllByRole('cell')).toHaveLength(6);
  });

  it('gives every header a scope, so a cell can be attributed to a column', () => {
    renderTable();
    for (const header of screen.getAllByRole('columnheader')) {
      expect(header.getAttribute('scope')).toBe('col');
    }
  });

  it('labels every cell, which is what the stacked layout renders', () => {
    renderTable();
    // Without `data-label` the stacked view is a column of bare values with no
    // indication of what any of them are.
    expect(screen.getByText('Napa 500').getAttribute('data-label')).toBe('Brand');
    expect(screen.getByText('৳1,234.56').getAttribute('data-label')).toBe('Amount');
  });

  it('right-aligns figures with fixed-width digits so a column can be scanned', () => {
    renderTable();
    const amount = screen.getByText('৳1,234.56');
    expect(amount.className).toContain('tabular-nums');
    expect(amount.className).toContain('text-right');
    expect(screen.getByText('Napa 500').className).not.toContain('tabular-nums');
  });

  it('identifies rows by their domain reference, never by a database id', () => {
    renderTable();
    // The contract docs/TESTING.md froze. An ObjectId here would also breach
    // the rule in AGENTS.md against showing one.
    expect(screen.getByTestId('row-ORD-2026-000001')).toBeTruthy();
  });

  it('drops a column from the stacked layout without dropping it entirely', () => {
    renderTable();
    const [, , internal] = screen.getAllByRole('cell');
    expect(internal!.className).toContain('max-md:hidden');
  });

  it('renders an empty state rather than an empty table body', () => {
    renderTable({ rows: [] });
    // An empty `<tbody>` under a header row reads as a page that failed.
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByTestId('empty-state')).toBeTruthy();
  });

  it('lets a page say what "empty" means for it', () => {
    renderTable({ rows: [], empty: <p>No orders placed today.</p> });
    expect(screen.getByText('No orders placed today.')).toBeTruthy();
  });
});
