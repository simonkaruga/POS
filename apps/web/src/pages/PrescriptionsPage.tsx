import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { Plus, Pill, CheckCircle, XCircle, Clock, Search, Printer, History, AlertTriangle, ExternalLink } from 'lucide-react';
import { printHtml } from '../lib/printHtml';
import DispenseModal from '../components/DispenseModal';

interface RxItem {
  itemId?: string;
  name: string;
  qty: number;
  dose?: number;         // units per intake e.g. 1
  doseUnit?: string;     // tablet / capsule / ml / mg
  frequency?: string;    // OD / BD / TDS / QID / PRN / ON / OM
  duration?: number;     // days
  instructions?: string;
}

const FREQ_OPTIONS = [
  { value: 'OD',   label: 'OD — Once daily' },
  { value: 'BD',   label: 'BD — Twice daily' },
  { value: 'TDS',  label: 'TDS — Three times daily' },
  { value: 'QID',  label: 'QID — Four times daily' },
  { value: 'ON',   label: 'ON — At night' },
  { value: 'OM',   label: 'OM — Morning only' },
  { value: 'PRN',  label: 'PRN — As needed' },
  { value: 'STAT', label: 'STAT — Immediately (once)' },
];

const UNIT_OPTIONS = ['tablet', 'capsule', 'ml', 'mg', 'sachet', 'drop', 'puff', 'patch', 'injection'];

function formatDosage(item: RxItem): string {
  if (!item.dose && !item.frequency) return '';
  const parts: string[] = [];
  if (item.dose) parts.push(`${item.dose} ${item.doseUnit ?? 'tablet'}${item.dose > 1 ? 's' : ''}`);
  if (item.frequency) parts.push(`× ${item.frequency}`);
  if (item.duration) parts.push(`× ${item.duration} day${item.duration > 1 ? 's' : ''}`);
  return parts.join(' ');
}

interface Prescription {
  id: string;
  prescriptionNumber: string;
  patientName: string;
  patientPhone?: string;
  patientDOB?: string;
  doctorName: string;
  doctorLicense?: string;
  diagnosis?: string;
  items: string; // JSON
  status: string;
  notes?: string;
  dispensedAt?: string;
  dispensedBy?: string;
  referralNotes?: string;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  DISPENSED: 'bg-green-100 text-green-700',
  PARTIAL: 'bg-blue-100 text-blue-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
  REFERRED_EXTERNAL: 'bg-purple-100 text-purple-700',
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  PENDING: <Clock className="w-3.5 h-3.5" />,
  DISPENSED: <CheckCircle className="w-3.5 h-3.5" />,
  CANCELLED: <XCircle className="w-3.5 h-3.5" />,
  REFERRED_EXTERNAL: <ExternalLink className="w-3.5 h-3.5" />,
};

