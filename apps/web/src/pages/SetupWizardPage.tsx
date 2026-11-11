import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  CheckCircle, ChevronRight, ChevronLeft, Store, Shield,
  ShoppingCart, ArrowRight, Zap, Package, Users, BarChart3, Sparkles,
  UtensilsCrossed, Pill, Scissors, Fuel, ShoppingBag, Coffee,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/auth';

const PLAN_INFO: Record<string, { label: string; color: string; desc: string }> = {
  FREE:       { label: 'Free',       color: 'bg-green-500',   desc: '1 store · 1 user · Basic POS' },
  STARTER:    { label: 'Starter',    color: 'bg-emerald-500', desc: '1 store · 8 users · Full compliance' },
  GROWTH:     { label: 'Growth',     color: 'bg-cyan-500',    desc: '2 stores · 15 users · Hospitality & delivery' },
  PRO:        { label: 'Pro',        color: 'bg-blue-600',    desc: '5 stores · 30 users · AI forecasting' },
  ENTERPRISE: { label: 'Enterprise', color: 'bg-purple-600',  desc: 'Unlimited · White-glove support' },
  LIFETIME:   { label: 'Lifetime',   color: 'bg-amber-500',   desc: 'One-time purchase · All features forever' },
};

// ─── Types ────────────────────────────────────────────────────

type PosMode = 'RETAIL' | 'HOSPITALITY' | 'FAST_FOOD' | 'SALON' | 'CLINIC' | 'SUPERMARKET' | 'FUEL_PUMP';
type TaxType = 'VAT' | 'TOT';
type TaxChoice = TaxType | 'NONE';

interface BizForm {
  name: string;
  taxChoice: TaxChoice;
  posMode: PosMode;
}

interface StoreForm {
  name: string;
  storeCode: string;
}

interface EtimsForm {
  bhfId: string;
  tin: string;
  cmcKey: string;
}

// ─── Step Indicator ──────────────────────────────────────────

