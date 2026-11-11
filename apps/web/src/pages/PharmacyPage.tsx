import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { useDialog } from '../components/Dialog';
import {
  Pill, AlertTriangle, Shield, FileText, Plus, Trash2,
  RefreshCw, TrendingUp, BookOpen, Pencil, Check, X, Tag, List,
} from 'lucide-react';
import { formatKES } from '@pos/shared';
import { printBarcodeLabel } from '../lib/printer';
import { printHtml } from '../lib/printHtml';
import DispenseModal from '../components/DispenseModal';

type Tab = 'drugs' | 'interactions' | 'refill-queue' | 'controlled-log' | 'providers' | 'claims' | 'labels' | 'formulary';

const SEV_COLOR: Record<string, string> = {
  MILD: 'bg-green-100 text-green-700',
  MODERATE: 'bg-amber-100 text-amber-700',
  SEVERE: 'bg-red-100 text-red-700',
  CONTRAINDICATED: 'bg-red-200 text-red-900 font-bold',
};

const CLAIM_COLOR: Record<string, string> = {
  SUBMITTED: 'bg-blue-100 text-blue-700',
  APPROVED: 'bg-green-100 text-green-700',
  PAID: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
  VOIDED: 'bg-gray-100 text-gray-500',
};

export default function PharmacyPage() {
  const user = useAuthStore((s) => s.user);
  const businessId = user?.businessId ?? '';
  const qc = useQueryClient();
  const { prompt } = useDialog();
  const [tab, setTab] = useState<Tab>('drugs');

  // ── Drug Catalogue ──
  const [drugSearch, setDrugSearch] = useState('');
  const { data: drugs = [] } = useQuery({
    queryKey: ['pharmacy-drugs', businessId, drugSearch],
    queryFn: () => api.get<any[]>(`/pharmacy/drugs?businessId=${businessId}${drugSearch ? `&search=${encodeURIComponent(drugSearch)}` : ''}`),
    enabled: tab === 'drugs' || tab === 'labels',
  });
  const [drugForm, setDrugForm] = useState({ genericName: '', brandName: '', strength: '', dosageForm: 'TABLET', category: 'OTHER', scheduleClass: 'OTC', defaultInstructions: '' });
  const [showDrugForm, setShowDrugForm] = useState(false);
  const [editDrug, setEditDrug] = useState<any>(null);
  const createDrug = useMutation({
    mutationFn: (d: any) => api.post('/pharmacy/drugs', { ...d, businessId }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pharmacy-drugs'] }); setShowDrugForm(false); setDrugForm({ genericName: '', brandName: '', strength: '', dosageForm: 'TABLET', category: 'OTHER', scheduleClass: 'OTC', defaultInstructions: '' }); },
  });
  const updateDrug = useMutation({
    mutationFn: ({ id, ...d }: any) => api.patch(`/pharmacy/drugs/${id}`, d),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pharmacy-drugs'] }); setEditDrug(null); },
  });
  const deleteDrug = useMutation({
    mutationFn: (id: string) => api.delete(`/pharmacy/drugs/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['pharmacy-drugs'] }),
  });

  // ── Drug Interactions ──
  const { data: interactions = [] } = useQuery({
    queryKey: ['pharmacy-interactions', businessId],
    queryFn: () => api.get<any[]>(`/pharmacy/interactions?businessId=${businessId}`),
    enabled: tab === 'interactions',
  });
  const [intForm, setIntForm] = useState({ drug1Name: '', drug2Name: '', severity: 'MODERATE', description: '' });
  const createInt = useMutation({
    mutationFn: (d: any) => api.post('/pharmacy/interactions', d),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pharmacy-interactions'] }); setIntForm({ drug1Name: '', drug2Name: '', severity: 'MODERATE', description: '' }); },
  });
  const deleteInt = useMutation({
    mutationFn: (id: string) => api.delete(`/pharmacy/interactions/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['pharmacy-interactions'] }),
  });

  // ── Refill Queue ──
  const { data: refillQueue = [] } = useQuery({
    queryKey: ['pharmacy-refill-queue', businessId],
    queryFn: () => api.get<any[]>(`/prescriptions/refill-queue?businessId=${businessId}`),
    enabled: tab === 'refill-queue',
    refetchInterval: 60000,
  });
  const [refilling, setRefilling] = useState<{ id: string; prescriptionNumber: string; patientName: string } | null>(null);

  // ── Controlled Substance Log ──
  const [logStart, setLogStart] = useState('');
  const [logEnd, setLogEnd] = useState('');
  const { data: controlledLog = [], refetch: refetchLog } = useQuery({
    queryKey: ['pharmacy-controlled-log', businessId, logStart, logEnd],
    queryFn: () => {
      let url = `/prescriptions/controlled-log?businessId=${businessId}`;
      if (logStart) url += `&startDate=${logStart}`;
      if (logEnd) url += `&endDate=${logEnd}`;
      return api.get<any[]>(url);
    },
    enabled: tab === 'controlled-log',
  });
  const [showLogForm, setShowLogForm] = useState(false);
  const [logForm, setLogForm] = useState({
    itemName: '', scheduleClass: 'II', quantityDispensed: '', unit: 'units',
    patientName: '', patientIdNumber: '', prescriberName: '', prescriberLicense: '',
    dispensedBy: user?.name ?? '', notes: '',
  });
  const addLog = useMutation({
    mutationFn: (d: any) => api.post('/prescriptions/controlled-log', { ...d, businessId }),
    onSuccess: () => { void refetchLog(); setShowLogForm(false); setLogForm({ itemName: '', scheduleClass: 'II', quantityDispensed: '', unit: 'units', patientName: '', patientIdNumber: '', prescriberName: '', prescriberLicense: '', dispensedBy: user?.name ?? '', notes: '' }); },
  });

  // ── Insurance Providers ──
  const { data: providers = [] } = useQuery({
    queryKey: ['pharmacy-providers', businessId],
    queryFn: () => api.get<any[]>(`/pharmacy/providers?businessId=${businessId}`),
    enabled: tab === 'providers' || tab === 'claims',
  });
  const [provForm, setProvForm] = useState({ name: '', code: '', contactPhone: '', contactEmail: '' });
  const createProv = useMutation({
    mutationFn: (d: any) => api.post('/pharmacy/providers', { ...d, businessId }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pharmacy-providers'] }); setProvForm({ name: '', code: '', contactPhone: '', contactEmail: '' }); },
  });
  const toggleProv = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/pharmacy/providers/${id}`, { isActive }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['pharmacy-providers'] }),
  });

  // ── Insurance Claims ──
  const [claimStatus, setClaimStatus] = useState('');
  const { data: claims = [] } = useQuery({
    queryKey: ['pharmacy-claims', businessId, claimStatus],
    queryFn: () => api.get<any[]>(`/pharmacy/claims?businessId=${businessId}${claimStatus ? `&status=${claimStatus}` : ''}`),
    enabled: tab === 'claims',
  });
  const { data: claimStats } = useQuery({
    queryKey: ['pharmacy-claim-stats', businessId],
    queryFn: () => api.get<any>(`/pharmacy/claims/stats?businessId=${businessId}`),
    enabled: tab === 'claims',
  });
  const updateClaim = useMutation({
    mutationFn: ({ id, ...data }: any) => api.patch(`/pharmacy/claims/${id}`, data),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pharmacy-claims'] }); void qc.invalidateQueries({ queryKey: ['pharmacy-claim-stats'] }); },
  });

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'drugs', label: 'Drug Catalogue', icon: <BookOpen className="w-4 h-4" /> },
    { id: 'interactions', label: 'Drug Interactions', icon: <AlertTriangle className="w-4 h-4" /> },
    { id: 'refill-queue', label: 'Refill Queue', icon: <RefreshCw className="w-4 h-4" /> },
    { id: 'controlled-log', label: 'Controlled Substances', icon: <Shield className="w-4 h-4" /> },
    { id: 'providers', label: 'Insurance Providers', icon: <FileText className="w-4 h-4" /> },
    { id: 'claims', label: 'Claims', icon: <TrendingUp className="w-4 h-4" /> },
    { id: 'labels', label: 'Drug Labels', icon: <Tag className="w-4 h-4" /> },
    { id: 'formulary', label: 'Formulary', icon: <List className="w-4 h-4" /> },
  ];

  return (
    <div className="p-3 sm:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Pill className="w-6 h-6 text-blue-600" />
        <h1 className="text-2xl font-bold">Pharmacy Management</h1>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 border-b overflow-x-auto [&>button]:shrink-0 [&>button]:whitespace-nowrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              tab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ── Drug Catalogue ── */}
      {tab === 'drugs' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <input
                className="w-full border rounded px-3 py-1.5 text-sm pl-8"
                placeholder="Search by generic or brand name..."
                value={drugSearch}
                onChange={(e) => setDrugSearch(e.target.value)}
              />
              <BookOpen className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            </div>
            <button onClick={() => setShowDrugForm(true)} className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm font-medium flex items-center gap-1">
              <Plus className="w-4 h-4" />Add Drug
            </button>
          </div>

          {showDrugForm && (
            <div className="bg-white border rounded-lg p-4 space-y-3">
              <h3 className="font-semibold text-sm">Add Drug to Catalogue</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <input className="border rounded px-3 py-1.5 text-sm" placeholder="Generic name *"
                  value={drugForm.genericName} onChange={(e) => setDrugForm({ ...drugForm, genericName: e.target.value })} />
                <input className="border rounded px-3 py-1.5 text-sm" placeholder="Brand name"
                  value={drugForm.brandName} onChange={(e) => setDrugForm({ ...drugForm, brandName: e.target.value })} />
                <input className="border rounded px-3 py-1.5 text-sm" placeholder="Strength (e.g. 500mg)"
                  value={drugForm.strength} onChange={(e) => setDrugForm({ ...drugForm, strength: e.target.value })} />
                <select className="border rounded px-3 py-1.5 text-sm" value={drugForm.dosageForm}
                  onChange={(e) => setDrugForm({ ...drugForm, dosageForm: e.target.value })}>
                  {['TABLET', 'CAPSULE', 'SYRUP', 'INJECTION', 'CREAM', 'DROPS', 'OTHER'].map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <select className="border rounded px-3 py-1.5 text-sm" value={drugForm.category}
                  onChange={(e) => setDrugForm({ ...drugForm, category: e.target.value })}>
                  {['ANTIBIOTIC', 'ANALGESIC', 'ANTIMALARIA', 'ANTIHISTAMINE', 'ANTIFUNGAL', 'OTHER'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select className="border rounded px-3 py-1.5 text-sm" value={drugForm.scheduleClass}
                  onChange={(e) => setDrugForm({ ...drugForm, scheduleClass: e.target.value })} aria-label="OTC (Over the Counter)">
                  <option value="OTC">OTC (Over the Counter)</option>
                  {['II', 'III', 'IV', 'V'].map((s) => <option key={s} value={s}>Schedule {s}</option>)}
                </select>
              </div>
              <input className="border rounded px-3 py-1.5 text-sm w-full" placeholder="Default dispensing instructions (optional)"
                value={drugForm.defaultInstructions} onChange={(e) => setDrugForm({ ...drugForm, defaultInstructions: e.target.value })} />
              <div className="flex gap-2">
                <button onClick={() => createDrug.mutate(drugForm)} disabled={!drugForm.genericName || createDrug.isPending}
                  className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50">Save Drug</button>
                <button onClick={() => setShowDrugForm(false)} className="border px-4 py-1.5 rounded text-sm">Cancel</button>
              </div>
            </div>
          )}

          <div className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-4 py-2">Generic Name</th>
                  <th className="text-left px-4 py-2">Brand</th>
                  <th className="text-left px-4 py-2">Strength</th>
                  <th className="text-left px-4 py-2">Form</th>
                  <th className="text-left px-4 py-2">Category</th>
                  <th className="text-left px-4 py-2">Schedule</th>
                  <th className="text-left px-4 py-2">Instructions</th>
                  <th className="px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {drugs.map((drug: any) => (
                  <tr key={drug.id} className="border-t hover:bg-gray-50">
                    {editDrug?.id === drug.id ? (
                      <>
                        <td className="px-4 py-2">
                          <input className="border rounded px-2 py-1 text-xs w-32" value={editDrug.genericName}
                            onChange={(e) => setEditDrug({ ...editDrug, genericName: e.target.value })} />
                        </td>
                        <td className="px-4 py-2">
                          <input className="border rounded px-2 py-1 text-xs w-28" value={editDrug.brandName ?? ''}
                            onChange={(e) => setEditDrug({ ...editDrug, brandName: e.target.value })} />
                        </td>
                        <td className="px-4 py-2">
                          <input className="border rounded px-2 py-1 text-xs w-20" value={editDrug.strength ?? ''}
                            onChange={(e) => setEditDrug({ ...editDrug, strength: e.target.value })} />
                        </td>
                        <td className="px-4 py-2">
                          <select className="border rounded px-2 py-1 text-xs" value={editDrug.dosageForm ?? 'OTHER'}
                            onChange={(e) => setEditDrug({ ...editDrug, dosageForm: e.target.value })}>
                            {['TABLET', 'CAPSULE', 'SYRUP', 'INJECTION', 'CREAM', 'DROPS', 'OTHER'].map((f) => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-2">
                          <select className="border rounded px-2 py-1 text-xs" value={editDrug.category ?? 'OTHER'}
                            onChange={(e) => setEditDrug({ ...editDrug, category: e.target.value })}>
                            {['ANTIBIOTIC', 'ANALGESIC', 'ANTIMALARIA', 'ANTIHISTAMINE', 'ANTIFUNGAL', 'OTHER'].map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-2">
                          <select className="border rounded px-2 py-1 text-xs" value={editDrug.scheduleClass ?? 'OTC'}
                            onChange={(e) => setEditDrug({ ...editDrug, scheduleClass: e.target.value })} aria-label="OTC">
                            <option value="OTC">OTC</option>
                            {['II', 'III', 'IV', 'V'].map((s) => <option key={s} value={s}>Sch {s}</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-2">
                          <input className="border rounded px-2 py-1 text-xs w-40" value={editDrug.defaultInstructions ?? ''}
                            onChange={(e) => setEditDrug({ ...editDrug, defaultInstructions: e.target.value })} />
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex gap-1">
                            <button onClick={() => updateDrug.mutate(editDrug)} disabled={updateDrug.isPending}
                              className="text-green-600 hover:text-green-800" aria-label="Confirm"><Check className="w-4 h-4" /></button>
                            <button onClick={() => setEditDrug(null)} className="text-gray-400 hover:text-gray-600" aria-label="Close"><X className="w-4 h-4" /></button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2 font-medium">{drug.genericName}</td>
                        <td className="px-4 py-2 text-gray-600">{drug.brandName ?? '—'}</td>
                        <td className="px-4 py-2 text-gray-600">{drug.strength ?? '—'}</td>
                        <td className="px-4 py-2">
                          <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-xs">{drug.dosageForm ?? '—'}</span>
                        </td>
                        <td className="px-4 py-2 text-gray-600 text-xs">{drug.category ?? '—'}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${drug.scheduleClass === 'OTC' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}`}>
                            {drug.scheduleClass === 'OTC' ? 'OTC' : `Sch ${drug.scheduleClass}`}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-gray-500 text-xs max-w-xs truncate">{drug.defaultInstructions ?? '—'}</td>
                        <td className="px-4 py-2">
                          <div className="flex gap-1">
                            <button onClick={() => setEditDrug({ ...drug })} className="text-blue-500 hover:text-blue-700" aria-label="Edit">
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button onClick={() => deleteDrug.mutate(drug.id)} className="text-red-500 hover:text-red-700" aria-label="Delete">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {drugs.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No drugs in catalogue{drugSearch ? ` matching "${drugSearch}"` : '. Add drugs to get started.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Drug Interactions ── */}
      {tab === 'interactions' && (
        <div className="space-y-4">
          {/* Add form */}
          <div className="bg-white border rounded-lg p-4 space-y-3">
            <h3 className="font-semibold text-sm">Add Drug Interaction</h3>
            <div className="grid grid-cols-2 gap-3">
              <input className="border rounded px-3 py-1.5 text-sm" placeholder="Drug 1 name" value={intForm.drug1Name} onChange={(e) => setIntForm({ ...intForm, drug1Name: e.target.value })} />
              <input className="border rounded px-3 py-1.5 text-sm" placeholder="Drug 2 name" value={intForm.drug2Name} onChange={(e) => setIntForm({ ...intForm, drug2Name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <select className="border rounded px-3 py-1.5 text-sm" value={intForm.severity} onChange={(e) => setIntForm({ ...intForm, severity: e.target.value })} aria-label="Mild">
                <option value="MILD">Mild</option>
                <option value="MODERATE">Moderate</option>
                <option value="SEVERE">Severe</option>
                <option value="CONTRAINDICATED">Contraindicated</option>
              </select>
              <input className="border rounded px-3 py-1.5 text-sm" placeholder="Description / clinical note" value={intForm.description} onChange={(e) => setIntForm({ ...intForm, description: e.target.value })} />
            </div>
            <button
              onClick={() => createInt.mutate({ ...intForm, businessId })}
              disabled={!intForm.drug1Name || !intForm.drug2Name || !intForm.description || createInt.isPending}
              className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50"
            >
              <Plus className="w-4 h-4 inline mr-1" />Add Interaction
            </button>
          </div>

          {/* Table */}
          <div className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-4 py-2">Drug 1</th>
                  <th className="text-left px-4 py-2">Drug 2</th>
                  <th className="text-left px-4 py-2">Severity</th>
                  <th className="text-left px-4 py-2">Description</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {interactions.map((it: any) => (
                  <tr key={it.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium">{it.drug1Name}</td>
                    <td className="px-4 py-2 font-medium">{it.drug2Name}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${SEV_COLOR[it.severity] ?? ''}`}>{it.severity}</span>
                    </td>
                    <td className="px-4 py-2 text-gray-600 max-w-xs truncate">{it.description}</td>
                    <td className="px-4 py-2">
                      <button onClick={() => deleteInt.mutate(it.id)} className="text-red-500 hover:text-red-700" aria-label="Delete">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {interactions.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No interactions recorded</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Refill Queue ── */}
      {tab === 'refill-queue' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">Prescriptions with remaining refills that are due or overdue today.</p>
          <div className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-4 py-2">Rx #</th>
                  <th className="text-left px-4 py-2">Patient</th>
                  <th className="text-left px-4 py-2">Doctor</th>
                  <th className="text-left px-4 py-2">Refills Left</th>
                  <th className="text-left px-4 py-2">Next Fill Due</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {refillQueue.map((rx: any) => (
                  <tr key={rx.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-xs">{rx.prescriptionNumber}</td>
                    <td className="px-4 py-2 font-medium">{rx.patientName}</td>
                    <td className="px-4 py-2 text-gray-600">{rx.doctorName}</td>
                    <td className="px-4 py-2">
                      <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs">
                        {Math.max(0, rx.refillsAllowed + 1 - rx.refillsUsed)} remaining
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {rx.nextFillDate ? new Date(rx.nextFillDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => setRefilling(rx)}
                        className="bg-green-600 text-white px-3 py-1 rounded text-xs font-medium"
                      >
                        <RefreshCw className="w-3 h-3 inline mr-1" />Process Refill
                      </button>
                    </td>
                  </tr>
                ))}
                {refillQueue.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No refills due</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Controlled Substance Log ── */}
      {tab === 'controlled-log' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <input type="date" className="border rounded px-3 py-1.5 text-sm" value={logStart} onChange={(e) => setLogStart(e.target.value)} placeholder="From" aria-label="Date" />
            <input type="date" className="border rounded px-3 py-1.5 text-sm" value={logEnd} onChange={(e) => setLogEnd(e.target.value)} placeholder="To" aria-label="Start date" />
            <button onClick={() => void refetchLog()} className="bg-gray-100 px-3 py-1.5 rounded text-sm">Filter</button>
            <button onClick={() => setShowLogForm(true)} className="ml-auto bg-blue-600 text-white px-4 py-1.5 rounded text-sm font-medium">
              <Plus className="w-4 h-4 inline mr-1" />Log Dispensing
            </button>
          </div>

          {showLogForm && (
            <div className="bg-white border rounded-lg p-4 space-y-3">
              <h3 className="font-semibold text-sm">Log Controlled Substance Dispensing</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input className="border rounded px-3 py-1.5 text-sm" placeholder="Drug / item name" value={logForm.itemName} onChange={(e) => setLogForm({ ...logForm, itemName: e.target.value })} />
                <select className="border rounded px-3 py-1.5 text-sm" value={logForm.scheduleClass} onChange={(e) => setLogForm({ ...logForm, scheduleClass: e.target.value })} aria-label="Schedule {s}">
                  {['II', 'III', 'IV', 'V'].map((s) => <option key={s} value={s}>Schedule {s}</option>)}
                </select>
                <div className="flex gap-2">
                  <input className="border rounded px-3 py-1.5 text-sm w-24" type="number" placeholder="Qty" value={logForm.quantityDispensed} onChange={(e) => setLogForm({ ...logForm, quantityDispensed: e.target.value })} />
                  <input className="border rounded px-3 py-1.5 text-sm flex-1" placeholder="Unit (tablets, ml...)" value={logForm.unit} onChange={(e) => setLogForm({ ...logForm, unit: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input className="border rounded px-3 py-1.5 text-sm" placeholder="Patient name" value={logForm.patientName} onChange={(e) => setLogForm({ ...logForm, patientName: e.target.value })} />
                <input className="border rounded px-3 py-1.5 text-sm" placeholder="Patient ID / National ID" value={logForm.patientIdNumber} onChange={(e) => setLogForm({ ...logForm, patientIdNumber: e.target.value })} />
                <input className="border rounded px-3 py-1.5 text-sm" placeholder="Dispensed by" value={logForm.dispensedBy} onChange={(e) => setLogForm({ ...logForm, dispensedBy: e.target.value })} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input className="border rounded px-3 py-1.5 text-sm" placeholder="Prescriber name" value={logForm.prescriberName} onChange={(e) => setLogForm({ ...logForm, prescriberName: e.target.value })} />
                <input className="border rounded px-3 py-1.5 text-sm" placeholder="Prescriber license #" value={logForm.prescriberLicense} onChange={(e) => setLogForm({ ...logForm, prescriberLicense: e.target.value })} />
                <input className="border rounded px-3 py-1.5 text-sm" placeholder="Notes (optional)" value={logForm.notes} onChange={(e) => setLogForm({ ...logForm, notes: e.target.value })} />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => addLog.mutate({ ...logForm, quantityDispensed: parseFloat(logForm.quantityDispensed) || 0 })}
                  disabled={!logForm.itemName || !logForm.patientName || !logForm.prescriberName || addLog.isPending}
                  className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50"
                >
                  Save Entry
                </button>
                <button onClick={() => setShowLogForm(false)} className="px-4 py-1.5 rounded text-sm border">Cancel</button>
              </div>
            </div>
          )}

          <div className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-4 py-2">Date/Time</th>
                  <th className="text-left px-4 py-2">Drug</th>
                  <th className="text-left px-4 py-2">Schedule</th>
                  <th className="text-left px-4 py-2">Qty</th>
                  <th className="text-left px-4 py-2">Patient</th>
                  <th className="text-left px-4 py-2">Prescriber</th>
                  <th className="text-left px-4 py-2">Dispensed By</th>
                </tr>
              </thead>
              <tbody>
                {controlledLog.map((entry: any) => (
                  <tr key={entry.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-600 text-xs">{new Date(entry.dispensedAt).toLocaleString()}</td>
                    <td className="px-4 py-2 font-medium">{entry.itemName}</td>
                    <td className="px-4 py-2"><span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full text-xs">Schedule {entry.scheduleClass}</span></td>
                    <td className="px-4 py-2">{entry.quantityDispensed} {entry.unit}</td>
                    <td className="px-4 py-2">{entry.patientName}{entry.patientIdNumber ? <span className="text-gray-400 ml-1 text-xs">({entry.patientIdNumber})</span> : ''}</td>
                    <td className="px-4 py-2 text-gray-600">{entry.prescriberName}</td>
                    <td className="px-4 py-2 text-gray-600">{entry.dispensedBy}</td>
                  </tr>
                ))}
                {controlledLog.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No entries found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Insurance Providers ── */}
      {tab === 'providers' && (
        <div className="space-y-4">
          <div className="bg-white border rounded-lg p-4 space-y-3">
            <h3 className="font-semibold text-sm">Add Insurance Provider</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <input className="border rounded px-3 py-1.5 text-sm" placeholder="Provider name" value={provForm.name} onChange={(e) => setProvForm({ ...provForm, name: e.target.value })} />
              <input className="border rounded px-3 py-1.5 text-sm" placeholder="Code (e.g. NHIF)" value={provForm.code} onChange={(e) => setProvForm({ ...provForm, code: e.target.value })} />
              <input className="border rounded px-3 py-1.5 text-sm" placeholder="Contact phone" value={provForm.contactPhone} onChange={(e) => setProvForm({ ...provForm, contactPhone: e.target.value })} />
              <input className="border rounded px-3 py-1.5 text-sm" placeholder="Contact email" value={provForm.contactEmail} onChange={(e) => setProvForm({ ...provForm, contactEmail: e.target.value })} />
            </div>
            <button
              onClick={() => createProv.mutate(provForm)}
              disabled={!provForm.name || !provForm.code || createProv.isPending}
              className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50"
            >
              <Plus className="w-4 h-4 inline mr-1" />Add Provider
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {providers.map((p: any) => (
              <div key={p.id} className={`bg-white border rounded-lg p-4 ${!p.isActive ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-xs text-gray-500 font-mono">{p.code}</p>
                    {p.contactPhone && <p className="text-sm text-gray-600 mt-1">{p.contactPhone}</p>}
                    {p.contactEmail && <p className="text-sm text-gray-500">{p.contactEmail}</p>}
                  </div>
                  <button
                    onClick={() => toggleProv.mutate({ id: p.id, isActive: !p.isActive })}
                    className={`text-xs px-2 py-1 rounded-full font-medium ${p.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                  >
                    {p.isActive ? 'Active' : 'Inactive'}
                  </button>
                </div>
              </div>
            ))}
            {providers.length === 0 && <p className="text-gray-400 text-sm col-span-3 text-center py-8">No providers added</p>}
          </div>
        </div>
      )}

      {/* ── Insurance Claims ── */}
      {tab === 'claims' && (
        <div className="space-y-4">
          {claimStats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Submitted', data: claimStats.submitted, color: 'blue', amt: claimStats.submitted._sum?.billedCents },
                { label: 'Approved', data: claimStats.approved, color: 'green', amt: claimStats.approved._sum?.approvedCents },
                { label: 'Paid', data: claimStats.paid, color: 'emerald', amt: claimStats.paid._sum?.paidCents },
                { label: 'Rejected', data: claimStats.rejected, color: 'red', amt: claimStats.rejected._sum?.billedCents },
              ].map(({ label, data, amt }) => (
                <div key={label} className="bg-white border rounded-lg p-4">
                  <p className="text-sm text-gray-500">{label}</p>
                  <p className="text-2xl font-bold">{data._count}</p>
                  <p className="text-sm text-gray-600">{formatKES(amt ?? 0)}</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 items-center">
            <select className="border rounded px-3 py-1.5 text-sm" value={claimStatus} onChange={(e) => setClaimStatus(e.target.value)} aria-label="Filter by statuses">
              <option value="">All Statuses</option>
              {['SUBMITTED', 'APPROVED', 'PAID', 'REJECTED'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-4 py-2">Claim #</th>
                  <th className="text-left px-4 py-2">Provider</th>
                  <th className="text-left px-4 py-2">Patient ID</th>
                  <th className="text-left px-4 py-2">Billed</th>
                  <th className="text-left px-4 py-2">Approved</th>
                  <th className="text-left px-4 py-2">Paid</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((claim: any) => (
                  <tr key={claim.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-xs">{claim.claimNumber ?? '—'}</td>
                    <td className="px-4 py-2">{claim.provider?.name}</td>
                    <td className="px-4 py-2 text-gray-600">{claim.patientInsuranceId ?? '—'}</td>
                    <td className="px-4 py-2">{formatKES(claim.billedCents)}</td>
                    <td className="px-4 py-2">{claim.approvedCents ? formatKES(claim.approvedCents) : '—'}</td>
                    <td className="px-4 py-2">{claim.paidCents ? formatKES(claim.paidCents) : '—'}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${CLAIM_COLOR[claim.status] ?? ''}`}>{claim.status}</span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1">
                        {claim.status === 'SUBMITTED' && (
                          <button
                            onClick={() => updateClaim.mutate({ id: claim.id, status: 'APPROVED', approvedCents: claim.billedCents })}
                            className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-xs"
                          >
                            Approve
                          </button>
                        )}
                        {claim.status === 'APPROVED' && (
                          <button
                            onClick={() => updateClaim.mutate({ id: claim.id, status: 'PAID', paidCents: claim.approvedCents, paidAt: new Date() })}
                            className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs"
                          >
                            Mark Paid
                          </button>
                        )}
                        {(claim.status === 'SUBMITTED' || claim.status === 'APPROVED') && (
                          <button
                            onClick={async () => {
                              const reason = await prompt({ title: 'Reject Claim', message: 'Provide a reason for rejection.', placeholder: 'Enter reason...', confirmLabel: 'Reject' });
                              if (reason) updateClaim.mutate({ id: claim.id, status: 'REJECTED', rejectionReason: reason });
                            }}
                            className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs"
                          >
                            Reject
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {claims.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No claims found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Drug Labels Tab ── */}
      {tab === 'labels' && (
        <DrugLabelsTab drugs={drugs} businessName={user?.businessId ?? 'Pharmacy'} />
      )}

      {/* ── Formulary Tab ── */}
      {tab === 'formulary' && (
        <FormularyTab businessId={businessId} />
      )}
      {refilling && <DispenseModal rx={refilling} mode="refill" onClose={() => setRefilling(null)} />}
    </div>
  );
}

// ─── Drug Labels Tab ──────────────────────────────────────────────────────────

function DrugLabelsTab({ drugs, businessName }: { drugs: any[]; businessName: string }) {
  const [selected, setSelected] = useState<any | null>(null);
  const [copies, setCopies] = useState(1);
  const [customPatient, setCustomPatient] = useState('');
  const [customDose, setCustomDose] = useState('');
  const [customQty, setCustomQty] = useState('');
  const [search, setSearch] = useState('');

  const filtered = drugs.filter((d) =>
    d.genericName?.toLowerCase().includes(search.toLowerCase()) ||
    d.brandName?.toLowerCase().includes(search.toLowerCase()),
  );

  const handlePrint = () => {
    if (!selected) return;
    const labelName = [
      selected.brandName ?? selected.genericName,
      selected.strength,
      selected.dosageForm,
    ].filter(Boolean).join(' ');

    // Print the barcode/item label
    void printBarcodeLabel({
      itemName: labelName,
      barcode: selected.barcode ?? selected.id.slice(0, 12).toUpperCase(),
      priceCents: selected.sellingPriceCents ?? 0,
      businessName,
      sku: selected.sku ?? selected.scheduleClass,
    });

    // Also open a dispensing label popup
    const html = buildDispensingLabelHTML({
      drugName: labelName,
      patient: customPatient,
      dose: customDose || selected.defaultInstructions || '',
      qty: customQty,
      businessName,
      dispensedDate: new Date().toLocaleDateString('en-KE'),
      scheduleClass: selected.scheduleClass,
    });
    printHtml(html, 400);
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-white rounded-xl border p-5 space-y-4">
        <h3 className="font-semibold text-gray-800">Print Drug / Dispensing Label</h3>
        <input
          type="text" placeholder="Search drug..."
          value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm"
        />
        <div className="max-h-48 overflow-y-auto border rounded-lg divide-y">
          {filtered.slice(0, 30).map((d) => (
            <button
              key={d.id}
              onClick={() => setSelected(d)}
              className={`w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 transition-colors ${
                selected?.id === d.id ? 'bg-blue-50 font-semibold text-blue-700' : 'text-gray-800'
              }`}
            >
              <span className="font-medium">{d.brandName ?? d.genericName}</span>
              {d.strength && <span className="ml-2 text-gray-500">{d.strength}</span>}
              {d.dosageForm && <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{d.dosageForm}</span>}
              {d.scheduleClass && d.scheduleClass !== 'OTC' && (
                <span className="ml-2 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">{d.scheduleClass}</span>
              )}
            </button>
          ))}
          {filtered.length === 0 && <p className="px-4 py-6 text-center text-gray-400 text-sm">No drugs found</p>}
        </div>

        {selected && (
          <div className="border rounded-xl p-4 bg-gray-50 space-y-3">
            <p className="font-semibold text-gray-800">
              {selected.brandName ?? selected.genericName} {selected.strength}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Patient Name</label>
                <input
                  type="text" value={customPatient}
                  onChange={(e) => setCustomPatient(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Qty Dispensed</label>
                <input
                  type="text" value={customQty}
                  onChange={(e) => setCustomQty(e.target.value)}
                  placeholder="e.g. 30 tablets"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Dosage Instructions</label>
                <input
                  type="text" value={customDose}
                  onChange={(e) => setCustomDose(e.target.value)}
                  placeholder={selected.defaultInstructions || 'e.g. Take 1 tablet twice daily after meals'}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Copies</label>
                <input
                  type="number" min={1} max={10} value={copies}
                  onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-24 border rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700"
            >
              <Tag className="w-4 h-4" /> Print Label
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function buildDispensingLabelHTML(opts: {
  drugName: string; patient: string; dose: string; qty: string;
  businessName: string; dispensedDate: string; scheduleClass?: string;
}): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Drug Label</title>
<style>
  @media print { @page { margin:0; size:100mm 50mm; } body { margin:0; } }
  body { font-family: Arial, sans-serif; font-size: 9pt; width:100mm; padding:3mm; box-sizing:border-box; }
  .header { display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #000; padding-bottom:2mm; margin-bottom:2mm; }
  .biz { font-weight:bold; font-size:10pt; }
  .date { font-size:7pt; color:#555; }
  .drug { font-weight:bold; font-size:11pt; margin-bottom:1mm; }
  .row { display:flex; justify-content:space-between; font-size:8pt; margin-bottom:0.5mm; }
  .schedule { display:inline-block; background:#fee2e2; color:#991b1b; font-size:7pt; font-weight:bold; padding:1px 4px; border-radius:3px; }
  .dose { font-size:8pt; color:#1245B5; font-style:italic; margin-top:1mm; }
</style></head><body>
<div class="header"><span class="biz">${opts.businessName}</span><span class="date">${opts.dispensedDate}</span></div>
<div class="drug">${opts.drugName}${opts.scheduleClass && opts.scheduleClass !== 'OTC' ? ` <span class="schedule">${opts.scheduleClass}</span>` : ''}</div>
${opts.patient ? `<div class="row"><span>Patient:</span><span><b>${opts.patient}</b></span></div>` : ''}
${opts.qty ? `<div class="row"><span>Qty:</span><span>${opts.qty}</span></div>` : ''}
${opts.dose ? `<div class="dose">Sig: ${opts.dose}</div>` : ''}
</body></html>`;
}

// ─── Formulary Tab ────────────────────────────────────────────────────────────

function FormularyTab({ businessId }: { businessId: string }) {
  const qc = useQueryClient();
  const { confirm } = useDialog();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    genericName: '', brandName: '', strength: '', dosageForm: 'TABLET',
    category: 'OTHER', scheduleClass: 'OTC', maxDailyDose: '', unit: 'mg',
    contraindicationsText: '', notes: '',
  });

  const { data: entries = [], isLoading } = useQuery<any[]>({
    queryKey: ['formulary', businessId, search],
    queryFn: () => api.get(`/pharmacy/formulary?businessId=${businessId}${search ? `&search=${encodeURIComponent(search)}` : ''}`),
    enabled: !!businessId,
  });

  const create = useMutation({
    mutationFn: () => api.post('/pharmacy/formulary', { ...form, businessId, maxDailyDose: form.maxDailyDose ? parseFloat(form.maxDailyDose) : undefined }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['formulary'] }); setShowForm(false); setForm({ genericName: '', brandName: '', strength: '', dosageForm: 'TABLET', category: 'OTHER', scheduleClass: 'OTC', maxDailyDose: '', unit: 'mg', contraindicationsText: '', notes: '' }); },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/pharmacy/formulary/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['formulary'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <input
          type="text" placeholder="Search formulary..."
          value={search} onChange={(e) => setSearch(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm w-full sm:w-64"
        />
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" /> Add Entry
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border p-5 space-y-4">
          <h3 className="font-semibold text-gray-800">New Formulary Entry</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Generic Name *</label>
              <input value={form.genericName} onChange={(e) => setForm((f) => ({ ...f, genericName: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. Amoxicillin" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Brand Name</label>
              <input value={form.brandName} onChange={(e) => setForm((f) => ({ ...f, brandName: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. Amoxil" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Strength</label>
              <input value={form.strength} onChange={(e) => setForm((f) => ({ ...f, strength: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. 500mg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Dosage Form</label>
              <select value={form.dosageForm} onChange={(e) => setForm((f) => ({ ...f, dosageForm: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm">
                {['TABLET','CAPSULE','SYRUP','INJECTION','CREAM','DROPS','INHALER','SUPPOSITORY','PATCH','OTHER'].map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Schedule Class</label>
              <select value={form.scheduleClass} onChange={(e) => setForm((f) => ({ ...f, scheduleClass: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm">
                {['OTC','S1','S2','S3','S4','S5','S6','S7','S8'].map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Max Daily Dose</label>
              <div className="flex gap-1">
                <input type="number" min={0} value={form.maxDailyDose}
                  onChange={(e) => setForm((f) => ({ ...f, maxDailyDose: e.target.value }))}
                  className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="e.g. 3000" />
                <input value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                  className="w-16 border rounded-lg px-2 py-2 text-sm" placeholder="mg" />
              </div>
            </div>
            <div className="col-span-2 md:col-span-3">
              <label className="block text-xs font-medium text-gray-600 mb-1">Contraindications</label>
              <textarea value={form.contraindicationsText}
                onChange={(e) => setForm((f) => ({ ...f, contraindicationsText: e.target.value }))}
                rows={2} placeholder="e.g. Penicillin allergy, renal impairment"
                className="w-full border rounded-lg px-3 py-2 text-sm resize-none" />
            </div>
            <div className="col-span-2 md:col-span-3">
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
              <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Optional clinical notes" />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => create.mutate()}
              disabled={!form.genericName || create.isPending}
              className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-40 flex items-center gap-2"
            >
              {create.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Save
            </button>
            <button onClick={() => setShowForm(false)} className="px-5 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-12"><RefreshCw className="w-6 h-6 animate-spin text-blue-500" /></div>
        ) : entries.length === 0 ? (
          <div className="text-center py-12">
            <List className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500">No formulary entries yet</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Generic Name</th>
                <th className="px-4 py-3 text-left hidden sm:table-cell">Brand</th>
                <th className="px-4 py-3 text-left">Strength / Form</th>
                <th className="px-4 py-3 text-center">Schedule</th>
                <th className="px-4 py-3 text-left hidden md:table-cell">Max Daily Dose</th>
                <th className="px-4 py-3 text-left hidden lg:table-cell">Contraindications</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {entries.map((e: any) => (
                <tr key={e.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">{e.genericName}</td>
                  <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{e.brandName ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{[e.strength, e.dosageForm].filter(Boolean).join(' · ')}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      e.scheduleClass === 'OTC' ? 'bg-green-100 text-green-700'
                      : ['S4','S5','S6','S7','S8'].includes(e.scheduleClass) ? 'bg-red-100 text-red-700'
                      : 'bg-amber-100 text-amber-700'
                    }`}>{e.scheduleClass}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden md:table-cell">
                    {e.maxDailyDose ? `${e.maxDailyDose} ${e.unit ?? 'mg'}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs hidden lg:table-cell max-w-xs truncate">
                    {e.contraindicationsText ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={async () => { const ok = await confirm({ title: 'Remove from Formulary', message: 'Remove this item from the formulary?', variant: 'warning', confirmLabel: 'Remove' }); if (ok) remove.mutate(e.id); }}
                      className="text-red-400 hover:text-red-600" aria-label="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
