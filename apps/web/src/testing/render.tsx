import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { AskProvider } from '../components/ui';

/**
 * Renders a page with the providers `AppShell` gives it in the real
 * application.
 *
 * Component tests mount one leaf page at a time, which is a deliberate and good
 * choice — it keeps them fast and specific — but it means a page reaching for
 * something the shell provides finds nothing. Use this wherever a test clicks
 * an action that asks the user to confirm something.
 */
export function renderWithUi(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult {
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => <AskProvider>{children}</AskProvider>,
    ...options,
  });
}
