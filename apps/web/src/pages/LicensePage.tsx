import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, KeyRound, RefreshCw } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, PageHeader, type BadgeTone } from '../components/ui';
import { useAuthStore } from '../stores/auth';
import api from '../lib/api';
import { licenseNotice, useLicense, type LicenseStatus } from '../lib/license';

const STATE: Record<LicenseStatus['state'], { label: string; tone: BadgeTone }> = {
  NONE: { label: 'Not activated', tone: 'neutral' },
  ACTIVE: { label: 'Active', tone: 'success' },
  EXPIRING_SOON: { label: 'Needs the internet soon', tone: 'warning' },
  GRACE: { label: 'Could not renew', tone: 'danger' },
  LAPSED: { label: 'Lapsed', tone: 'danger' },
};

const PLAN: Record<string, string> = { FREE: 'Free', STARTER: 'Starter', GROWTH: 'Growth', PRO: 'Pro', ENTERPRISE: 'Enterprise', LIFETIME: 'Enterprise' };

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="text-sm text-gray-500 flex-shrink-0">{label}</dt>
      <dd className="text-sm font-medium text-gray-900 text-right break-all min-w-0">{children}</dd>
    </div>
  );
}

/**
 * The licence for the offline edition: which plan this computer is licensed for, until when, and where to enter a key.
 * Activation needs the internet once (the licence is tied to this computer); after that it renews itself quietly.
 */
export default function LicensePage() {
  const role = useAuthStore((s) => s.user?.role);
  const qc = useQueryClient();
  const { data: status, isLoading, error } = useLicense();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'activate' | 'renew' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (role !== 'OWNER' && role !== 'MANAGER') return <Navigate to="/" replace />;

  if (isLoading) return null;
  if (error || !status) {
    return <div className="p-6"><EmptyState icon={<KeyRound className="w-6 h-6" />} title="Could not read the licence" description={(error as Error | null)?.message ?? 'The server did not answer.'} /></div>;
  }
  if (status.edition !== 'LOCAL') {
    return (
      <div className="p-6">
        <EmptyState icon={<KeyRound className="w-6 h-6" />} title="Your plan is managed online" description="This business runs in the Faida cloud, so its plan is under Settings, Subscription. Licence keys are for the offline edition." />
      </div>
    );
  }

  const canChange = role === 'OWNER';
  const state = STATE[status.state];
  const notice = licenseNotice(status);
  const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => toast.success('Copied'));

  const act = async (what: 'activate' | 'renew') => {
    setBusy(what);
    setProblem(null);
    try {
      const next = await (what === 'activate' ? api.post<LicenseStatus>('/license/activate', { key: key.trim() }) : api.post<LicenseStatus>('/license/renew', {}));
      qc.setQueryData(['license-status'], next);
      void qc.invalidateQueries({ queryKey: ['subscription'] });
      setKey('');
      toast.success(what === 'activate' ? 'Licence activated' : 'Licence checked');
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-5">
      <PageHeader title="Licence" subtitle="The plan this computer is licensed for." icon={<KeyRound className="w-5 h-5" />} />

      {notice && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{notice.message}</p>
      )}

      <Card>
        <CardHeader title="Your licence" actions={<Badge tone={state.tone}>{state.label}</Badge>} />
        <CardBody>
          <dl className="divide-y divide-gray-100">
            <Row label="Plan">{status.tier ? PLAN[status.tier.toUpperCase()] ?? status.tier : status.trial?.active ? 'Free trial' : 'Free'}</Row>
            <Row label="Licence key">{status.keyHint ?? '—'}</Row>
            <Row label="Licence ends">{status.tier ? (status.licenseExpiresAt ? date(status.licenseExpiresAt) : 'No end date') : '—'}</Row>
            <Row label="Last checked online">{date(status.lastRenewedAt)}</Row>
            {status.state === 'ACTIVE' || status.state === 'EXPIRING_SOON' ? <Row label="Works offline until">{date(status.tokenExpiresAt)}</Row> : null}
            {status.state === 'GRACE' ? <Row label="Grace period ends">{date(status.graceEndsAt)}</Row> : null}
            {status.trial && !status.tier ? <Row label="Free trial">{status.trial.active ? `Ends ${date(status.trial.endsAt)}` : 'Ended'}</Row> : null}
            {status.serverStatus && status.serverStatus !== 'OK' ? <Row label="Last message from Faida">{status.serverMessage ?? status.serverStatus}</Row> : null}
            <Row label="This computer's ID">
              <span className="inline-flex items-center gap-2">
                <span className="font-mono text-xs">{status.machineId ?? '—'}</span>
                {status.machineId && <Button variant="ghost" size="sm" onClick={() => copy(status.machineId!)} icon={<Copy className="w-3.5 h-3.5" aria-hidden />}>Copy</Button>}
              </span>
            </Row>
          </dl>
        </CardBody>
      </Card>

      {!status.configured && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          This copy of Faida was built without a licence key check, so a paid plan cannot be activated. Install the official version from Faida.
        </p>
      )}

      {canChange ? (
        <Card>
          <CardHeader title={status.tier ? 'Use a different key' : 'Enter your licence key'} subtitle="The key is tied to this computer when you activate it. The internet is needed this once." />
          <CardBody>
            <form
              className="flex flex-col sm:flex-row gap-3 sm:items-end"
              onSubmit={(e) => { e.preventDefault(); if (key.trim()) void act('activate'); }}
            >
              <Input
                label="Licence key"
                className="flex-1"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="KPS-xxxxxxxx-xxxxxxxx-xxxxxxxx"
                autoComplete="off"
                spellCheck={false}
                error={problem ?? undefined}
              />
              <Button type="submit" loading={busy === 'activate'} disabled={!key.trim() || busy !== null || !status.configured}>Activate</Button>
            </form>
            {status.tier && (
              <div className="mt-4">
                <Button variant="secondary" onClick={() => void act('renew')} loading={busy === 'renew'} disabled={busy !== null} icon={<RefreshCw className="w-4 h-4" aria-hidden />}>Check now</Button>
              </div>
            )}
          </CardBody>
        </Card>
      ) : (
        <p className="text-sm text-gray-500">Only the owner can enter or change the licence key.</p>
      )}
    </div>
  );
}
