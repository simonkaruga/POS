import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, DatabaseBackup, HardDrive, History, Network, RotateCcw } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, Switch, type BadgeTone } from './ui';
import { useDialog } from './Dialog';
import {
  BACKUP_REASON, formatBytes, serverBackup, serverBackups, serverRestore, serverSetLan, timeAgo, type BackupEntry, type LocalServerStatus, type Phase,
} from '../lib/desktopServer';

const PHASE: Record<Phase, { label: string; tone: BadgeTone }> = {
  running: { label: 'Running', tone: 'success' },
  starting: { label: 'Starting', tone: 'warning' },
  stopping: { label: 'Stopping', tone: 'warning' },
  stopped: { label: 'Stopped', tone: 'neutral' },
  error: { label: 'Problem', tone: 'danger' },
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="text-sm text-gray-500 flex-shrink-0">{label}</dt>
      <dd className="text-sm font-medium text-gray-900 text-right break-all min-w-0">{children}</dd>
    </div>
  );
}

/**
 * What the owner needs to see and do about their own server: is it running, what address do the tills type, where is
 * the data, when was the last backup, back up now, restore. Used by the server-only console and by Settings.
 */
export default function ServerPanel({ status }: { status: LocalServerStatus }) {
  const { confirm } = useDialog();
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [busy, setBusy] = useState<'backup' | 'restore' | 'network' | null>(null);
  const running = status.phase === 'running';

  const loadBackups = useCallback(() => {
    if (!running) return;
    serverBackups().then(setBackups, () => setBackups([]));
  }, [running]);

  useEffect(loadBackups, [loadBackups, status.lastBackup?.name]);

  const backupNow = async () => {
    setBusy('backup');
    try {
      const b = await serverBackup();
      toast.success(`Backup saved (${formatBytes(b.bytes)})`);
      loadBackups();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const restore = async (b: BackupEntry) => {
    const ok = await confirm({
      title: 'Restore this backup?',
      message: `Everything entered after ${new Date(b.at).toLocaleString('en-KE')} will be replaced by the contents of this backup. A safety copy of the current data is saved first, so this can be undone. Tills will stop for a minute.`,
      variant: 'danger',
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    setBusy('restore');
    try {
      await serverRestore(b.file);
      toast.success('Restored from backup');
      loadBackups();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const changeNetworkAccess = async (enabled: boolean) => {
    const ok = await confirm(enabled
      ? {
          title: 'Let other computers connect?',
          message: 'Tills on your network will be able to use this server. Windows may ask you to allow Faida through its firewall: choose Allow for private networks. The server restarts and is back in about ten seconds.',
          variant: 'info',
          confirmLabel: 'Allow',
        }
      : {
          title: 'Stop other computers connecting?',
          message: 'Tills on other computers will stop working until you allow this again. Sales on this computer are not affected. The server restarts and is back in about ten seconds.',
          variant: 'warning',
          confirmLabel: 'Stop',
        });
    if (!ok) return;
    setBusy('network');
    try {
      await serverSetLan(enabled);
      toast.success(enabled ? 'Other computers can now connect' : 'Other computers can no longer connect');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => toast.success('Copied'));
  };

  const phase = PHASE[status.phase];
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Server"
          subtitle={status.message}
          actions={<Badge tone={phase.tone}>{phase.label}</Badge>}
        />
        <CardBody>
          <dl className="divide-y divide-gray-100">
            <Row label="Other computers">
              <span className="inline-flex items-center gap-3">
                <span>{status.lanEnabled ? 'May connect' : 'Not allowed'}</span>
                <Switch
                  checked={!!status.lanEnabled}
                  onChange={(next) => void changeNetworkAccess(next)}
                  disabled={!running || busy !== null}
                  label="Let other computers on this network connect"
                />
              </span>
            </Row>
            <Row label="Database folder">{status.dataDir ?? '—'}</Row>
            <Row label="Backup folder">{status.backupDir ?? '—'}</Row>
            <Row label="Last backup">
              {status.lastBackup ? `${timeAgo(status.lastBackup.at)} (${formatBytes(status.lastBackup.bytes)})` : 'None yet'}
            </Row>
          </dl>
        </CardBody>
      </Card>

      {status.lanEnabled && (
        <Card>
          <CardHeader title="Tills connect to" subtitle="Type this address on each till, or let the till find the server by itself. If there are several, try the first." />
          <CardBody className="space-y-2">
            {status.addresses.length === 0 && <p className="text-sm text-gray-500">No network connection found. Connect this computer to the shop's network.</p>}
            {status.addresses.map((a, i) => (
              <div key={a} className="flex items-center gap-3 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
                <Network className="w-4 h-4 text-brand-600 flex-shrink-0" aria-hidden />
                <code className="text-sm flex-1 select-all">{a}</code>
                {i === 0 && status.addresses.length > 1 && <Badge tone="brand">Most likely</Badge>}
                <Button variant="ghost" size="sm" onClick={() => copy(a)} icon={<Copy className="w-3.5 h-3.5" aria-hidden />}>Copy</Button>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Backups"
          subtitle="Saved automatically every day and when the app is closed"
          actions={
            <Button size="sm" onClick={() => void backupNow()} loading={busy === 'backup'} disabled={!running || busy !== null} icon={<DatabaseBackup className="w-4 h-4" aria-hidden />}>
              Back up now
            </Button>
          }
        />
        <CardBody className="p-0">
          {backups.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">
              <HardDrive className="w-8 h-8 mx-auto mb-2 text-gray-300" aria-hidden />
              {running ? 'No backups yet. Press "Back up now" to make the first one.' : 'Backups appear here once the server is running.'}
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {backups.map((b) => (
                <li key={b.name} className="flex items-center gap-3 px-5 py-3">
                  <History className="w-4 h-4 text-gray-400 flex-shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900">{new Date(b.at).toLocaleString('en-KE')}</div>
                    <div className="text-xs text-gray-500">{BACKUP_REASON[b.reason] ?? b.reason} · {formatBytes(b.bytes)}</div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => void restore(b)} disabled={busy !== null} loading={busy === 'restore'} icon={<RotateCcw className="w-3.5 h-3.5" aria-hidden />}>
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
