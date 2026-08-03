import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches a render throw so the application does not white-screen.
 *
 * There was no error boundary anywhere, which means any exception during render
 * unmounted the entire tree and left a blank page — visually identical to the
 * blank-page defect that took a session to diagnose, and arriving from a
 * different cause entirely. Somebody reporting "the screen went white" was
 * therefore reporting one of two unrelated problems with no way to tell which.
 *
 * A class component because React exposes no hook equivalent; this is the one
 * remaining case where a class is the only option.
 */

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Reaches the browser console, where a support call can ask for it. Sending
    // it to the server is a real improvement and a separate decision — it needs
    // an endpoint, a rate limit and a policy on what may be in a stack trace.
    console.error('A screen failed to render', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-semibold text-text">This screen could not be shown</h1>
        <p className="text-text-muted">
          Nothing you were working on has been lost — the problem is in displaying this page, not in
          your data. Try again, and if it keeps happening, tell whoever supports your system what
          you were doing.
        </p>
        <p className="rounded-md border border-border bg-surface-sunken p-3 font-mono text-sm">
          {this.state.error.message}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="min-h-11 rounded-md bg-brand px-4 text-on-brand"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="flex min-h-11 items-center rounded-md border border-border px-4"
          >
            Go to the home screen
          </a>
        </div>
      </main>
    );
  }
}