export default function PrescriptionsPage() {
  const user = useAuthStore((s) => s.user);
  const businessId = user?.businessId ?? '';
  const storeId = user?.storeId;
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Prescription | null>(null);
  const [showReferModal, setShowReferModal] = useState(false);
  const [referNotes, setReferNotes] = useState('');

  const [form, setForm] = useState({
    patientName: '',
    patientPhone: '',
    patientDOB: '',
    doctorName: '',
    doctorLicense: '',
    diagnosis: '',
    notes: '',
    items: [{ name: '', qty: 1, dose: 1, doseUnit: 'tablet', frequency: 'BD', duration: 7, instructions: '' }] as RxItem[],
  });
  const [itemSearches, setItemSearches] = useState<string[]>(['']);
  const [openSearchIdx, setOpenSearchIdx] = useState<number | null>(null);

  const { data: prescriptions = [] } = useQuery<Prescription[]>({
    queryKey: ['prescriptions', businessId, storeId, statusFilter],
    queryFn: () => api.get(`/prescriptions?businessId=${businessId}&storeId=${storeId}&status=${statusFilter}`),
    enabled: !!businessId,
    refetchInterval: 30000,
  });

  const { data: inventoryItems = [] } = useQuery<any[]>({
    queryKey: ['items-for-rx', businessId, storeId],
    queryFn: () => api.get(`/items?businessId=${businessId}&storeId=${storeId}&activeOnly=true`),
    enabled: showCreate && !!businessId,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/prescriptions', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['prescriptions'] });
      setShowCreate(false);
      resetForm();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/prescriptions/${id}/cancel`, {}),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['prescriptions'] }); setSelected(null); },
  });

  const referMutation = useMutation({
    mutationFn: ({ id, referralNotes }: { id: string; referralNotes: string }) =>
      api.patch(`/prescriptions/${id}/refer`, { referralNotes }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['prescriptions'] });
      setShowReferModal(false);
      setReferNotes('');
      setSelected(null);
    },
  });

  const resetForm = () => {
    setForm({
      patientName: '', patientPhone: '', patientDOB: '', doctorName: '',
      doctorLicense: '', diagnosis: '', notes: '',
      items: [{ name: '', qty: 1, dose: 1, doseUnit: 'tablet', frequency: 'BD', duration: 7, instructions: '' }],
    });
    setItemSearches(['']);
    setOpenSearchIdx(null);
  };

  const filtered = prescriptions.filter((rx) =>
    search
      ? rx.patientName.toLowerCase().includes(search.toLowerCase()) ||
        rx.prescriptionNumber.toLowerCase().includes(search.toLowerCase()) ||
        rx.doctorName.toLowerCase().includes(search.toLowerCase())
      : true
  );

  const counts: Record<string, number> = {
    ALL: prescriptions.length,
    PENDING: prescriptions.filter((r) => r.status === 'PENDING').length,
    DISPENSED: prescriptions.filter((r) => r.status === 'DISPENSED').length,
    REFERRED_EXTERNAL: prescriptions.filter((r) => r.status === 'REFERRED_EXTERNAL').length,
    CANCELLED: prescriptions.filter((r) => r.status === 'CANCELLED').length,
  };

  const [dispensing, setDispensing] = useState<Prescription | null>(null);

  const handlePrintDispense = (rx: Prescription) => {
    const items: RxItem[] = (() => { try { return JSON.parse(rx.items || '[]'); } catch { return []; } })();
    printHtml(`<html><head><title>Prescription ${rx.prescriptionNumber}</title>
    <style>
      body{font-family:monospace;font-size:13px;padding:16px;max-width:380px;margin:0 auto}
      h2{text-align:center;margin-bottom:4px;font-size:15px}
      .sub{text-align:center;font-size:11px;color:#555;margin-bottom:12px}
      hr{border:none;border-top:1px dashed #aaa;margin:10px 0}
      table{width:100%;border-collapse:collapse}
      td{padding:3px 4px;vertical-align:top}
      td:nth-child(2){text-align:center;white-space:nowrap}
      td:nth-child(3){font-size:11px;color:#555}
      .label{color:#555;font-size:11px}
      .ref-box{border:1px dashed #6d28d9;padding:8px;margin-top:10px;border-radius:4px;color:#5b21b6}
    </style>
    </head><body>
    <h2>PRESCRIPTION</h2>
    <div class="sub">${rx.prescriptionNumber} &mdash; ${new Date(rx.createdAt).toLocaleDateString()}</div>
    <hr/>
    <p><span class="label">Patient:</span> <b>${rx.patientName}</b>${rx.patientPhone ? ` &nbsp;|&nbsp; ${rx.patientPhone}` : ''}${rx.patientDOB ? `<br/><span class="label">DOB:</span> ${rx.patientDOB}` : ''}</p>
    <p><span class="label">Doctor:</span> <b>Dr. ${rx.doctorName}</b>${rx.doctorLicense ? ` (${rx.doctorLicense})` : ''}</p>
    ${rx.diagnosis ? `<p><span class="label">Diagnosis:</span> ${rx.diagnosis}</p>` : ''}
    <hr/>
    <b>Prescribed Items:</b>
    <table style="margin-top:6px;width:100%">
      ${items.map((item) => `
        <tr>
          <td style="padding:4px 4px 0;font-weight:600">${item.name}</td>
          <td style="padding:4px 4px 0;text-align:right;white-space:nowrap">${item.qty} ${item.doseUnit ?? 'unit'}${item.qty !== 1 ? 's' : ''}</td>
        </tr>
        ${(item.dose || item.frequency) ? `<tr><td colspan="2" style="padding:0 4px 3px;font-size:11px;color:#1F6BFF">${formatDosage(item)}</td></tr>` : ''}
        ${item.instructions ? `<tr><td colspan="2" style="padding:0 4px 6px;font-size:11px;color:#666;font-style:italic">${item.instructions}</td></tr>` : ''}
      `).join('')}
    </table>
    ${rx.notes ? `<hr/><p><span class="label">Notes:</span> <i>${rx.notes}</i></p>` : ''}
    ${rx.status === 'REFERRED_EXTERNAL' && rx.referralNotes ? `<div class="ref-box"><b>Referred Out:</b> ${rx.referralNotes}</div>` : ''}
    <hr/>
    <p class="sub">Status: <b>${rx.status}</b>${rx.dispensedBy ? ` &mdash; Dispensed by ${rx.dispensedBy}` : ''}</p>
    </body></html>`);
  };

  const [checkingInteractions, setCheckingInteractions] = useState(false);
  const [interactionResults, setInteractionResults] = useState<any[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const checkInteractionsMut = useMutation({
    mutationFn: ({ businessId: bId, drugNames }: { businessId: string; drugNames: string[] }) =>
      api.post<any[]>('/prescriptions/check-interactions', { businessId: bId, drugNames }),
    onSuccess: (results) => { setInteractionResults(results); setCheckingInteractions(false); },
    onError: () => setCheckingInteractions(false),
  });

  const { data: patientHistory = [] } = useQuery<any[]>({
    queryKey: ['prescriptions-history', businessId, selected?.id],
    queryFn: () => api.get(`/prescriptions?businessId=${businessId}&storeId=${storeId}&status=ALL`),
    enabled: showHistory && !!selected,
  });

  const canManage = user?.role === 'OWNER' || user?.role === 'MANAGER' || user?.role === 'CASHIER';

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Pill className="w-5 h-5 text-blue-600" /> Prescription Queue
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{counts.PENDING} pending</p>
        </div>
        {canManage && (
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            <Plus className="w-4 h-4" /> New Prescription
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patient, RX number, doctor…"
            className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:text-white" />
        </div>
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          {(['ALL', 'PENDING', 'DISPENSED', 'REFERRED_EXTERNAL', 'CANCELLED'] as string[]).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${statusFilter === s ? 'bg-white dark:bg-gray-700 shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
              {s} <span className="ml-1">({counts[s] ?? 0})</span>
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-12 text-center text-gray-400">
            <Pill className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No prescriptions {statusFilter !== 'ALL' ? `with status ${statusFilter}` : 'found'}</p>
          </div>
        )}
        {filtered.map((rx) => {
          const items: RxItem[] = (() => { try { return JSON.parse(rx.items); } catch { return []; } })();
          return (
            <div key={rx.id} onClick={() => setSelected(rx)}
              className="surface-interactive rounded-xl p-4 flex items-center justify-between gap-4" role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.currentTarget.click(); } }}>
              <div className="flex items-start gap-4 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
                  <Pill className="w-5 h-5 text-blue-600" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-semibold text-blue-700 dark:text-blue-400">{rx.prescriptionNumber}</span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[rx.status] ?? ''}`}>
                      {STATUS_ICONS[rx.status]} {rx.status}
                    </span>
                  </div>
                  <p className="font-medium text-gray-900 dark:text-white mt-0.5">{rx.patientName}</p>
                  <p className="text-sm text-gray-500">Dr. {rx.doctorName}{rx.diagnosis ? ` · ${rx.diagnosis}` : ''}</p>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{items.length} drug{items.length !== 1 ? 's' : ''}</p>
                <p className="text-xs text-gray-400 mt-0.5">{items.filter((it) => it.itemId).length}/{items.length} linked</p>
                <p className="text-xs text-gray-400 mt-0.5">{new Date(rx.createdAt).toLocaleDateString()}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail Modal */}
      {selected && (() => {
        const items: RxItem[] = (() => { try { return JSON.parse(selected.items); } catch { return []; } })();
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg shadow-2xl">
              <div className="p-6 border-b dark:border-gray-700 flex items-center justify-between">
                <div>
                  <p className="font-mono text-sm text-blue-600">{selected.prescriptionNumber}</p>
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white mt-0.5">{selected.patientName}</h2>
                </div>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[selected.status] ?? ''}`}>{selected.status}</span>
              </div>
              <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {selected.patientPhone && <div><span className="text-gray-500">Phone:</span> <span className="font-medium">{selected.patientPhone}</span></div>}
                  {selected.patientDOB && <div><span className="text-gray-500">DOB:</span> <span className="font-medium">{selected.patientDOB}</span></div>}
                  <div><span className="text-gray-500">Doctor:</span> <span className="font-medium">Dr. {selected.doctorName}</span></div>
                  {selected.doctorLicense && <div><span className="text-gray-500">License:</span> <span className="font-medium">{selected.doctorLicense}</span></div>}
                  {selected.diagnosis && <div className="col-span-2"><span className="text-gray-500">Diagnosis:</span> <span className="font-medium">{selected.diagnosis}</span></div>}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Prescription Items:</p>
                  <div className="space-y-1.5">
                    {items.map((item, i) => (
                      <div key={i} className="flex items-start gap-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2.5">
                        <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-sm text-gray-900 dark:text-white">{item.name}</p>
                            {item.itemId && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">Stock linked</span>}
                          </div>
                          {(item.dose || item.frequency) && (
                            <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 mt-0.5">
                              {formatDosage(item)} — {item.qty} {item.doseUnit ?? 'tablet'}{item.qty !== 1 ? 's' : ''} total
                            </p>
                          )}
                          {!item.dose && !item.frequency && (
                            <p className="text-xs text-gray-500 mt-0.5">× {item.qty}</p>
                          )}
                          {item.instructions && <p className="text-xs text-gray-400 italic mt-0.5">{item.instructions}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {selected.notes && (
                  <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 text-sm text-amber-700 dark:text-amber-300">
                    <p className="font-medium mb-0.5">Notes</p>
                    <p>{selected.notes}</p>
                  </div>
                )}
                {selected.dispensedAt && (
                  <p className="text-xs text-gray-400">Dispensed {new Date(selected.dispensedAt).toLocaleString()} by {selected.dispensedBy}</p>
                )}
                {selected.status === 'REFERRED_EXTERNAL' && selected.referralNotes && (
                  <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3 text-sm text-purple-700 dark:text-purple-300">
                    <p className="font-medium mb-0.5 flex items-center gap-1.5"><ExternalLink className="w-3.5 h-3.5" /> Referred Out</p>
                    <p>{selected.referralNotes}</p>
                  </div>
                )}
              </div>
              {/* Drug interaction results */}
              {interactionResults !== null && (
                <div className={`mx-6 mb-2 rounded-lg p-3 text-sm ${interactionResults.length === 0 ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                  {interactionResults.length === 0 ? (
                    <p className="font-medium">No known drug interactions detected.</p>
                  ) : (
                    <>
                      <p className="font-bold mb-1"><AlertTriangle className="w-4 h-4 inline mr-1" />{interactionResults.length} interaction(s) detected:</p>
                      {interactionResults.map((it: any) => (
                        <div key={it.id} className="mt-1">
                          <span className="font-medium">{it.drug1Name} + {it.drug2Name}</span>
                          <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${it.severity === 'SEVERE' || it.severity === 'CONTRAINDICATED' ? 'bg-red-200' : 'bg-amber-100 text-amber-700'}`}>{it.severity}</span>
                          <p className="text-xs mt-0.5">{it.description}</p>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}

              <div className="p-4 border-t dark:border-gray-700 flex gap-2 justify-between flex-wrap">
                <div className="flex gap-2">
                  <button onClick={() => handlePrintDispense(selected)} className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50">
                    <Printer className="w-4 h-4" /> Print
                  </button>
                  <button
                    onClick={() => {
                      setInteractionResults(null);
                      setCheckingInteractions(true);
                      const itemsParsed: RxItem[] = (() => { try { return JSON.parse(selected.items); } catch { return []; } })();
                      const names = itemsParsed.map((i) => i.name).filter(Boolean);
                      if (names.length < 2) { setInteractionResults([]); setCheckingInteractions(false); return; }
                      checkInteractionsMut.mutate({ businessId, drugNames: names });
                    }}
                    disabled={checkingInteractions}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm text-amber-600 border border-amber-300 rounded-lg hover:bg-amber-50 disabled:opacity-50"
                  >
                    <AlertTriangle className="w-4 h-4" /> Check Interactions
                  </button>
                  <button
                    onClick={() => { setShowHistory(true); }}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm text-purple-600 border border-purple-300 rounded-lg hover:bg-purple-50"
                  >
                    <History className="w-4 h-4" /> Patient History
                  </button>
                </div>
                <div className="flex gap-2">
                  {selected.status === 'PENDING' && canManage && (
                    <>
                      <button onClick={() => cancelMutation.mutate(selected.id)} disabled={cancelMutation.isPending}
                        className="px-4 py-2 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50">
                        Cancel
                      </button>
                      <button onClick={() => { setReferNotes(''); setShowReferModal(true); }}
                        className="flex items-center gap-1.5 px-4 py-2 text-sm border border-purple-300 text-purple-600 rounded-lg hover:bg-purple-50">
                        <ExternalLink className="w-4 h-4" /> Refer Out
                      </button>
                      <button onClick={() => setDispensing(selected)}
                        className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium">
                        Dispense
                      </button>
                    </>
                  )}
                  <button onClick={() => { setSelected(null); setInteractionResults(null); setShowHistory(false); setShowReferModal(false); setReferNotes(''); }} className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50">
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {dispensing && (
        <DispenseModal
          rx={dispensing}
          mode="dispense"
          onClose={() => { setDispensing(null); setSelected(null); }}
        />
      )}

      {/* Patient History Modal */}
      {showHistory && selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[80vh] flex flex-col">
            <div className="p-4 border-b dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-bold dark:text-white flex items-center gap-2">
                <History className="w-5 h-5 text-purple-600" /> Patient History — {selected.patientName}
              </h2>
              <button onClick={() => setShowHistory(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2">RX #</th>
                    <th className="text-left px-4 py-2">Doctor</th>
                    <th className="text-left px-4 py-2">Status</th>
                    <th className="text-left px-4 py-2">Items</th>
                    <th className="text-left px-4 py-2">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {patientHistory
                    .filter((rx: any) => rx.patientName.toLowerCase() === selected.patientName.toLowerCase())
                    .map((rx: any) => {
                      const rxItems: RxItem[] = (() => { try { return JSON.parse(rx.items); } catch { return []; } })();
                      return (
                        <tr key={rx.id} className="border-t hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="px-4 py-2 font-mono text-xs text-blue-600">{rx.prescriptionNumber}</td>
                          <td className="px-4 py-2 text-gray-600 dark:text-gray-400">Dr. {rx.doctorName}</td>
                          <td className="px-4 py-2">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[rx.status] ?? ''}`}>{rx.status}</span>
                          </td>
                          <td className="px-4 py-2 text-gray-600 dark:text-gray-400 text-xs">{rxItems.map((i) => `${i.name} ×${i.qty}`).join(', ')}</td>
                          <td className="px-4 py-2 text-gray-400 text-xs">{new Date(rx.createdAt).toLocaleDateString()}</td>
                        </tr>
                      );
                    })}
                  {patientHistory.filter((rx: any) => rx.patientName.toLowerCase() === selected.patientName.toLowerCase()).length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No prescription history for this patient</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t dark:border-gray-700 flex justify-end">
              <button onClick={() => setShowHistory(false)} className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Refer Out Modal */}
      {showReferModal && selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-6 border-b dark:border-gray-700">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <ExternalLink className="w-5 h-5 text-purple-600" /> Refer Out
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Referring <span className="font-medium text-gray-700 dark:text-gray-300">{selected.patientName}</span> to an external pharmacy
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Referral Notes <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={referNotes}
                  onChange={(e) => setReferNotes(e.target.value)}
                  rows={4}
                  placeholder="e.g. Drug not in stock. Patient referred to Nairobi Hospital Pharmacy for Metformin 500mg × 60. Please carry prescription."
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-purple-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white resize-none"
                />
              </div>
              <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3 text-xs text-purple-700 dark:text-purple-300">
                This prescription will be marked <span className="font-semibold">REFERRED EXTERNAL</span>. No stock will be deducted.
              </div>
            </div>
            <div className="p-4 border-t dark:border-gray-700 flex gap-2 justify-end">
              <button onClick={() => setShowReferModal(false)} className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50">
                Back
              </button>
              <button
                onClick={() => referMutation.mutate({ id: selected.id, referralNotes: referNotes })}
                disabled={!referNotes.trim() || referMutation.isPending}
                className="flex items-center gap-2 px-5 py-2 text-sm bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50"
              >
                <ExternalLink className="w-4 h-4" />
                {referMutation.isPending ? 'Referring…' : 'Confirm Refer Out'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">
            <div className="p-6 border-b dark:border-gray-700">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">New Prescription</h2>
            </div>
            <div className="p-6 overflow-y-auto space-y-5 flex-1">
              {/* Patient */}
              <div>
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Patient Information</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Patient Name *</label>
                    <input value={form.patientName} onChange={(e) => setForm((f) => ({ ...f, patientName: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="Full name" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Phone</label>
                    <input value={form.patientPhone} onChange={(e) => setForm((f) => ({ ...f, patientPhone: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="0712 345 678" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Date of Birth</label>
                    <input type="date" value={form.patientDOB} onChange={(e) => setForm((f) => ({ ...f, patientDOB: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white" aria-label="Date" />
                  </div>
                </div>
              </div>
              {/* Doctor */}
              <div>
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Prescribing Doctor</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Doctor Name *</label>
                    <input value={form.doctorName} onChange={(e) => setForm((f) => ({ ...f, doctorName: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="Dr. John Mwangi" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">License No.</label>
                    <input value={form.doctorLicense} onChange={(e) => setForm((f) => ({ ...f, doctorLicense: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="KMB/12345" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Diagnosis</label>
                    <input value={form.diagnosis} onChange={(e) => setForm((f) => ({ ...f, diagnosis: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="e.g. Hypertension, Malaria" />
                  </div>
                </div>
              </div>
              {/* Items */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Prescription Items</p>
                  <button onClick={() => {
                    setForm((f) => ({ ...f, items: [...f.items, { name: '', qty: 1, dose: 1, doseUnit: 'tablet', frequency: 'BD', duration: 7, instructions: '' }] }));
                    setItemSearches((s) => [...s, '']);
                  }} className="text-xs text-blue-600 hover:underline">+ Add Drug</button>
                </div>
                <div className="space-y-3">
                  {form.items.map((item, i) => {
                    const searchVal = itemSearches[i] ?? '';
                    const suggestions = searchVal.length >= 2
                      ? inventoryItems.filter((it: any) =>
                          it.name.toLowerCase().includes(searchVal.toLowerCase()) ||
                          (it.barcode ?? '').toLowerCase().includes(searchVal.toLowerCase())
                        ).slice(0, 8)
                      : [];
                    const updateItem = (patch: Partial<RxItem>) =>
                      setForm((f) => { const items = [...f.items]; items[i] = { ...items[i], ...patch }; return { ...f, items }; });

                    return (
                      <div key={i} className="border dark:border-gray-700 rounded-xl p-3 space-y-2 bg-gray-50 dark:bg-gray-700/40">
                        {/* Row 1: Drug search + remove */}
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <input
                              value={searchVal || item.name}
                              onChange={(e) => {
                                setItemSearches((s) => { const n = [...s]; n[i] = e.target.value; return n; });
                                updateItem({ name: e.target.value, itemId: undefined });
                                setOpenSearchIdx(i);
                              }}
                              onFocus={() => setOpenSearchIdx(i)}
                              onBlur={() => setTimeout(() => setOpenSearchIdx(null), 150)}
                              placeholder="Search drug / type name…"
                              className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500"
                            />
                            {item.itemId && (
                              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">✓ Linked</span>
                            )}
                            {openSearchIdx === i && suggestions.length > 0 && (
                              <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                                {suggestions.map((it: any) => (
                                  <button key={it.id} type="button"
                                    onMouseDown={() => {
                                      updateItem({ itemId: it.id, name: it.name, doseUnit: it.unit ?? 'tablet' });
                                      setItemSearches((s) => { const n = [...s]; n[i] = ''; return n; });
                                      setOpenSearchIdx(null);
                                    }}
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/30 flex items-center justify-between gap-2">
                                    <span className="font-medium text-gray-900 dark:text-white">{it.name}</span>
                                    <span className="text-xs text-gray-400 flex-shrink-0">{it.category}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <button onClick={() => {
                            setForm((f) => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));
                            setItemSearches((s) => s.filter((_, idx) => idx !== i));
                          }} className="p-2 text-red-400 hover:text-red-600 text-lg leading-none flex-shrink-0">×</button>
                        </div>

                        {/* Row 2: Dosage */}
                        <div className="grid grid-cols-6 sm:grid-cols-12 gap-2 items-center">
                          <div className="col-span-3 sm:col-span-2">
                            <label className="block text-xs text-gray-500 mb-0.5">Dose</label>
                            <input type="number" min="0.5" step="0.5" value={item.dose ?? 1}
                              onChange={(e) => updateItem({ dose: Number(e.target.value) })}
                              className="w-full px-2 py-1.5 border rounded-lg text-sm text-center dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                          </div>
                          <div className="col-span-3">
                            <label className="block text-xs text-gray-500 mb-0.5">Unit</label>
                            <select value={item.doseUnit ?? 'tablet'}
                              onChange={(e) => updateItem({ doseUnit: e.target.value })}
                              className="w-full px-2 py-1.5 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                              {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                            </select>
                          </div>
                          <div className="col-span-3 sm:col-span-4">
                            <label className="block text-xs text-gray-500 mb-0.5">Frequency</label>
                            <select value={item.frequency ?? 'BD'}
                              onChange={(e) => updateItem({ frequency: e.target.value })}
                              className="w-full px-2 py-1.5 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                              {FREQ_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                            </select>
                          </div>
                          <div className="col-span-3">
                            <label className="block text-xs text-gray-500 mb-0.5">Days</label>
                            <input type="number" min="1" value={item.duration ?? 7}
                              onChange={(e) => updateItem({ duration: Number(e.target.value) })}
                              className="w-full px-2 py-1.5 border rounded-lg text-sm text-center dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                          </div>
                        </div>

                        {/* Row 3: Total qty + instructions */}
                        <div className="grid grid-cols-6 sm:grid-cols-12 gap-2 items-center">
                          <div className="col-span-2 sm:col-span-3">
                            <label className="block text-xs text-gray-500 mb-0.5">Total Qty</label>
                            <input type="number" min="1" value={item.qty}
                              onChange={(e) => updateItem({ qty: Number(e.target.value) })}
                              className="w-full px-2 py-1.5 border rounded-lg text-sm text-center dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                          </div>
                          <div className="col-span-4 sm:col-span-9">
                            <label className="block text-xs text-gray-500 mb-0.5">Special Instructions</label>
                            <input value={item.instructions ?? ''}
                              onChange={(e) => updateItem({ instructions: e.target.value })}
                              placeholder="e.g. Take with food, avoid alcohol…"
                              className="w-full px-2 py-1.5 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                          </div>
                        </div>

                        {/* Dosage summary */}
                        {(item.dose || item.frequency) && (
                          <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                            {formatDosage(item)} — dispense {item.qty} {item.doseUnit ?? 'tablet'}{item.qty !== 1 ? 's' : ''}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2}
                  className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="Additional notes…" />
              </div>
            </div>
            <div className="p-4 border-t dark:border-gray-700 flex gap-2 justify-end">
              <button onClick={() => { setShowCreate(false); resetForm(); }} className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={() => createMutation.mutate({ businessId, storeId, ...form })}
                disabled={!form.patientName || !form.doctorName || form.items.some((i) => !i.name) || createMutation.isPending}
                className="px-6 py-2 text-sm bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">
                {createMutation.isPending ? 'Creating…' : 'Create Prescription'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
