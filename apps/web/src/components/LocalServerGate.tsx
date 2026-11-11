import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Loader2, RefreshCw, Settings } from 'lucide-react';
import { Button } from './ui';
import { reconfigureThisComputer, serverRestart } from '../lib/desktopServer';
import { useLocalServer } from '../lib/useLocalServer';

/**
 * Holds the app back until this computer's own database and API are ready, and says what is happening meanwhile
 * ("Creating your database (first time only)"). Once the server has run, a later problem never blanks the screen
 * (a cashier would lose the cart they are building): the app stays and a banner explains.
 */
export default function LocalServerGate({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const { status, refresh } = useLocalServer();
  const [retrying, setRetrying] = useState(false);
  const everRan = useRef(false);

  useEffect(() => {
    if (status.phase === 'running') everRan.current = true;
  }, [status.phase]);

  // The server may have had to take another port than the one saved at setup (the usual one was busy). Follow it, so
  // the app never keeps calling an address nothing answers on.
  useEffect(() => {
    if (!enabled || status.phase !== 'running' || !status.apiPort) return;
    const url = `http://127.0.0.1:${status.apiPort}`;
    if (localStorage.getItem('faida-server-url') !== url) {
      localStorage.setItem('faida-server-url', url);
      window.location.reload();
    }
  }, [enabled, status.phase, status.apiPort]);

  if (!enabled) return <>{children}</>;
  if (status.phase === 'running') return <>{children}</>;

  const tryAgain = async () => {
    setRetrying(true);
    try { await serverRestart(); } catch { /* the status poll shows what went wrong */ }
    setRetrying(false);
    refresh();
  };

  if (everRan.current) {
    // A planned restart (the owner changed a setting) is not a problem: say so calmly. Only a real problem gets the warning.
    const restarting = status.phase === 'starting' || status.phase === 'stopping';
    return (
      <>
        <div
          role={restarting ? 'status' : 'alert'}
          className={`fixed top-0 inset-x-0 z-[100] text-white text-sm font-semibold px-4 py-2 flex items-center justify-center gap-3 ${restarting ? 'bg-brand-600' : 'bg-amber-600'}`}
        >
          {restarting
            ? <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin" aria-hidden />
            : <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden />}
          {restarting ? (
            <span>The server is restarting. This takes about ten seconds.</span>
          ) : (
            <>
              <span>The Faida server is not running: {status.message}</span>
              <button onClick={() => void tryAgain()} disabled={retrying} className="underline underline-offset-2 disabled:opacity-60">
                {retrying ? 'Restarting…' : 'Try again'}
              </button>
            </>
          )}
        </div>
        {children}
      </>
    );
  }

  const failed = status.phase === 'error';
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
      <div className="surface w-full max-w-md p-8 text-center space-y-5" role="status" aria-live="polite">
        <div className={`mx-auto w-14 h-14 rounded-2xl flex items-center justify-center ${failed ? 'bg-red-100 text-red-600' : 'bg-brand-100 text-brand-700'}`}>
          {failed ? <AlertTriangle className="w-7 h-7" aria-hidden /> : <Loader2 className="w-7 h-7 animate-spin" aria-hidden />}
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">{failed ? 'Faida could not start' : 'Starting Faida'}</h1>
          <p className="text-sm text-gray-600 mt-2 break-words">{status.message}</p>
        </div>
        {!failed && (
          <>
            <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden" aria-hidden>
              <div className="h-full w-1/3 rounded-full bg-brand-600 animate-pulse" />
            </div>
            <p className="text-xs text-gray-500">The first start takes up to a minute while your database is created.</p>
          </>
        )}
        {failed && (
          <div className="space-y-3">
            <Button fullWidth onClick={() => void tryAgain()} loading={retrying} icon={<RefreshCw className="w-4 h-4" aria-hidden />}>Try again</Button>
            <p className="text-xs text-gray-500">If it keeps failing, restart the computer. Your data is not lost.</p>
            <button
              onClick={async () => { await reconfigureThisComputer(); window.location.href = '/'; }}
              className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1.5"
            >
              <Settings className="w-3.5 h-3.5" aria-hidden /> Change this computer's setup
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
