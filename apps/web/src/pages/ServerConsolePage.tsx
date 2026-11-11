import { Server, Settings } from 'lucide-react';
import { Toaster } from 'sonner';
import { DialogProvider } from '../components/Dialog';
import ServerPanel from '../components/ServerPanel';
import LocalServerGate from '../components/LocalServerGate';
import { reconfigureThisComputer } from '../lib/desktopServer';
import { useLocalServer } from '../lib/useLocalServer';

/**
 * The whole screen of a "server only" computer: no till, just whether the server is healthy, the address the tills
 * connect to, and the backups. Leave it switched on while the shop is open.
 */
function Console() {
  const { status } = useLocalServer();
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-brand-600 text-white">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center"><Server className="w-5 h-5" aria-hidden /></div>
          <div>
            <h1 className="text-lg font-bold leading-tight">Faida Server</h1>
            <p className="text-sm text-white/80">Keep this computer switched on while the shop is open. Sell on the tills.</p>
          </div>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-6">
        <ServerPanel status={status} />
        <div className="mt-8 text-center">
          <button
            onClick={async () => { await reconfigureThisComputer(); window.location.href = '/'; }}
            className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1.5"
          >
            <Settings className="w-3.5 h-3.5" aria-hidden /> Change this computer's setup
          </button>
        </div>
      </main>
    </div>
  );
}

export default function ServerConsolePage() {
  return (
    <DialogProvider>
      <Toaster position="top-right" richColors closeButton duration={4000} />
      {/* Before the server is ready, the same progress / error screen as every other computer. */}
      <LocalServerGate enabled>
        <Console />
      </LocalServerGate>
    </DialogProvider>
  );
}
