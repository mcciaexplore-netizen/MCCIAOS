import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, Card } from '@/components/ui';

/**
 * Catches a render error and shows something instead of nothing.
 *
 * Without one, React unmounts the entire tree when any component throws during
 * render, and the user gets a white page with no message, no way back, and no
 * indication anything went wrong. `Suspense` in App.tsx covers a slow lazy
 * import; it does not cover a throw.
 *
 * A class component because that is the only thing React gives for this —
 * `componentDidCatch` and `getDerivedStateFromError` have no hook equivalent.
 * This is not a style choice.
 *
 * Deliberately shows the error text. This is an internal tool used by the team
 * that maintains it; "something went wrong" would make a real failure
 * undebuggable for exactly the people who could fix it.
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
    // The only record of what happened. There is no logging service wired up,
    // so the console is where a developer will look.
    // eslint-disable-next-line no-console
    console.error('[render error]', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="p-6">
        <Card className="mx-auto max-w-lg p-6">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-medium text-slate-800 dark:text-slate-100">
                This screen stopped working
              </h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Nothing you entered has been lost — the page failed while drawing
                itself, not while saving.
              </p>
              <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {error.message}
              </pre>
              <div className="mt-3 flex gap-2">
                {/* Re-rendering the same broken state would fail again, so this
                    reloads rather than clearing the error and trying once more. */}
                <Button size="sm" onClick={() => window.location.reload()}>
                  Reload
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    window.location.href = '/work-tracker';
                  }}
                >
                  Back to Work Tracker
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>
    );
  }
}
