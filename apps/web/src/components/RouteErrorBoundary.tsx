import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './ui';

/**
 * Catches a page that fails to load or to draw, and says so, instead of leaving a blank screen where a click seems to
 * have done nothing.
 *
 * The usual cause is a page file that no longer exists under the name the open tab remembers: the dev server restarted,
 * or a new version was deployed. Reloading fixes that, so it is done once automatically; if it fails again the user gets
 * a button and a plain message. Any other error is shown the same way, with a retry that redraws just the page.
 */
const CHUNK_ERROR = /dynamically imported module|Loading chunk|Failed to fetch|Importing a module script failed|error loading dynamically/i;
const RELOAD_FLAG = 'faida:chunk-reloaded';

export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return CHUNK_ERROR.test(msg);
}

interface Props { children: ReactNode; /** Changes when the user goes somewhere else, which clears an old error. */ resetKey?: string }
interface State { error: Error | null }

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page failed:', error, info.componentStack);
    if (isChunkLoadError(error)) {
      try {
        // once per minute: reload to pick up the current files, but never loop
        const last = Number(sessionStorage.getItem(RELOAD_FLAG) ?? 0);
        if (Date.now() - last > 60_000) { sessionStorage.setItem(RELOAD_FLAG, String(Date.now())); window.location.reload(); }
      } catch { /* storage blocked: the button below still works */ }
    }
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isChunkLoadError(error);
    return (
      <div role="alert" className="flex items-center justify-center h-full p-6">
        <div className="surface max-w-md w-full p-6 text-center">
          <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto mb-4" aria-hidden><AlertTriangle className="w-6 h-6" /></div>
          <h2 className="text-lg font-bold text-gray-900">{stale ? 'This page could not be loaded' : 'Something went wrong on this page'}</h2>
          <p className="text-sm text-gray-600 mt-1.5">
            {stale
              ? 'The app was updated, or the connection dropped while the page was loading. Reloading usually fixes it.'
              : 'The rest of the app is fine. Try again, or reload if it keeps happening.'}
          </p>
          <div className="flex gap-2 justify-center mt-5">
            {!stale && <Button variant="secondary" onClick={() => this.setState({ error: null })}>Try again</Button>}
            <Button icon={<RefreshCw className="w-4 h-4" />} onClick={() => window.location.reload()}>Reload page</Button>
          </div>
        </div>
      </div>
    );
  }
}