function StepDot({ index, current, label }: { index: number; current: number; label: string }) {
  const done = index < current;
  const active = index === current;
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
          done
            ? 'bg-green-500 text-white'
            : active
            ? 'bg-blue-600 text-white ring-4 ring-blue-100'
            : 'bg-gray-200 text-gray-400'
        }`}
      >
        {done ? <CheckCircle className="w-4 h-4" /> : index + 1}
      </div>
      <span className={`text-xs font-medium hidden sm:block ${active ? 'text-blue-600' : done ? 'text-green-600' : 'text-gray-400'}`}>
        {label}
      </span>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────

const STEP_LABELS = ['Welcome', 'Business', 'Store', 'KRA eTIMS', 'Done'];

const POS_MODES: Array<{ value: PosMode; label: string; desc: string; icon: React.ElementType; modules: string[] }> = [
  { value: 'RETAIL',      label: 'Retail Shop',      desc: 'General merchandise, boutique, hardware',       icon: ShoppingBag,      modules: ['Point of Sale', 'Inventory', 'Customers', 'Layaway', 'Reports'] },
  { value: 'SUPERMARKET', label: 'Supermarket',      desc: 'High-volume grocery & self-checkout',           icon: ShoppingCart,     modules: ['Supermarket POS', 'Barcode scanning', 'Scale integration', 'Batch & expiry'] },
  { value: 'HOSPITALITY', label: 'Restaurant / Hotel', desc: 'Table service, KOT, bar tabs, rooms',         icon: UtensilsCrossed,  modules: ['Table management', 'Kitchen Display', 'Bar tabs', 'Hotel rooms', 'Reservations'] },
  { value: 'FAST_FOOD',   label: 'Fast Food / Counter', desc: 'Counter service, pay-first, quick KOT',      icon: Coffee,           modules: ['Counter POS', 'Kitchen Display', 'Kiosk mode', 'Quick KOT'] },
  { value: 'SALON',       label: 'Salon / Spa',      desc: 'Appointments, services, staff commissions',     icon: Scissors,         modules: ['Appointments', 'Service items', 'Staff commissions', 'Loyalty'] },
  { value: 'CLINIC',      label: 'Clinic / Pharmacy', desc: 'Prescriptions, insurance, controlled drugs',   icon: Pill,             modules: ['Prescriptions queue', 'Drug catalogue', 'Insurance claims', 'Controlled substances log'] },
  { value: 'FUEL_PUMP',   label: 'Fuel Station',     desc: 'Pump control, tanks, fleet accounts',           icon: Fuel,             modules: ['Pump control', 'Tank dip management', 'Fleet accounts', 'Shift meter readings'] },
];

export default function SetupWizardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const businessId = user?.businessId ?? '';

  const urlPlan = (new URLSearchParams(window.location.search).get('plan') ?? '').toUpperCase();
  const planInfo = PLAN_INFO[urlPlan];

  const [step, setStep] = useState(0);
  const [bizForm, setBizForm] = useState<BizForm>({ name: '', taxChoice: 'VAT', posMode: 'RETAIL' });
  const [storeForm, setStoreForm] = useState<StoreForm>({ name: '', storeCode: '' });
  const [etimsForm, setEtimsForm] = useState<EtimsForm>({ bhfId: '', tin: '', cmcKey: '' });
  const [etimsSkipped, setEtimsSkipped] = useState(false);

  // Pre-fill business name from existing settings
  const { data: existingSettings } = useQuery<{ name: string; taxType: TaxType; posMode: string }>({
    queryKey: ['setup-biz', businessId],
    queryFn: () => api.get(`/business/${businessId}/settings`),
    enabled: !!businessId,
  });

  // Fetch existing stores to avoid unique-constraint crash on re-run
  const { data: existingStores = [] } = useQuery<{ id: string; name: string; storeCode: string }[]>({
    queryKey: ['setup-stores', businessId],
    queryFn: () => api.get(`/business/${businessId}/stores`),
    enabled: !!businessId,
  });

  const [showNewStoreForm, setShowNewStoreForm] = useState(false);

  useEffect(() => {
    if (existingSettings?.name) {
      setBizForm((f) => ({
        ...f,
        name: existingSettings.name,
        taxChoice: existingSettings.taxType as TaxChoice,
        posMode: (existingSettings.posMode as PosMode) || 'RETAIL',
      }));
    }
  }, [existingSettings]);

  const saveBizMutation = useMutation({
    mutationFn: () => {
      const { taxChoice, ...rest } = bizForm;
      return api.patch(`/business/${businessId}/settings`, {
        ...rest,
        taxType: taxChoice === 'NONE' ? 'VAT' : taxChoice,
      });
    },
    onSuccess: () => setStep(2),
  });

  const createStoreMutation = useMutation({
    mutationFn: () => api.post(`/business/${businessId}/stores`, storeForm),
    onSuccess: () => setStep(3),
  });

  const saveEtimsMutation = useMutation({
    mutationFn: () => api.patch(`/business/${businessId}/etims-credentials`, etimsForm),
    onSuccess: () => setStep(4),
  });

  const next = () => setStep((s) => s + 1);
  const prev = () => setStep((s) => s - 1);

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-br from-blue-50 to-indigo-100 overflow-y-auto">
      <div className="min-h-full flex items-center justify-center p-3 sm:p-4 py-6 sm:py-8">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl">
        {/* Step Indicator */}
        {step > 0 && step < 4 && (
          <div className="bg-gray-50 border-b px-4 sm:px-8 py-3 sm:py-4">
            <div className="flex items-center justify-between">
              {STEP_LABELS.map((label, i) => (
                <div key={i} className="flex items-center">
                  <StepDot index={i} current={step} label={label} />
                  {i < STEP_LABELS.length - 1 && (
                    <div className={`h-0.5 w-8 sm:w-16 mx-1 ${i < step ? 'bg-green-400' : 'bg-gray-200'}`} />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="p-4 sm:p-6 md:p-8">
          {/* ── Step 0: Welcome ── */}
          {step === 0 && (
            <div className="text-center space-y-6">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-600 rounded-2xl shadow-lg mb-2">
                <ShoppingCart className="w-10 h-10 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Welcome to Faida POS</h1>
                {planInfo ? (
                  <div className={`inline-flex items-center gap-2 mt-3 px-4 py-2 rounded-full text-white text-sm font-semibold ${planInfo.color}`}>
                    <Sparkles className="w-4 h-4" />
                    {planInfo.label} Plan — 30-day free trial · {planInfo.desc}
                  </div>
                ) : (
                  <p className="text-gray-500 mt-2">
                    Let's get your business set up. This will take about 5 minutes.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 text-left">
                {[
                  { icon: Store, label: 'Business Profile', desc: 'Name, tax type & POS mode' },
                  { icon: Package, label: 'Store Setup', desc: 'Physical location details' },
                  { icon: Shield, label: 'KRA Compliance', desc: 'eTIMS credentials (optional)' },
                  { icon: Zap, label: 'Ready to Sell', desc: 'Start processing sales instantly' },
                ].map(({ icon: Icon, label, desc }) => (
                  <div key={label} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
                    <div className="p-1.5 bg-blue-100 rounded-lg">
                      <Icon className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-medium text-sm text-gray-800">{label}</p>
                      <p className="text-xs text-gray-500">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={next}
                className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold text-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
              >
                Get Started
                <ChevronRight className="w-5 h-5" />
              </button>

              <button
                onClick={() => navigate('/pos')}
                className="text-sm text-gray-400 hover:text-gray-600"
              >
                Skip setup — I'll configure later
              </button>
            </div>
          )}

          {/* ── Step 1: Business Profile ── */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Business Profile</h2>
                <p className="text-gray-500 text-sm mt-1">Tell us about your business</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Business Name *</label>
                  <input
                    type="text"
                    value={bizForm.name}
                    onChange={(e) => setBizForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Premier Café"
                    className="w-full border rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Tax Type</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {([
                      { value: 'VAT', label: 'VAT', sub: '16% — turnover > KES 5M' },
                      { value: 'TOT', label: 'TOT', sub: '3% — turnover < KES 5M' },
                      { value: 'NONE', label: 'Configure Later', sub: 'Set up in Settings anytime' },
                    ] as Array<{ value: TaxChoice; label: string; sub: string }>).map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setBizForm((f) => ({ ...f, taxChoice: opt.value }))}
                        className={`flex flex-col items-center justify-center py-3 px-2 rounded-xl border-2 text-center transition-colors ${
                          bizForm.taxChoice === opt.value
                            ? 'border-blue-600 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <span className={`text-sm font-semibold ${bizForm.taxChoice === opt.value ? 'text-blue-700' : 'text-gray-800'}`}>
                          {opt.label}
                        </span>
                        <span className="text-xs text-gray-400 mt-0.5 leading-tight">{opt.sub}</span>
                      </button>
                    ))}
                  </div>
                  {bizForm.taxChoice === 'NONE' && (
                    <p className="text-xs text-amber-600 mt-2 flex items-center gap-1.5">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                      Tax type will default to VAT until configured in Settings → General
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Business Type</label>
                  <div className="grid grid-cols-1 gap-2 max-h-48 sm:max-h-72 overflow-y-auto pr-1">
                    {POS_MODES.map((m) => {
                      const Icon = m.icon;
                      const selected = bizForm.posMode === m.value;
                      return (
                        <button
                          key={m.value}
                          onClick={() => setBizForm((f) => ({ ...f, posMode: m.value }))}
                          className={`flex items-start gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all ${
                            selected ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          <div className={`p-2 rounded-lg flex-shrink-0 ${selected ? 'bg-blue-100' : 'bg-gray-100'}`}>
                            <Icon className={`w-5 h-5 ${selected ? 'text-blue-600' : 'text-gray-500'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <p className={`text-sm font-semibold ${selected ? 'text-blue-700' : 'text-gray-800'}`}>{m.label}</p>
                              {selected && <CheckCircle className="w-4 h-4 text-blue-600 flex-shrink-0" />}
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">{m.desc}</p>
                            {selected && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {m.modules.map((mod) => (
                                  <span key={mod} className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{mod}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={prev} className="px-5 py-2.5 border rounded-lg text-gray-700 hover:bg-gray-50 flex items-center gap-1.5">
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button
                  onClick={() => saveBizMutation.mutate()}
                  disabled={!bizForm.name.trim() || saveBizMutation.isPending}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {saveBizMutation.isPending ? 'Saving…' : <>Save & Continue <ChevronRight className="w-4 h-4" /></>}
                </button>
              </div>
              {saveBizMutation.isError && (
                <p className="text-sm text-red-600">{(saveBizMutation.error as Error).message}</p>
              )}
            </div>
          )}

          {/* ── Step 2: Store Setup ── */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Store Setup</h2>
                <p className="text-gray-500 text-sm mt-1">Configure your physical store location</p>
              </div>

              {existingStores.length > 0 && !showNewStoreForm ? (
                /* ── Existing stores found: let user select one ── */
                <div className="space-y-4">
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                    Your business already has {existingStores.length === 1 ? 'a store' : `${existingStores.length} stores`} configured.
                    Select one to continue, or add a new store below.
                  </div>

                  <div className="space-y-2">
                    {existingStores.map((store) => (
                      <div
                        key={store.id}
                        className="flex items-center justify-between p-4 border-2 border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-gray-100 rounded-lg">
                            <Store className="w-5 h-5 text-gray-500" />
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900">{store.name}</p>
                            <p className="text-xs text-gray-400 font-mono">{store.storeCode}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => setStep(3)}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-1.5"
                        >
                          Use this store <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => setShowNewStoreForm(true)}
                    className="w-full py-2.5 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                  >
                    + Add a new store instead
                  </button>

                  <div className="flex gap-3 pt-2">
                    <button onClick={prev} className="px-5 py-2.5 border rounded-lg text-gray-700 hover:bg-gray-50 flex items-center gap-1.5">
                      <ChevronLeft className="w-4 h-4" /> Back
                    </button>
                  </div>
                </div>
              ) : (
                /* ── No stores yet (or user chose to add new) ── */
                <div className="space-y-4">
                  {existingStores.length > 0 && (
                    <button
                      onClick={() => setShowNewStoreForm(false)}
                      className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" /> Back to existing stores
                    </button>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Store Name *</label>
                    <input
                      type="text"
                      value={storeForm.name}
                      onChange={(e) => setStoreForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. Main Branch - Nairobi CBD"
                      className="w-full border rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Store Code *</label>
                    <input
                      type="text"
                      value={storeForm.storeCode}
                      onChange={(e) => setStoreForm((f) => ({ ...f, storeCode: e.target.value.toUpperCase() }))}
                      placeholder="e.g. NRB02"
                      maxLength={10}
                      className="w-full border rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                    />
                    <p className="text-xs text-gray-400 mt-1">Short code used for receipts and KRA eTIMS (max 10 chars)</p>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button onClick={prev} className="px-5 py-2.5 border rounded-lg text-gray-700 hover:bg-gray-50 flex items-center gap-1.5">
                      <ChevronLeft className="w-4 h-4" /> Back
                    </button>
                    <button
                      onClick={() => createStoreMutation.mutate()}
                      disabled={!storeForm.name.trim() || !storeForm.storeCode.trim() || createStoreMutation.isPending}
                      className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {createStoreMutation.isPending ? 'Creating…' : <>Create Store <ChevronRight className="w-4 h-4" /></>}
                    </button>
                  </div>
                  {createStoreMutation.isError && (
                    <p className="text-sm text-red-600">{(createStoreMutation.error as Error).message}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: KRA eTIMS ── */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="p-2.5 bg-green-100 rounded-xl">
                  <Shield className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">KRA eTIMS Integration</h2>
                  <p className="text-gray-500 text-sm mt-1">Connect to Kenya Revenue Authority for compliance</p>
                </div>
              </div>

              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                You can skip this step and configure eTIMS later in Settings → KRA eTIMS.
                eTIMS submission is required for all businesses with annual turnover &gt; KES 5M.
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Branch ID (BHF ID)</label>
                  <input
                    type="text"
                    value={etimsForm.bhfId}
                    onChange={(e) => setEtimsForm((f) => ({ ...f, bhfId: e.target.value }))}
                    placeholder="00"
                    className="w-full border rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">KRA PIN (TIN)</label>
                  <input
                    type="text"
                    value={etimsForm.tin}
                    onChange={(e) => setEtimsForm((f) => ({ ...f, tin: e.target.value }))}
                    placeholder="P000000000A"
                    className="w-full border rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">CMC Key</label>
                  <input
                    type="password"
                    value={etimsForm.cmcKey}
                    onChange={(e) => setEtimsForm((f) => ({ ...f, cmcKey: e.target.value }))}
                    placeholder="Your eTIMS CMC Key"
                    className="w-full border rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={prev} className="px-5 py-2.5 border rounded-lg text-gray-700 hover:bg-gray-50 flex items-center gap-1.5">
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button
                  onClick={() => { setEtimsSkipped(true); setStep(4); }}
                  className="px-5 py-2.5 border rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Skip for Now
                </button>
                <button
                  onClick={() => saveEtimsMutation.mutate()}
                  disabled={!etimsForm.bhfId || !etimsForm.tin || !etimsForm.cmcKey || saveEtimsMutation.isPending}
                  className="flex-1 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {saveEtimsMutation.isPending ? 'Saving…' : <>Save & Continue <ChevronRight className="w-4 h-4" /></>}
                </button>
              </div>
              {saveEtimsMutation.isError && (
                <p className="text-sm text-red-600">{(saveEtimsMutation.error as Error).message}</p>
              )}
            </div>
          )}

          {/* ── Step 4: Done ── */}
          {step === 4 && (() => {
            const modeInfo = POS_MODES.find((m) => m.value === bizForm.posMode);
            const ModeIcon = modeInfo?.icon ?? Store;

            const NEXT_STEPS: Record<string, Array<{ icon: React.ElementType; label: string; desc: string; to: string }>> = {
              RETAIL:      [{ icon: Package, label: 'Add Products', desc: 'Build your item catalogue', to: '/inventory' }, { icon: Users, label: 'Add Staff', desc: 'Invite your team', to: '/settings' }, { icon: BarChart3, label: 'View Reports', desc: 'Track performance', to: '/reports' }],
              SUPERMARKET: [{ icon: Package, label: 'Import Items', desc: 'Bulk CSV import your catalogue', to: '/inventory' }, { icon: Users, label: 'Add Staff', desc: 'Invite your team', to: '/settings' }, { icon: BarChart3, label: 'View Reports', desc: 'Track performance', to: '/reports' }],
              HOSPITALITY: [{ icon: UtensilsCrossed, label: 'Set Up Tables', desc: 'Configure your floor plan', to: '/hospitality' }, { icon: Package, label: 'Add Menu Items', desc: 'Build your menu', to: '/inventory' }, { icon: Users, label: 'Add Staff', desc: 'Invite your team', to: '/settings' }],
              FAST_FOOD:   [{ icon: Coffee, label: 'Open Counter POS', desc: 'Start taking orders', to: '/hospitality' }, { icon: Package, label: 'Add Menu Items', desc: 'Build your menu', to: '/inventory' }, { icon: Users, label: 'Add Staff', desc: 'Invite your team', to: '/settings' }],
              SALON:       [{ icon: Scissors, label: 'Add Services', desc: 'List your services & prices', to: '/inventory' }, { icon: Users, label: 'Add Therapists', desc: 'Add your staff members', to: '/settings' }, { icon: BarChart3, label: 'Set Up Appointments', desc: 'Ready for bookings', to: '/appointments' }],
              CLINIC:      [{ icon: Pill, label: 'Set Up Drug Catalogue', desc: 'Load your formulary', to: '/pharmacy' }, { icon: Package, label: 'Add Medicines', desc: 'Inventory for dispensing', to: '/inventory' }, { icon: Users, label: 'Add Staff', desc: 'Invite your team', to: '/settings' }],
              FUEL_PUMP:   [{ icon: Fuel, label: 'Add Fuel Grades', desc: 'Petrol, Diesel, Premium…', to: '/fuel-pump' }, { icon: Fuel, label: 'Set Up Pumps & Tanks', desc: 'Configure your forecourt', to: '/fuel-pump' }, { icon: Users, label: 'Add Staff', desc: 'Invite your team', to: '/settings' }],
            };

            const nextSteps = NEXT_STEPS[bizForm.posMode] ?? NEXT_STEPS.RETAIL;
            const primaryRoute = bizForm.posMode === 'HOSPITALITY' || bizForm.posMode === 'FAST_FOOD' ? '/hospitality'
              : bizForm.posMode === 'FUEL_PUMP' ? '/fuel-pump'
              : bizForm.posMode === 'CLINIC' ? '/prescriptions'
              : bizForm.posMode === 'SALON' ? '/appointments'
              : '/pos';

            return (
              <div className="text-center space-y-6">
                <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-2xl">
                  <CheckCircle className="w-12 h-12 text-green-600" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">You're all set!</h2>
                  <div className="flex items-center justify-center gap-2 mt-2">
                    <div className="p-1.5 bg-blue-100 rounded-lg">
                      <ModeIcon className="w-4 h-4 text-blue-600" />
                    </div>
                    <p className="text-gray-600 font-medium">{bizForm.name || 'Your business'} · {modeInfo?.label}</p>
                  </div>
                  {(etimsSkipped || bizForm.taxChoice === 'NONE') && (
                    <p className="text-sm text-amber-600 mt-2">
                      {etimsSkipped && 'Remember to configure KRA eTIMS in Settings. '}
                      {bizForm.taxChoice === 'NONE' && 'Set your tax type in Settings → General.'}
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-sm font-medium text-gray-700 mb-3">Recommended next steps for your {modeInfo?.label}:</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
                    {nextSteps.map(({ icon: Icon, label, desc, to }) => (
                      <button
                        key={label}
                        onClick={() => navigate(to)}
                        className="flex items-start gap-3 p-3 rounded-xl border-2 border-gray-100 hover:border-blue-200 hover:bg-blue-50 transition-colors text-left group"
                      >
                        <div className="p-2 bg-blue-100 rounded-lg group-hover:bg-blue-200 transition-colors">
                          <Icon className="w-4 h-4 text-blue-600" />
                        </div>
                        <div>
                          <p className="font-medium text-sm text-gray-800">{label}</p>
                          <p className="text-xs text-gray-500">{desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => navigate(primaryRoute)}
                  className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold text-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                >
                  {bizForm.posMode === 'FUEL_PUMP' ? 'Go to Fuel Station' : bizForm.posMode === 'CLINIC' ? 'Go to Prescriptions' : bizForm.posMode === 'SALON' ? 'Go to Appointments' : bizForm.posMode === 'HOSPITALITY' || bizForm.posMode === 'FAST_FOOD' ? 'Go to Hospitality' : 'Start Selling'}
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            );
          })()}
        </div>
      </div>
      </div>
    </div>
  );
}
