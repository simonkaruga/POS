import { useEffect } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { Button, Card, CardBody, CardHeader } from './ui';
import { useDialog } from './Dialog';
import { useAuthStore } from '../stores/auth';
import { inDesktopApp } from '../lib/desktopServer';
import { canInstallUpdate, checkedAgo, describeProgress, isInstalling, useAppUpdate } from '../lib/appUpdate';

/** Which version of the desktop app this is, and a button to look for a newer one. Renders nothing in the browser version. */
export default function AppUpdateCard() {
  const { confirm } = useDialog();
  const role = useAuthStore((s) => s.user?.role);
  const { version, found, checking, checkedAt, checkError, progress, check, install } = useAppUpdate();
  useEffect(() => {
    if (inDesktopApp() && !version) void check();
  }, [version, check]);
  if (!inDesktopApp()) return null;

  const busy = isInstalling(progress);
  const installNow = async () => {
    if (!found) return;
    const ok = await confirm({
      title: `Install Faida ${found.version}?`,
      message: 'Faida will close for about a minute while it updates, then open again by itself. Your data is backed up first. Finish any sale in progress before you continue.',
      confirmLabel: 'Install and restart',
      variant: 'info',
    });
    if (ok) void install();
  };

  return (
    <Card>
      <CardHeader title="Version and updates" subtitle={`This computer runs Faida ${version ?? '…'}.`} />
      <CardBody className="space-y-3">
        {busy ? (
          <p className="text-sm text-gray-700 flex items-center gap-2" role="status">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {describeProgress(progress)}
          </p>
        ) : found ? (
          <p className="text-sm text-gray-800">
            <strong>Faida {found.version}</strong> is ready to install.
          </p>
        ) : (
          <p className="text-sm text-gray-600">
            {checkError ?? (checkedAt ? 'You have the newest version.' : 'Not checked yet.')} Last checked: {checkedAgo(checkedAt)}.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void check(true)} disabled={checking || busy} icon={<RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />}>
            Check for updates
          </Button>
          {found && canInstallUpdate(role) && (
            <Button onClick={installNow} disabled={busy} icon={<Download className="w-4 h-4" />}>
              Install and restart
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
