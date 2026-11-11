import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, AlertTriangle, PlugZap, RefreshCw, Search, PackageCheck, Receipt, Boxes, ScrollText } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Badge, Card, CardHeader, CardBody, Input } from './ui';

interface EtimsStatus {
  mode: 'LIVE' | 'SANDBOX' | 'RECONNECT';
  environment: 'sandbox' | 'production';
  kraPin: string | null;
  branchId: string | null;
  device: string | null;
  tradeName: string | null;
  liveSince: string | null;
  defaultItemClsCd: string | null;
  lastInvoiceNo: number;
  pending: number;
  needsAttention: number;
  itemsWithoutClass: number;
  itemErrors: number;
  stockPending: number;
  stockErrors: number;
  creditNotesPending: number;
  lastCall: { createdAt: string; ok: boolean; path: string; error: string | null } | null;
}

interface Attention {
  sales: Array<{ id: string; receiptNumber: string; totalCents: number; createdAt: string; etimsLastError: string | null; etimsAttempts: number }>;
  items: Array<{ id: string; name: string; category: string | null; taxClass: string; kraItemCode: string | null; etimsRegisterError: string | null }>;
}

interface ItemClass { itemClsCd: string; itemClsNm: string; itemClsLvl: number | null }
interface CallRow { id: string; createdAt: string; path: string; ok: boolean; resultCd: string | null; durationMs: number; error: string | null }

