// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Resource } from './Resource';

/**
 * The three states, and the one behaviour users actually notice.
 *
 * Thirty-five pages hand-rolled this and none offered a retry, so a failed
 * request was a dead end containing a sentence. The assertions below are the
 * contract every migrated page inherits — in particular that a **refetch does
 * not blank the screen**, which is the difference between a list that feels
 * instant and one that flashes a spinner at somebody already reading it.
 */

function wrapper(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function Subject({ fetcher, queryKey }: { fetcher: () => Promise<string[]>; queryKey: string }) {
  const query = useQuery({ queryKey: [queryKey], queryFn: fetcher });
  return (
    <Resource query={query} loadingLabel="Loading orders">
      {(items) => (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </Resource>
  );
}

describe('Resource', () => {
  it('announces the wait, then shows the data', async () => {
    render(wrapper(<Subject queryKey="ok" fetcher={async () => ['Napa 500']} />));

    const loading = screen.getByRole('status');
    expect(loading.textContent).toContain('Loading orders');
    // The application had zero live regions before Phase 3; an async change
    // that says nothing is invisible to a screen reader.
    expect(loading.getAttribute('aria-live')).toBe('polite');

    expect(await screen.findByText('Napa 500')).toBeTruthy();
  });

  it('does not blank the screen while revalidating', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetcher = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(['Napa 500'])
      .mockResolvedValueOnce(['Ace 500']);

    function Live() {
      const query = useQuery({ queryKey: ['live'], queryFn: fetcher });
      return (
        <>
          <button type="button" onClick={() => void query.refetch()}>
            Refresh
          </button>
          <Resource query={query}>{(items) => <p>{items.join(', ')}</p>}</Resource>
        </>
      );
    }

    render(<QueryClientProvider client={client}>{<Live />}</QueryClientProvider>);
    expect(await screen.findByText('Napa 500')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    /*
     * The old data stays on screen throughout. Keying this off `isFetching`
     * rather than `isPending` is what made every screen blink on every return
     * visit, and it is the single most noticeable difference in this change.
     */
    expect(screen.getByText('Napa 500')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();

    await waitFor(() => expect(screen.getByText('Ace 500')).toBeTruthy());
  });

  it('offers a way out of a failure, and refetches when it is taken', async () => {
    const fetcher = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(['Napa 500']);

    render(wrapper(<Subject queryKey="fail" fetcher={fetcher} />));

    const alert = await screen.findByRole('alert');
    expect(alert).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'Try again' });

    fireEvent.click(retry);
    expect(await screen.findByText('Napa 500')).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('tells "there is nothing here" apart from "this broke"', async () => {
    render(wrapper(<Subject queryKey="empty" fetcher={async () => []} />));
    expect(await screen.findByTestId('empty-state')).toBeTruthy();
    // Emphatically not an error: the two were routinely indistinguishable.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('recognises an empty paginated envelope as empty', async () => {
    function Paginated() {
      const query = useQuery({
        queryKey: ['page'],
        queryFn: async () => ({ items: [] as string[], total: 0, page: 1, limit: 50 }),
      });
      return <Resource query={query}>{() => <p>rows</p>}</Resource>;
    }
    render(wrapper(<Paginated />));
    expect(await screen.findByTestId('empty-state')).toBeTruthy();
  });
});
