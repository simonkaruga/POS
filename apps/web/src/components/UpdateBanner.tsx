import { useEffect } from 'react';
import { Download, Loader2, AlertTriangle, X } from 'lucide-react';
import { useDialog } from './Dialog';
import { useAuthStore } from '../stores/auth';
import { canInstallUpdate, describeProgress, isInstalling, startUpdateChecks, useAppUpdate } from '../lib/appUpdate';

/**
 * One line across the top of the desktop app when a newer version is ready. The owner or manager installs it (the app closes
 * for about a minute and restarts by itself); everyone else is told to ask. It never shows in the browser version.
 */
export default function UpdateBanner() {
  const { confirm } = useDialog();
  const role = useAuthStore((s) => s.user?.role);
  const { found, progress, dismissed, install, dismiss } = useAppUpdate();
  useEffect(() => startUpdateChecks(), []);

  const busy = isInstalling(progress);
  if (progress.stage === 'error') {
    return (
      <div role="alert" className="bg-red-700 text-white text-sm font-semibold px-4 py-2 flex items-center justify-center gap-3 text-center">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden />
        <span>{describeProgress(progress)}</span>
        <button type="button" onClick={() => useAppUpdate.setState({ progress: { stage: 'idle', downloaded: 0 } })} className="underline underline-offset-2">
          Dismiss
        </button>
      </div>
    );
  }
  if (busy) {
    return (
      <div role="status" className="bg-brand-600 text-white text-sm font-semibold px-4 py-2 flex items-center justify-center gap-3 text-center">
        <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" aria-hidden />
        <span>{describeProgress(progress)}</span>
      </div>
    );
  }
  if (!found || dismissed) return null;

  const mayInstall = canInstallUpdate(role);
  const installNow = async () => {
    const ok = await confirm({
      title: `Install Faida ${found.version}?`,
      message:
        'Faida will close for about a minute while it updates, then open again by itself. Your data is backed up first. ' +
        'Finish any sale in progress before you continue. Other tills connected to this computer will wait until it is back.',
      confirmLabel: 'Install and restart',
      variant: 'info',
    });
    if (ok) void install();
  };

  return (
    <div role="status" className="bg-brand-600 text-white text-sm font-semibold px-4 py-2 flex items-center justify-center gap-3 text-center flex-wrap">
      <Download className="w-4 h-4 flex-shrink-0" aria-hidden />
      <span>Faida {found.version} is ready{mayInstall ? '' : '. Ask the owner or a manager to install it'}.</span>
      {mayInstall && (
        <button type="button" onClick={installNow} className="bg-white text-brand-700 rounded-md px-3 py-1 hover:bg-gray-100">
          Install and restart
        </button>
      )}
      <button type="button" onClick={dismiss} aria-label="Remind me later" className="p-1 rounded hover:bg-white/15">
        <X className="w-4 h-4" aria-hidden />
      </button>
    </div>
  );
}