const kes = (cents: number) => `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * The owner's view of the KRA eTIMS connection: connect the device KRA approved, see what is waiting or refused,
 * give items their KRA class, and read every call made to KRA. Everything here works the same in sandbox and live.
 */
export default function EtimsConnectionPanel() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['etims-status'] });
    void qc.invalidateQueries({ queryKey: ['etims-attention'] });
    void qc.invalidateQueries({ queryKey: ['etims-calls'] });
  };
  const { data: status, isLoading } = useQuery<EtimsStatus>({ queryKey: ['etims-status'], queryFn: () => api.get('/etims/status'), refetchInterval: 30_000 });
  const { data: attention } = useQuery<Attention>({ queryKey: ['etims-attention'], queryFn: () => api.get('/etims/attention') });
  const [showCalls, setShowCalls] = useState(false);
  const { data: calls } = useQuery<CallRow[]>({ queryKey: ['etims-calls'], queryFn: () => api.get('/etims/calls?limit=50'), enabled: showCalls });

  if (isLoading || !status) return <Card><CardBody>Loading the KRA connection…</CardBody></Card>;

  return (
    <div className="space-y-6">
      <StatusCard status={status} onChanged={refresh} />
      {status.mode !== 'LIVE' && <ConnectCard status={status} onConnected={refresh} />}
      <AttentionCard status={status} attention={attention} onChanged={refresh} />
      <DefaultClassCard status={status} onChanged={refresh} />
      <Card>
        <CardHeader
          title={<span className="inline-flex items-center gap-2"><ScrollText className="w-4 h-4" /> Every call to KRA</span>}
          subtitle="Kept as proof if KRA ever questions an invoice. The communication key is never stored."
          actions={<Button size="sm" variant="secondary" onClick={() => setShowCalls((v) => !v)}>{showCalls ? 'Hide' : 'Show the last 50'}</Button>}
        />
        {showCalls && (
          <CardBody>
            {!calls?.length ? <p className="text-sm text-gray-500">No calls yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-gray-500"><th className="py-1.5 pr-3">When</th><th className="pr-3">What</th><th className="pr-3">Result</th><th className="pr-3">Time</th></tr></thead>
                  <tbody>
                    {calls.map((c) => (
                      <tr key={c.id} className="border-t border-gray-100">
                        <td className="py-1.5 pr-3 whitespace-nowrap">{when(c.createdAt)}</td>
                        <td className="pr-3 font-mono text-xs">{c.path}</td>
                        <td className="pr-3">{c.ok ? <Badge tone="success">OK {c.resultCd}</Badge> : <span className="text-red-600">{c.error ?? c.resultCd}</span>}</td>
                        <td className="pr-3 text-gray-500">{c.durationMs} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        )}
      </Card>
    </div>
  );
}

function StatusCard({ status, onChanged }: { status: EtimsStatus; onChanged: () => void }) {
  const stock = useMutation({ mutationFn: () => api.post<{ reported: number; failed: number }>('/etims/stock/report'), onSuccess: onChanged });
  const live = status.mode === 'LIVE';
  return (
    <Card>
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> KRA eTIMS connection</span>}
        subtitle={live
          ? `Connected as ${status.tradeName ?? status.kraPin} · PIN ${status.kraPin} · branch ${status.branchId} · device ${status.device}`
          : status.mode === 'RECONNECT'
            ? 'This business was set up with an older connection that KRA will not accept. Connect again below.'
            : 'Test mode: receipts are marked TEST and nothing is sent to KRA. Connect below to go live.'}
        actions={<Badge tone={live ? 'success' : status.mode === 'RECONNECT' ? 'danger' : 'warning'}>{live ? (status.environment === 'production' ? 'Live' : 'KRA test server') : status.mode === 'RECONNECT' ? 'Reconnect' : 'Test mode'}</Badge>}
      />
      <CardBody>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Tile icon={<Receipt className="w-4 h-4" />} label="Invoices waiting" value={status.pending} hint="Sent by themselves when KRA answers" />
          <Tile icon={<AlertTriangle className="w-4 h-4" />} label="Refused by KRA" value={status.needsAttention} tone={status.needsAttention ? 'danger' : undefined} hint="Need a fix, then retry" />
          <Tile icon={<PackageCheck className="w-4 h-4" />} label="Items without a KRA class" value={status.itemsWithoutClass + status.itemErrors} tone={status.itemsWithoutClass + status.itemErrors ? 'warning' : undefined} hint="KRA refuses a sale of these" />
          <Tile icon={<Boxes className="w-4 h-4" />} label="Stock moves to report" value={status.stockPending} hint={status.stockErrors ? `${status.stockErrors} with an error` : 'Every 10 minutes'} />
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4 text-sm text-gray-600">
          {live && <span>Last KRA invoice number: <strong>{status.lastInvoiceNo}</strong></span>}
          {status.creditNotesPending > 0 && <span className="text-amber-700">{status.creditNotesPending} credit note(s) waiting to reach KRA</span>}
          {status.lastCall && <span>Last call {when(status.lastCall.createdAt)}: {status.lastCall.ok ? 'OK' : <span className="text-red-600">{status.lastCall.error}</span>}</span>}
          {live && (
            <Button size="sm" variant="secondary" className="ml-auto" loading={stock.isPending} onClick={() => stock.mutate()}>
              <RefreshCw className="w-4 h-4" /> Report stock now
            </Button>
          )}
        </div>
        {stock.data && <p className="text-sm text-green-700 mt-2">{stock.data.reported} stock move(s) reported{stock.data.failed ? `, ${stock.data.failed} failed` : ''}.</p>}
      </CardBody>
    </Card>
  );
}

function Tile({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: number; hint: string; tone?: 'danger' | 'warning' }) {
  const color = tone === 'danger' ? 'text-red-600' : tone === 'warning' ? 'text-amber-600' : 'text-gray-900';
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">{icon}{label}</div>
      <div className={`text-2xl font-extrabold tabular-nums mt-1 ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{hint}</div>
    </div>
  );
}

function ConnectCard({ status, onConnected }: { status: EtimsStatus; onConnected: () => void }) {
  const [kraPin, setKraPin] = useState(status.kraPin ?? '');
  const [bhfId, setBhfId] = useState(status.branchId ?? '00');
  const [dvcSrlNo, setDvcSrlNo] = useState('');
  const connect = useMutation({
    mutationFn: () => api.post<{ message: string }>('/etims/production-onboarding', { kraPin: kraPin.trim().toUpperCase(), bhfId: bhfId.trim() || '00', dvcSrlNo: dvcSrlNo.trim() }),
    onSuccess: onConnected,
  });
  return (
    <Card>
      <CardHeader title={<span className="inline-flex items-center gap-2"><PlugZap className="w-4 h-4" /> Connect to KRA</span>} subtitle="Three things from the KRA eTIMS portal, after KRA approves your OSCU device." />
      <CardBody>
        <ol className="list-decimal pl-5 text-sm text-gray-600 space-y-1 mb-4">
          <li>On <strong>etims.kra.go.ke</strong>, sign in with your KRA PIN and apply for an <strong>OSCU</strong> device, choosing Faida POS.</li>
          <li>When KRA approves it, copy the <strong>device serial number</strong> and your <strong>branch id</strong> (00 for the head office).</li>
          <li>Enter them here. Faida connects the device and every sale is signed by KRA from then on.</li>
        </ol>
        <form className="grid md:grid-cols-3 gap-3" onSubmit={(e) => { e.preventDefault(); connect.mutate(); }}>
          <Input label="KRA PIN" value={kraPin} onChange={(e) => setKraPin(e.target.value.toUpperCase())} placeholder="P051234567A" required />
          <Input label="Branch id" value={bhfId} onChange={(e) => setBhfId(e.target.value)} placeholder="00" required />
          <Input label="Device serial number" value={dvcSrlNo} onChange={(e) => setDvcSrlNo(e.target.value)} placeholder="From the eTIMS portal" required />
          <div className="md:col-span-3 flex items-center gap-3">
            <Button type="submit" loading={connect.isPending} disabled={!kraPin || !dvcSrlNo}>Connect</Button>
            {connect.error && <span className="text-sm text-red-600">{(connect.error as Error).message}</span>}
            {connect.data && <span className="text-sm text-green-700">{connect.data.message}</span>}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function AttentionCard({ status, attention, onChanged }: { status: EtimsStatus; attention?: Attention; onChanged: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const retry = useMutation({ mutationFn: (saleId: string) => api.post(`/etims/sales/${saleId}/retry`), onSettled: onChanged });
  const setClass = useMutation({
    mutationFn: (itemClsCd: string) => api.patch('/etims/items', { itemIds: [...selected], itemClsCd }),
    onSuccess: () => { setSelected(new Set()); onChanged(); },
  });
  const sales = attention?.sales ?? [];
  const items = attention?.items ?? [];
  if (!sales.length && !items.length) {
    return <Card><CardBody><p className="text-sm text-green-700 inline-flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Nothing needs fixing: every item has a KRA class and no invoice was refused.</p></CardBody></Card>;
  }
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Card>
      <CardHeader title={<span className="inline-flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-600" /> Needs fixing</span>} subtitle="KRA refuses a sale until each item carries its KRA item class." />
      <CardBody className="space-y-6">
        {items.length > 0 && (
          <div>
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <h3 className="font-semibold text-gray-900">Items without a KRA class ({items.length})</h3>
              <button type="button" className="text-sm text-blue-600 hover:underline" onClick={() => setSelected(new Set(selected.size === items.length ? [] : items.map((i) => i.id)))}>
                {selected.size === items.length ? 'Select none' : 'Select all'}
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
              {items.map((i) => (
                <label key={i.id} className="flex items-start gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                  <input type="checkbox" className="mt-1" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                  <span className="flex-1 min-w-0">
                    <span className="font-medium text-gray-900">{i.name}</span>
                    {i.category && <span className="text-gray-500"> · {i.category}</span>}
                    {i.etimsRegisterError && <span className="block text-xs text-red-600">{i.etimsRegisterError}</span>}
                  </span>
                  <span className="text-gray-500 font-mono text-xs">{i.kraItemCode ?? 'no class'}</span>
                </label>
              ))}
            </div>
            {selected.size > 0 && (
              <div className="mt-3">
                <p className="text-sm text-gray-600 mb-2">Give the {selected.size} selected item(s) this KRA class:</p>
                <ClassPicker onPick={(c) => setClass.mutate(c.itemClsCd)} busy={setClass.isPending} canSync={status.mode === 'LIVE'} />
              </div>
            )}
          </div>
        )}
        {sales.length > 0 && (
          <div>
            <h3 className="font-semibold text-gray-900 mb-2">Invoices KRA refused ({sales.length})</h3>
            <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
              {sales.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                  <span className="font-mono">#{s.receiptNumber}</span>
                  <span className="text-gray-500">{when(s.createdAt)}</span>
                  <span className="font-semibold">{kes(s.totalCents)}</span>
                  <span className="flex-1 min-w-[200px] text-red-600">{s.etimsLastError}</span>
                  <Button size="sm" variant="secondary" loading={retry.isPending && retry.variables === s.id} onClick={() => retry.mutate(s.id)}>Send again</Button>
                </div>
              ))}
            </div>
            {retry.error && <p className="text-sm text-red-600 mt-2">{(retry.error as Error).message}</p>}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function DefaultClassCard({ status, onChanged }: { status: EtimsStatus; onChanged: () => void }) {
  const save = useMutation({ mutationFn: (itemClsCd: string | null) => api.patch('/etims/default-item-class', { itemClsCd }), onSuccess: onChanged });
  return (
    <Card>
      <CardHeader
        title="Default KRA class"
        subtitle="Used for any item that has no class of its own. Handy for a shop that sells one kind of goods; set exact classes on items where it matters."
      />
      <CardBody className="space-y-3">
        <p className="text-sm">Now: <strong className="font-mono">{status.defaultItemClsCd ?? 'none'}</strong>
          {status.defaultItemClsCd && <button type="button" className="ml-3 text-sm text-red-600 hover:underline" onClick={() => save.mutate(null)}>Remove</button>}
        </p>
        <ClassPicker onPick={(c) => save.mutate(c.itemClsCd)} busy={save.isPending} canSync={status.mode === 'LIVE'} />
      </CardBody>
    </Card>
  );
}

/** Search KRA's item class list by name or code. The list comes from KRA once the business is connected. */
function ClassPicker({ onPick, busy, canSync }: { onPick: (c: ItemClass) => void; busy?: boolean; canSync: boolean }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [manual, setManual] = useState('');
  const { data: results = [], isFetching } = useQuery<ItemClass[]>({
    queryKey: ['etims-classes', q],
    queryFn: () => api.get(`/etims/item-classes?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
  });
  const sync = useMutation({ mutationFn: () => api.post<{ count: number }>('/etims/item-classes/sync'), onSuccess: () => qc.invalidateQueries({ queryKey: ['etims-classes'] }) });
  return (
    <div className="space-y-2">
      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 text-sm" placeholder="Search KRA classes, e.g. cement, paint, nails" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {q.trim().length >= 2 && (
        <div className="max-w-md max-h-56 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
          {isFetching && <p className="px-3 py-2 text-sm text-gray-500">Searching…</p>}
          {!isFetching && results.length === 0 && (
            <p className="px-3 py-2 text-sm text-gray-500">No match.{canSync ? ' Download KRA’s list first, or type the 10-digit code below.' : ' Type the 10-digit code below.'}</p>
          )}
          {results.map((c) => (
            <button key={c.itemClsCd} type="button" disabled={busy} onClick={() => onPick(c)} className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 disabled:opacity-50">
              <span className="font-mono text-xs text-gray-500 mr-2">{c.itemClsCd}</span>{c.itemClsNm}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input className="w-40 px-3 py-2 rounded-lg border border-gray-300 text-sm font-mono" placeholder="10-digit code" value={manual} onChange={(e) => setManual(e.target.value.replace(/\D/g, '').slice(0, 10))} />
        <Button size="sm" variant="secondary" disabled={manual.length !== 10 || busy} onClick={() => onPick({ itemClsCd: manual, itemClsNm: '', itemClsLvl: null })}>Use this code</Button>
        {canSync && (
          <Button size="sm" variant="ghost" loading={sync.isPending} onClick={() => sync.mutate()}>Download KRA’s class list</Button>
        )}
        {sync.data && <span className="text-sm text-green-700">{sync.data.count} classes downloaded</span>}
        {sync.error && <span className="text-sm text-red-600">{(sync.error as Error).message}</span>}
      </div>
    </div>
  );
}
