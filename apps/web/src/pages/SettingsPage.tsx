import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../lib/api';
import ReceiptPrinterSettings from '../components/ReceiptPrinterSettings';
import { useAuthStore } from '../stores/auth';
import {
  Save,
  Store,
  CreditCard,
  AlertCircle,
  CheckCircle,
  Users,
  Plus,
  Trash2,
  Edit2,
  Shield,
  Smartphone,
  X,
  Eye,
  EyeOff,
  MessageSquare,
  Star,
  Printer,
  RefreshCw,
  Key,
  Scale,
  HardDrive,
  Download,
  Upload,
  Copy,
  Lock,
  Clock,
  Bell,
  Mail,
  ToggleLeft,
  ToggleRight,
  Play,
  Zap,
  Globe,
  FileText,
  Activity,
  Filter,
  Fingerprint,
  Wallet, Puzzle, Headphones, MessageCircle, Settings as SettingsIcon,
} from 'lucide-react';
import { UserRole, OPTIONAL_MODULES, OPTIONAL_MODULE_LABELS, moduleIncludedByMode, parseEnabledModules, type OptionalModule } from '@pos/shared';
import { hasFeature } from '../lib/featureGates';
import { onlineStoreLink } from '../lib/storeLink';
import { inDesktopApp } from '../lib/desktopServer';
import SalesPipelineCard from '../components/SalesPipelineCard';
import HotelLeviesCard from '../components/HotelLeviesCard';
import { PageHeader, SideNav, Switch, Tabs } from '../components/ui';
import AppUpdateCard from '../components/AppUpdateCard';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface BusinessSettings {
  id: string;
  name: string;
  taxType: 'VAT' | 'TOT' | 'NONE';
  totRate?: number;
  serviceChargeRate: number;
  serviceChargeDefault: boolean;
  enableCashDrawer: boolean;
  enableBarcodeScanner: boolean;
  enablePoleDisplay: boolean;
  negativePolicyDefault: 'BLOCK' | 'WARN' | 'ALLOW';
  posMode: string;
  /** JSON list of optional modules, e.g. ["RESTAURANT"]. */
  enabledModules?: string;
  expiredItemPolicy: string;
  expenseApprovalThresholdCents: number;
  expiryAlertDays: number;
  subscriptionTier: string;
  subscriptionStatus: string;
  trialEndsAt?: string;
  planName?: string;
  hasEtimsCredentials: boolean;
  hasMpesaCredentials: boolean;
  hasAtCredentials: boolean;
  stores: Array<{ id: string; name: string; storeCode: string }>;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
  bankBranch?: string;
  shortCode?: string;
}

interface StaffUser {
  id: string;
  name: string;
  email: string | null;
  role: string;
  createdAt: string;
  assignedStores?: Array<{ storeId: string }>;
  deliveryRateCents?: number | null;
  deliveryCommissionPercent?: number | null;
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  MANAGER: 'Manager',
  ACCOUNTANT: 'Accountant',
  CASHIER: 'Cashier',
  WAITER: 'Waiter',
  KITCHEN: 'Kitchen Staff',
  DRIVER: 'Driver',
  SALES_AGENT: 'Sales Agent',
};

const ROLE_COLORS: Record<string, string> = {
  OWNER: 'bg-purple-100 text-purple-700',
  MANAGER: 'bg-blue-100 text-blue-700',
  ACCOUNTANT: 'bg-green-100 text-green-700',
  CASHIER: 'bg-yellow-100 text-yellow-700',
  WAITER: 'bg-orange-100 text-orange-700',
  KITCHEN: 'bg-gray-100 text-gray-700',
  DRIVER: 'bg-teal-100 text-teal-700',
  SALES_AGENT: 'bg-indigo-100 text-indigo-700',
};

// ─── Sub-components ────────────────────────────────────────────────────────────

function AddUserModal({
  businessId,
  onClose,
}: {
  businessId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    role: UserRole.CASHIER as string,
    pin: '',
    password: '',
    deliveryRate: '',
    deliveryCommission: '',
  });
  const [showPin, setShowPin] = useState(false);

  const mutation = useMutation({
    mutationFn: (data: typeof form) =>
      api.post(`/business/${businessId}/users`, {
        name: data.name,
        email: data.email || undefined,
        phone: data.phone || undefined,
        role: data.role,
        pin: data.pin || undefined,
        password: data.password || undefined,
        deliveryRateCents: data.deliveryRate ? Math.round(Number(data.deliveryRate) * 100) : undefined,
        deliveryCommissionPercent: data.deliveryCommission ? Number(data.deliveryCommission) : undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['business-users', businessId] });
      onClose();
    },
  });

  const needsPassword = ['OWNER', 'MANAGER', 'ACCOUNTANT', 'DRIVER', 'SALES_AGENT'].includes(form.role);
  // Drivers and agents sign in to their phones by PIN — a PIN login lasts 12 hours
  // against 15 minutes for email, which is what keeps them signed in out in the field.
  const needsPin = ['CASHIER', 'WAITER', 'KITCHEN', 'DRIVER', 'SALES_AGENT'].includes(form.role);
  const pinIsField = ['DRIVER', 'SALES_AGENT'].includes(form.role);
  const isDriver = form.role === 'DRIVER';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="text-lg font-semibold">Add Staff Member</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label htmlFor="f-full-name" className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
            <input id="f-full-name"
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Jane Wanjiku"
            />
          </div>

          <div>
            <label htmlFor="f-role" className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
            <select id="f-role"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
              <option value="MANAGER">Manager — Full store access</option>
              <option value="ACCOUNTANT">Accountant — Reports only</option>
              <option value="CASHIER">Cashier — POS + PIN login</option>
              <option value="WAITER">Waiter — Hospitality + PIN login</option>
              <option value="KITCHEN">Kitchen Staff — KDS only + PIN</option>
              <option value="DRIVER">Driver — Faida Driver app (email + password)</option>
              <option value="SALES_AGENT">Sales Agent — Faida Agent app (email + password)</option>
            </select>
            {['DRIVER', 'SALES_AGENT'].includes(form.role) && (
              <p className="mt-1.5 text-xs text-gray-500">
                {form.role === 'DRIVER'
                  ? 'Drivers sign in on the Faida Driver app and will appear in the driver picker for delivery runs.'
                  : 'Sales agents sign in on the Faida Agent app and can raise field orders on their route.'}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email {needsPassword ? '*' : '(optional)'}
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="staff@business.co.ke"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              WhatsApp / Phone Number <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="+254 7XX XXX XXX"
            />
            <p className="text-xs text-gray-400 mt-1">
              Waiters receive a WhatsApp alert when their KOT is ready from the kitchen
            </p>
          </div>

          {needsPin && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">PIN (4–6 digits)</label>
              <div className="relative">
                <input
                  type={showPin ? 'text' : 'password'}
                  value={form.pin}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setForm((f) => ({ ...f, pin: val }));
                  }}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 pr-10"
                  placeholder="e.g. 1234"
                  maxLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-3 top-2.5 text-gray-400"
                >
                  {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {pinIsField
                  ? 'Used to sign in on the mobile app — without a PIN this person cannot appear in the app’s staff list'
                  : 'Used for quick PIN login at the POS terminal'}
              </p>
            </div>
          )}

          {isDriver && (
            <div className="rounded-lg border border-gray-200 p-3 space-y-3">
              <p className="text-sm font-medium text-gray-700">Delivery pay</p>
              <p className="text-xs text-gray-400">
                What this driver earns — not the delivery fee charged to the customer.
                Leave both blank and their earnings screen will show zero.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="f-per-delivery-kes-2" className="block text-xs font-medium text-gray-600 mb-1">Per delivery (KES)</label>
                  <input id="f-per-delivery-kes-2"
                    type="number" min="0" step="10"
                    value={form.deliveryRate}
                    onChange={(e) => setForm((f) => ({ ...f, deliveryRate: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. 150"
                  />
                </div>
                <div>
                  <label htmlFor="f-of-delivery-fee-2" className="block text-xs font-medium text-gray-600 mb-1">% of delivery fee</label>
                  <input id="f-of-delivery-fee-2"
                    type="number" min="0" max="100"
                    value={form.deliveryCommission}
                    onChange={(e) => setForm((f) => ({ ...f, deliveryCommission: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="optional"
                  />
                </div>
              </div>
            </div>
          )}

          {needsPassword && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
              <div className="relative">
                <input
                  type={showPin ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 pr-10"
                  placeholder="Minimum 8 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-3 top-2.5 text-gray-400"
                >
                  {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {mutation.isError && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 p-3 rounded-lg">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {(mutation.error as Error)?.message ?? 'Failed to create user'}
            </div>
          )}
        </div>
        <div className="flex gap-3 p-5 border-t">
          <button
            onClick={onClose}
            className="flex-1 py-2 border rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate(form)}
            disabled={!form.name || mutation.isPending}
            className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Creating...' : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditUserModal({
  user,
  businessId,
  onClose,
}: {
  user: StaffUser;
  businessId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);

  // Driver pay was only settable when creating a user, so an existing driver could
  // never be given a rate — and their earnings screen stayed at zero with no way to
  // fix it from the UI. Prefilled from the current values so saving does not wipe them.
  const isDriver = user.role === 'DRIVER';
  const [deliveryRate, setDeliveryRate] = useState(
    user.deliveryRateCents ? String(user.deliveryRateCents / 100) : '',
  );
  const [deliveryCommission, setDeliveryCommission] = useState(
    user.deliveryCommissionPercent ? String(user.deliveryCommissionPercent) : '',
  );

  const mutation = useMutation({
    mutationFn: (data: {
      pin?: string;
      deliveryRateCents?: number;
      deliveryCommissionPercent?: number;
    }) => api.patch(`/business/${businessId}/users/${user.id}`, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['business-users', businessId] });
      onClose();
    },
  });

  function save() {
    const data: {
      pin?: string;
      deliveryRateCents?: number;
      deliveryCommissionPercent?: number;
    } = {};
    // A blank PIN means "leave it alone", not "clear it".
    if (pin.length >= 4) data.pin = pin;
    if (isDriver) {
      data.deliveryRateCents = deliveryRate ? Math.round(Number(deliveryRate) * 100) : 0;
      data.deliveryCommissionPercent = deliveryCommission ? Number(deliveryCommission) : 0;
    }
    mutation.mutate(data);
  }

  const nothingToSave = pin.length < 4 && !isDriver;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="text-lg font-semibold">
            {isDriver ? 'Edit' : 'Update PIN'} — {user.name}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New PIN (4–6 digits)</label>
            <div className="relative">
              <input
                type={showPin ? 'text' : 'password'}
                value={pin}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setPin(val);
                }}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 pr-10"
                placeholder="New PIN"
                maxLength={6}
              />
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                className="absolute right-3 top-2.5 text-gray-400"
              >
                {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {isDriver && <p className="text-xs text-gray-400 mt-1">Leave blank to keep the current PIN.</p>}
          </div>

          {isDriver && (
            <div className="rounded-lg border border-gray-200 p-3 space-y-3">
              <p className="text-sm font-medium text-gray-700">Delivery pay</p>
              <p className="text-xs text-gray-400">
                What this driver earns — not the delivery fee charged to the customer.
                Leave both blank and their earnings screen will show zero.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="f-per-delivery-kes" className="block text-xs font-medium text-gray-600 mb-1">Per delivery (KES)</label>
                  <input id="f-per-delivery-kes"
                    type="number" min="0" step="10"
                    value={deliveryRate}
                    onChange={(e) => setDeliveryRate(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. 150"
                  />
                </div>
                <div>
                  <label htmlFor="f-of-delivery-fee" className="block text-xs font-medium text-gray-600 mb-1">% of delivery fee</label>
                  <input id="f-of-delivery-fee"
                    type="number" min="0" max="100"
                    value={deliveryCommission}
                    onChange={(e) => setDeliveryCommission(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="optional"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-3 p-5 border-t">
          <button
            onClick={onClose}
            className="flex-1 py-2 border rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={nothingToSave || mutation.isPending}
            className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Saving...' : isDriver ? 'Save' : 'Update PIN'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const businessId = user?.businessId ?? '';
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);

  // ─── Post-payment verification ────────────────────────────────────────────
  const [verifyState, setVerifyState] = useState<'idle' | 'verifying' | 'success' | 'failed'>('idle');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    const tab = params.get('tab');
    if (ref && tab === 'subscription') {
      setVerifyState('verifying');
      api.get<{ active: boolean; plan?: string }>(`/subscription/verify/${ref}`)
        .then((res) => {
          setVerifyState(res.active ? 'success' : 'failed');
          if (res.active) {
            queryClient.invalidateQueries({ queryKey: ['subscription', businessId] });
            queryClient.invalidateQueries({ queryKey: ['business-settings', businessId] });
            window.history.replaceState({}, '', '/settings?tab=subscription');
          }
        })
        .catch(() => setVerifyState('failed'));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [activeTab, setActiveTab] = useState<
    'general' | 'users' | 'stores' | 'etims' | 'mpesa' | 'subscription' | 'messaging' | 'loyalty' | 'loyalty-tiers' | 'printers' | 'api-keys' | 'scale' | 'backup' | 'automation' | 'webhooks' | 'audit' | 'kdpa' | 'security'
  >(() => (new URLSearchParams(window.location.search).get('tab') as any) ?? 'general');

  // ─── General form state ────────────────────────────────────────────────────
  const [form, setForm] = useState({
    name: '',
    taxType: 'VAT' as 'VAT' | 'TOT' | 'NONE',
    totRate: 3,
    serviceChargeRate: 10,
    serviceChargeDefault: false,
    enableCashDrawer: false,
    enableBarcodeScanner: true,
    enablePoleDisplay: false,
    negativePolicyDefault: 'BLOCK' as 'BLOCK' | 'WARN' | 'ALLOW',
    expenseApprovalThresholdCents: 500000,
    posMode: 'RETAIL',
    enabledModules: [] as OptionalModule[],
    expiredItemPolicy: 'BLOCK',
    expiryAlertDays: 30,
    bankName: '',
    bankAccountNumber: '',
    bankAccountName: '',
    bankBranch: '',
    idleMessage: 'Welcome!',
    idleLogoUrl: '',
    tablePrefix: 'T',
    receiptHeader: '',
    receiptFooter: '',
    receiptFormatSale: 'THERMAL',
    receiptFormatInvoice: 'A4',
    receiptFormatDelivery: 'A4',
    receiptFormatEmail: 'A4',
  });

  // ─── Font size (localStorage, applied to html root) ──────────────────────
  const [fontSize, setFontSize] = useState<'sm' | 'md' | 'lg' | 'xl'>(() => {
    return (localStorage.getItem('pos-font-size') as 'sm' | 'md' | 'lg' | 'xl') || 'md';
  });
  function applyFontSize(size: 'sm' | 'md' | 'lg' | 'xl') {
    const map = { sm: '13px', md: '15px', lg: '17px', xl: '19px' };
    document.documentElement.style.fontSize = map[size];
    localStorage.setItem('pos-font-size', size);
    setFontSize(size);
  }

  // ─── Auto-logout after sale ───────────────────────────────────────────────
  const [autoLogoutAfterSale, setAutoLogoutAfterSale] = useState(
    () => localStorage.getItem('pos-auto-logout-sale') === 'true',
  );
  function toggleAutoLogoutAfterSale() {
    const next = !autoLogoutAfterSale;
    localStorage.setItem('pos-auto-logout-sale', String(next));
    setAutoLogoutAfterSale(next);
  }

  // ─── Multi-currency ────────────────────────────────────────────────────────
  const SUPPORTED_CURRENCIES = ['KES', 'USD', 'EUR', 'GBP', 'TZS', 'UGX', 'ETB', 'RWF', 'ZAR', 'AED', 'CNY', 'INR'];
  const [selectedCurrencies, setSelectedCurrencies] = useState<string[]>([]);
  const [currencySaved, setCurrencySaved] = useState(false);

  // ─── eTIMS credentials ─────────────────────────────────────────────────────
  const [etimsForm, setEtimsForm] = useState({ bhfId: '', tin: '', dvcSrno: '' });
  const [etimsSaved, setEtimsSaved] = useState(false);

  // ─── M-Pesa credentials ────────────────────────────────────────────────────
  const [mpesaForm, setMpesaForm] = useState({
    consumerKey: '',
    consumerSecret: '',
    shortcode: '',
    passkey: '',
    callbackUrl: '',
  });
  const [mpesaSaved, setMpesaSaved] = useState(false);

  // ─── Africa's Talking credentials ──────────────────────────────────────────
  const [atForm, setAtForm] = useState({ apiKey: '', username: '', senderId: '' });
  const [atSaved, setAtSaved] = useState(false);

  // ─── Loyalty program form ──────────────────────────────────────────────────
  const [loyaltyForm, setLoyaltyForm] = useState({
    name: 'Customer Loyalty',
    kesPerPoint: 100,
    pointValueCents: 50,
    minRedemption: 100,
  });
  const [loyaltySaved, setLoyaltySaved] = useState(false);

  // ─── Printers ──────────────────────────────────────────────────────────────
  const [showAddPrinter, setShowAddPrinter] = useState(false);
  const [printerForm, setPrinterForm] = useState({
    name: '',
    connectionType: 'USB',
    connectionDetails: '',
    isDefault: false,
    handles: ['RECEIPT'] as string[],
  });

  // ─── API Keys ──────────────────────────────────────────────────────────────
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(['sales:read', 'sales:write']);
  const [createdRawKey, setCreatedRawKey] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);

  // ─── Scale ─────────────────────────────────────────────────────────────────
  const [scaleForm, setScaleForm] = useState({
    protocol: 'METTLER_TOLEDO',
    port: 'COM1',
    baudRate: '9600',
    enabled: false,
  });
  const [scaleSaved, setScaleSaved] = useState(false);

  // ─── Audit Log ─────────────────────────────────────────────────────────────
  const [auditFilters, setAuditFilters] = useState({ startDate: '', endDate: '', entity: '', actor: '' });

  // ─── Webhooks ───────────────────────────────────────────────────────────────
  const [showAddWebhook, setShowAddWebhook] = useState(false);
  const [webhookForm, setWebhookForm] = useState({
    url: '',
    secret: '',
    description: '',
    events: [] as string[],
  });

  // ─── Security tab ──────────────────────────────────────────────────────────
  const [cpCurrent, setCpCurrent] = useState('');
  const [cpNew, setCpNew] = useState('');
  const [cpConfirm, setCpConfirm] = useState('');
  const [cpMsg, setCpMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ─── In-app confirm dialog (replaces window.confirm) ───────────────────────
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    variant: 'danger' | 'warning';
    confirmLabel: string;
    onConfirm: () => void;
  }>({ open: false, title: '', message: '', variant: 'danger', confirmLabel: 'Delete', onConfirm: () => {} });

  const [notification, setNotification] = useState<{
    message: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  const showConfirm = (
    title: string,
    message: string,
    onConfirm: () => void,
    variant: 'danger' | 'warning' = 'danger',
    confirmLabel = 'Delete',
  ) => setConfirmDialog({ open: true, title, message, variant, confirmLabel, onConfirm });

  const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  };

  // ─── Automation / Report Schedules ─────────────────────────────────────────
  const [showAddSchedule, setShowAddSchedule] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    reportType: 'SALES',
    frequency: 'DAILY',
    hour: 8,
    dayOfWeek: undefined as number | undefined,
    dayOfMonth: undefined as number | undefined,
    recipients: '',
  });

  // ─── User management ───────────────────────────────────────────────────────
  const [showAddUser, setShowAddUser] = useState(false);
  const [editingUser, setEditingUser] = useState<StaffUser | null>(null);
  const [storeAssignUser, setStoreAssignUser] = useState<StaffUser | null>(null);
  const [biometricUserId, setBiometricUserId] = useState<string | null>(null);
  const [biometricCreds, setBiometricCreds] = useState<Record<string, { id: string; deviceName: string; createdAt: string }[]>>({});
  const [biometricRegistering, setBiometricRegistering] = useState(false);
  const [newStore, setNewStore] = useState({ name: '', storeCode: '' });
  const [tierForm, setTierForm] = useState({ name: '', minPoints: '', multiplier: '1', color: 'gray' });
  const [showAddTier, setShowAddTier] = useState(false);
  const [paystackPublicKeyInput, setPaystackPublicKeyInput] = useState('');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelConfirmText, setCancelConfirmText] = useState('');
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [cancelDone, setCancelDone] = useState(false);
  const [upgradingTier, setUpgradingTier] = useState<string | null>(null);

  // ─── Queries ───────────────────────────────────────────────────────────────
  const { data: settings, isLoading } = useQuery<BusinessSettings>({
    queryKey: ['business-settings', businessId],
    queryFn: () => api.get(`/business/${businessId}/settings`),
    enabled: !!businessId,
  });

  const { data: users = [] } = useQuery<StaffUser[]>({
    queryKey: ['business-users', businessId],
    queryFn: () => api.get(`/business/${businessId}/users`),
    enabled: !!businessId && (activeTab === 'users' || activeTab === 'subscription'),
  });

  const { data: subscription } = useQuery<{
    subscriptionTier: string;
    subscriptionStatus: string;
    isTrialExpired?: boolean;
    daysRemaining?: number;
  }>({
    queryKey: ['subscription', businessId],
    queryFn: () => api.get(`/business/${businessId}/subscription`),
    enabled: !!businessId && activeTab === 'subscription',
  });

  const { data: loyaltyProgram } = useQuery<{
    id: string; name: string; kesPerPoint: number; pointValueCents: number; minRedemption: number;
  } | null>({
    queryKey: ['loyalty-program-settings', businessId],
    queryFn: () => (api.get(`/loyalty/program?businessId=${businessId}`) as Promise<{ id: string; name: string; kesPerPoint: number; pointValueCents: number; minRedemption: number } | null>).catch(() => null),
    enabled: !!businessId && activeTab === 'loyalty',
  });

  useEffect(() => {
    if (loyaltyProgram) {
      setLoyaltyForm({
        name: loyaltyProgram.name,
        kesPerPoint: loyaltyProgram.kesPerPoint,
        pointValueCents: loyaltyProgram.pointValueCents,
        minRedemption: loyaltyProgram.minRedemption,
      });
    }
  }, [loyaltyProgram]);

  const { data: loyaltyTiers = [], refetch: refetchTiers } = useQuery<Array<{
    id: string; name: string; minPoints: number; multiplier: number; color: string; perksJson?: string;
  }>>({
    queryKey: ['loyalty-tiers', businessId],
    queryFn: () => api.get(`/loyalty/tiers?businessId=${businessId}`),
    enabled: !!businessId && activeTab === 'loyalty-tiers',
  });

  const { data: kdpaRequests = [], refetch: refetchKdpa } = useQuery<Array<{
    id: string; requestedBy: string; customerId?: string; reason?: string;
    status: string; reviewNotes?: string; createdAt: string;
  }>>({
    queryKey: ['kdpa-requests', businessId],
    queryFn: () => api.get(`/kdpa/requests?businessId=${businessId}`),
    enabled: !!businessId && activeTab === 'kdpa',
  });

  const storeId = user?.storeId ?? '';
  const { data: printers = [], refetch: refetchPrinters } = useQuery<Array<{
    id: string; name: string; connectionType: string; connectionDetails: string;
    isDefault: boolean; handles: string;
  }>>({
    queryKey: ['printers', storeId],
    queryFn: () => api.get(`/printers?storeId=${storeId}`),
    enabled: !!storeId && activeTab === 'printers',
  });

  const { data: apiKeys = [], refetch: refetchApiKeys } = useQuery<Array<{
    id: string; name: string; scopes: string[]; ipWhitelist: string;
    isActive: boolean; createdAt: string; lastUsedAt?: string;
  }>>({
    queryKey: ['api-keys', businessId],
    queryFn: () => api.get(`/api-keys?businessId=${businessId}`),
    enabled: !!businessId && activeTab === 'api-keys',
  });

  const { data: etimsPendingSales } = useQuery<{ data: Array<{
    id: string; receiptNumber: string; totalCents: number; createdAt: string;
  }>; total: number }>({
    queryKey: ['etims-pending', businessId],
    queryFn: () => api.get(`/sales?businessId=${businessId}&etimsSubmitted=false&status=PAID&limit=20`),
    enabled: !!businessId && activeTab === 'etims',
  });

  const { data: reportSchedules = [], refetch: refetchSchedules } = useQuery<Array<{
    id: string;
    reportType: string;
    frequency: string;
    hour: number;
    dayOfWeek?: number;
    dayOfMonth?: number;
    recipients: string;
    isActive: boolean;
    lastSentAt?: string;
  }>>({
    queryKey: ['report-schedules', businessId],
    queryFn: () => api.get(`/report-schedules?businessId=${businessId}`),
    enabled: !!businessId && activeTab === 'automation',
  });

  const { data: webhooks = [], refetch: refetchWebhooks } = useQuery<Array<{
    id: string;
    url: string;
    secret?: string;
    events: string;
    isActive: boolean;
    description?: string;
    lastFiredAt?: string;
    failureCount: number;
  }>>({
    queryKey: ['webhooks', businessId],
    queryFn: () => api.get(`/webhooks?businessId=${businessId}`),
    enabled: !!businessId && activeTab === 'webhooks',
  });

  interface AuditEntry {
    id: string;
    actor: string;
    actorType: string;
    action: string;
    entity: string;
    entityId: string;
    before?: string;
    after?: string;
    source: string;
    hash: string;
    previousHash: string;
    createdAt: string;
  }

  const { data: auditLogs = [], refetch: refetchAudit, isFetching: auditLoading } = useQuery<AuditEntry[]>({
    queryKey: ['audit-logs', businessId, auditFilters],
    queryFn: () => {
      const params = new URLSearchParams({ businessId, limit: '200' });
      if (auditFilters.startDate) params.set('startDate', auditFilters.startDate);
      if (auditFilters.endDate) params.set('endDate', auditFilters.endDate);
      if (auditFilters.entity) params.set('entity', auditFilters.entity);
      if (auditFilters.actor) params.set('actor', auditFilters.actor);
      return api.get(`/audit?${params.toString()}`);
    },
    enabled: !!businessId && activeTab === 'audit',
  });

  const { data: auditIntegrity, refetch: verifyChain } = useQuery<{ valid: boolean; brokenAt: string | null; checkedEntries: number }>({
    queryKey: ['audit-verify', businessId],
    queryFn: () => api.get(`/audit/verify?businessId=${businessId}`),
    enabled: false,
  });

  // Sync form when settings load
  useEffect(() => {
    if (settings && !form.name && settings.name) {
      setForm({
        name: settings.name,
        taxType: (settings.taxType ?? 'VAT') as 'VAT' | 'TOT' | 'NONE',
        totRate: settings.totRate ?? 3,
        serviceChargeRate: settings.serviceChargeRate,
        serviceChargeDefault: settings.serviceChargeDefault ?? false,
        negativePolicyDefault: settings.negativePolicyDefault,
        expenseApprovalThresholdCents: settings.expenseApprovalThresholdCents,
        posMode: settings.posMode,
        enabledModules: parseEnabledModules(settings.enabledModules),
        expiredItemPolicy: settings.expiredItemPolicy,
        expiryAlertDays: settings.expiryAlertDays ?? 30,
        bankName: settings.bankName ?? '',
        bankAccountNumber: settings.bankAccountNumber ?? '',
        bankAccountName: settings.bankAccountName ?? '',
        bankBranch: settings.bankBranch ?? '',
        idleMessage: (settings as any).idleMessage ?? 'Welcome!',
        idleLogoUrl: (settings as any).idleLogoUrl ?? '',
        tablePrefix: (settings as any).tablePrefix ?? 'T',
        receiptHeader: (settings as any).receiptHeader ?? '',
        receiptFooter: (settings as any).receiptFooter ?? '',
        enableCashDrawer: (settings as any).enableCashDrawer ?? false,
        enableBarcodeScanner: (settings as any).enableBarcodeScanner ?? true,
        enablePoleDisplay: (settings as any).enablePoleDisplay ?? false,
        receiptFormatSale: (settings as any).receiptFormatSale ?? 'THERMAL',
        receiptFormatInvoice: (settings as any).receiptFormatInvoice ?? 'A4',
        receiptFormatDelivery: (settings as any).receiptFormatDelivery ?? 'A4',
        receiptFormatEmail: (settings as any).receiptFormatEmail ?? 'A4',
      });
      // Populate selected display currencies
      if ((settings as any).displayCurrencies) {
        try {
          setSelectedCurrencies(JSON.parse((settings as any).displayCurrencies) as string[]);
        } catch { /* malformed saved currency list: keep the defaults */ }
      }
    }
  }, [settings]);

  // ─── Mutations ─────────────────────────────────────────────────────────────
  const updateMutation = useMutation({
    mutationFn: (data: typeof form) =>
      api.patch(`/business/${businessId}/settings`, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['business-settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const saveCurrencyMutation = useMutation({
    mutationFn: () => api.patch(`/business/${businessId}/settings`, {
      displayCurrencies: JSON.stringify(selectedCurrencies),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['business-settings'] });
      void queryClient.invalidateQueries({ queryKey: ['business-settings-fx'] });
      void queryClient.invalidateQueries({ queryKey: ['exchange-rates'] });
      setCurrencySaved(true);
      setTimeout(() => setCurrencySaved(false), 3000);
    },
  });

  const refreshRatesMutation = useMutation({
    mutationFn: () =>
      api.post(`/business/${businessId}/exchange-rates/refresh`, { currencies: selectedCurrencies }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['exchange-rates'] });
      setCurrencySaved(true);
      setTimeout(() => setCurrencySaved(false), 3000);
    },
  });

  const createStoreMutation = useMutation({
    mutationFn: (dto: { name: string; storeCode: string }) =>
      api.post(`/business/${businessId}/stores`, dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['business-settings'] });
      setNewStore({ name: '', storeCode: '' });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: (userId: string) =>
      api.delete(`/business/${businessId}/users/${userId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['business-users'] });
    },
  });

  // ─── Biometric management ─────────────────────────────────────────────────
  async function loadBiometricCreds(userId: string) {
    try {
      const creds = await api.get<{ id: string; deviceName: string; createdAt: string }[]>(
        `/auth/webauthn/credentials?userId=${userId}`,
      );
      setBiometricCreds(prev => ({ ...prev, [userId]: creds }));
    } catch {
      setBiometricCreds(prev => ({ ...prev, [userId]: [] }));
    }
  }

  async function handleRegisterBiometric(u: { id: string; name: string }) {
    if (!('credentials' in navigator)) {
      toast.error('WebAuthn not supported in this browser');
      return;
    }
    setBiometricRegistering(true);
    try {
      const options = await api.get<{
        challenge: string;
        rp: { id: string; name: string };
        user: { id: string; name: string; displayName: string };
        pubKeyCredParams: { type: string; alg: number }[];
        timeout: number;
        attestation: AttestationConveyancePreference;
        authenticatorSelection: AuthenticatorSelectionCriteria;
      }>(`/auth/webauthn/register/begin?userId=${u.id}&businessId=${businessId}`);

      const toBytes = (b64url: string) =>
        Uint8Array.from(atob(b64url.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: toBytes(options.challenge),
          rp: options.rp,
          user: {
            id: toBytes(options.user.id),
            name: options.user.name ?? u.name,
            displayName: options.user.displayName ?? u.name,
          },
          pubKeyCredParams: options.pubKeyCredParams as PublicKeyCredentialParameters[],
          timeout: options.timeout,
          attestation: options.attestation,
          authenticatorSelection: options.authenticatorSelection,
        },
      }) as PublicKeyCredential | null;

      if (!credential) { setBiometricRegistering(false); return; }
      const response = credential.response as AuthenticatorAttestationResponse;
      const toBase64url = (buf: ArrayBuffer) =>
        btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

      let publicKeyDer = '';
      if (typeof response.getPublicKey === 'function') {
        const pk = response.getPublicKey();
        if (pk) publicKeyDer = toBase64url(pk);
      }

      const deviceName = navigator.userAgent.includes('Mac') ? 'Mac Touch ID'
        : navigator.userAgent.includes('Windows') ? 'Windows Hello'
        : navigator.userAgent.includes('Android') ? 'Android Fingerprint'
        : navigator.userAgent.includes('iPhone') || navigator.userAgent.includes('iPad') ? 'Face ID / Touch ID'
        : 'Biometric Device';

      await api.post('/auth/webauthn/register/complete', {
        userId: u.id,
        businessId,
        credentialId: credential.id,
        clientDataJSON: toBase64url(response.clientDataJSON),
        publicKeyDer,
        transports: typeof response.getTransports === 'function' ? response.getTransports() : [],
        deviceName,
      });

      toast.success(`Biometric registered for ${u.name}`);
      await loadBiometricCreds(u.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Registration failed';
      if (!msg.includes('cancelled') && !msg.includes('NotAllowedError')) {
        toast.error(`Biometric registration failed: ${msg}`);
      }
    } finally {
      setBiometricRegistering(false);
    }
  }

  async function handleDeleteBiometric(credId: string, userId: string) {
    try {
      await api.delete(`/auth/webauthn/credentials/${credId}?userId=${userId}`);
      await loadBiometricCreds(userId);
      toast.success('Biometric credential removed');
    } catch {
      toast.error('Failed to remove credential');
    }
  }

  const assignStoreMutation = useMutation({
    mutationFn: ({ userId, storeId }: { userId: string; storeId: string }) =>
      api.post(`/business/${businessId}/users/${userId}/stores/${storeId}`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['business-users', businessId] });
    },
  });

  const removeStoreMutation = useMutation({
    mutationFn: ({ userId, storeId }: { userId: string; storeId: string }) =>
      api.delete(`/business/${businessId}/users/${userId}/stores/${storeId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['business-users', businessId] });
    },
  });

  const saveEtimsMutation = useMutation({
    mutationFn: (data: typeof etimsForm) =>
      api.patch(`/business/${businessId}/etims-credentials`, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['business-settings'] });
      setEtimsSaved(true);
      setTimeout(() => setEtimsSaved(false), 3000);
      setEtimsForm({ bhfId: '', tin: '', dvcSrno: '' });
    },
  });

  const saveMpesaMutation = useMutation({
    mutationFn: (data: typeof mpesaForm) =>
      api.patch(`/business/${businessId}/mpesa-credentials`, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['business-settings'] });
      setMpesaSaved(true);
      setTimeout(() => setMpesaSaved(false), 3000);
      setMpesaForm({ consumerKey: '', consumerSecret: '', shortcode: '', passkey: '', callbackUrl: '' });
    },
  });

  const saveAtMutation = useMutation({
    mutationFn: (data: typeof atForm) =>
      api.patch(`/business/${businessId}/at-credentials`, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['business-settings'] });
      setAtSaved(true);
      setTimeout(() => setAtSaved(false), 3000);
      setAtForm({ apiKey: '', username: '', senderId: '' });
    },
  });

  const saveLoyaltyMutation = useMutation({
    mutationFn: (data: typeof loyaltyForm) =>
      api.post(`/loyalty/program`, { businessId, ...data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['loyalty-program-settings'] });
      setLoyaltySaved(true);
      setTimeout(() => setLoyaltySaved(false), 3000);
    },
  });

  const createPrinterMutation = useMutation({
    mutationFn: (data: typeof printerForm) =>
      api.post(`/printers`, { storeId: user?.storeId, ...data }),
    onSuccess: (created, variables) => {
      // The KDS prints tickets to this printer; for a LAN printer it needs the saved row's id, not its address.
      if (variables.connectionType === 'NETWORK' && variables.handles.some((h) => h.startsWith('KOT'))) {
        const id = (created as { id?: string } | undefined)?.id;
        if (id) localStorage.setItem('kot-printer-config', JSON.stringify({ type: 'NETWORK_ESCPOS', networkPrinterId: id }));
      }
      void refetchPrinters();
      setShowAddPrinter(false);
      setPrinterForm({ name: '', connectionType: 'USB', connectionDetails: '', isDefault: false, handles: ['RECEIPT'] });
    },
  });

  const deletePrinterMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/printers/${id}`),
    onSuccess: () => void refetchPrinters(),
  });

  const submitEtimsManual = useMutation({
    mutationFn: (saleId: string) => api.post(`/etims/submit/${saleId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['etims-pending'] });
    },
  });

  const [batchSubmitResult, setBatchSubmitResult] = useState<{ submitted: number; failed: number } | null>(null);
  const batchSubmitEtims = useMutation({
    mutationFn: () => api.post<{ submitted: number; failed: number; errors: string[] }>(`/etims/batch-submit?businessId=${businessId}`),
    onSuccess: (res) => {
      setBatchSubmitResult({ submitted: res.submitted, failed: res.failed });
      void queryClient.invalidateQueries({ queryKey: ['etims-pending'] });
      setTimeout(() => setBatchSubmitResult(null), 5000);
    },
  });

  const createApiKeyMutation = useMutation({
    mutationFn: () =>
      api.post<{ id: string; name: string; scopes: string[]; rawKey: string; isActive: boolean; createdAt: string }>(
        '/api-keys',
        { businessId, name: newKeyName.trim(), scopes: newKeyScopes },
      ),
    onSuccess: (res) => {
      setCreatedRawKey(res.rawKey);
      setNewKeyName('');
      void refetchApiKeys();
    },
  });

  const revokeApiKeyMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/api-keys/${id}/revoke`, {}),
    onSuccess: () => void refetchApiKeys(),
  });

  const deleteApiKeyMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api-keys/${id}`),
    onSuccess: () => void refetchApiKeys(),
  });

  const createScheduleMutation = useMutation({
    mutationFn: () =>
      api.post('/report-schedules', {
        businessId,
        reportType: scheduleForm.reportType,
        frequency: scheduleForm.frequency,
        hour: scheduleForm.hour,
        dayOfWeek: scheduleForm.frequency === 'WEEKLY' ? scheduleForm.dayOfWeek : undefined,
        dayOfMonth: scheduleForm.frequency === 'MONTHLY' ? scheduleForm.dayOfMonth : undefined,
        recipients: scheduleForm.recipients.split(',').map((e) => e.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      void refetchSchedules();
      setShowAddSchedule(false);
      setScheduleForm({ reportType: 'SALES', frequency: 'DAILY', hour: 8, dayOfWeek: undefined, dayOfMonth: undefined, recipients: '' });
    },
  });

  const toggleScheduleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/report-schedules/${id}`, { isActive }),
    onSuccess: () => void refetchSchedules(),
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/report-schedules/${id}`),
    onSuccess: () => void refetchSchedules(),
  });

  const triggerScheduleMutation = useMutation({
    mutationFn: (id: string) => api.post(`/report-schedules/${id}/trigger`, {}),
    onSuccess: () => void refetchSchedules(),
  });

  const createWebhookMutation = useMutation({
    mutationFn: () => api.post('/webhooks', { businessId, ...webhookForm }),
    onSuccess: () => {
      void refetchWebhooks();
      setShowAddWebhook(false);
      setWebhookForm({ url: '', secret: '', description: '', events: [] });
      showNotification('Webhook endpoint registered', 'success');
    },
  });

  const toggleWebhookMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/webhooks/${id}`, { isActive }),
    onSuccess: () => void refetchWebhooks(),
  });

  const deleteWebhookMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/webhooks/${id}`),
    onSuccess: () => {
      void refetchWebhooks();
      showNotification('Webhook removed', 'info');
    },
  });

  const pingWebhookMutation = useMutation({
    mutationFn: (id: string) => api.post(`/webhooks/${id}/ping`, {}) as Promise<{ success: boolean; status?: number; error?: string }>,
    onSuccess: (res: { success: boolean; status?: number; error?: string }) => {
      showNotification(res.success ? `Ping OK (HTTP ${res.status})` : `Ping failed: ${res.error}`, res.success ? 'success' : 'error');
    },
  });

  // ─── Security: change password mutation ────────────────────────────────────
  const changePwdMutation = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword: cpCurrent, newPassword: cpNew }),
    onSuccess: () => {
      setCpMsg({ type: 'success', text: 'Password changed successfully' });
      setCpCurrent('');
      setCpNew('');
      setCpConfirm('');
    },
    onError: (e: unknown) => setCpMsg({ type: 'error', text: (e as Error).message || 'Failed to change password' }),
  });

  // ─── Security: active sessions ─────────────────────────────────────────────
  interface ActiveSession {
    id: string;
    ipAddress?: string;
    userAgent?: string;
    createdAt: string;
    lastSeenAt: string;
  }

  const { data: activeSessions, refetch: refetchSessions } = useQuery<ActiveSession[]>({
    queryKey: ['auth-sessions'],
    queryFn: () => api.get<ActiveSession[]>('/auth/sessions'),
    enabled: activeTab === 'security',
  });

  const revokeSessionMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/sessions/${id}`),
    onSuccess: () => void refetchSessions(),
  });

  const revokeAllMutation = useMutation({
    mutationFn: () => api.delete('/auth/sessions'),
    onSuccess: () => void refetchSessions(),
  });

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <div className="text-gray-500">Loading settings...</div>
      </div>
    );
  }

  const tabs = [
    { id: 'general' as const, label: 'General', icon: Save },
    { id: 'users' as const, label: 'Users', icon: Users },
    { id: 'stores' as const, label: 'Stores', icon: Store },
    { id: 'etims' as const, label: 'KRA eTIMS', icon: Shield },
    { id: 'mpesa' as const, label: 'M-Pesa', icon: Smartphone },
    { id: 'messaging' as const, label: 'Messaging', icon: MessageSquare },
    { id: 'loyalty' as const, label: 'Loyalty', icon: Star },
    { id: 'loyalty-tiers' as const, label: 'Loyalty Tiers', icon: Star },
    { id: 'kdpa' as const, label: 'KDPA', icon: Shield },
    { id: 'printers' as const, label: 'Printers', icon: Printer },
    { id: 'api-keys' as const, label: 'API Keys', icon: Key },
    { id: 'scale' as const, label: 'Scale', icon: Scale },
    { id: 'webhooks' as const, label: 'Webhooks', icon: Zap },
    { id: 'audit' as const, label: 'Audit Log', icon: Activity },
    { id: 'backup' as const, label: 'Backup', icon: HardDrive },
    { id: 'automation' as const, label: 'Automation', icon: Clock },
    { id: 'subscription' as const, label: 'Subscription', icon: CreditCard },
    { id: 'security' as const, label: 'Security', icon: Lock },
  ];

  const groups = [
    { label: 'Business', items: ['general', 'users', 'stores', 'subscription'] },
    { label: 'Compliance and security', items: ['etims', 'kdpa', 'security', 'audit'] },
    { label: 'Payments and messaging', items: ['mpesa', 'messaging', 'loyalty', 'loyalty-tiers'] },
    { label: 'Hardware and integrations', items: ['printers', 'scale', 'api-keys', 'webhooks'] },
    { label: 'Data', items: ['backup', 'automation'] },
  ].map((g) => ({
    label: g.label,
    items: g.items.map((id) => {
      const t = tabs.find((x) => x.id === id)!;
      return { id: t.id, label: t.label, icon: <t.icon className="w-4 h-4" /> };
    }),
  }));

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <PageHeader title="Settings" icon={<SettingsIcon className="w-5 h-5" />} />

      <div className="mt-5 lg:flex lg:gap-8 lg:items-start">
        {/* Desktop: grouped menu on the left. Phone and tablet: one scrolling row of tabs. */}
        <SideNav groups={groups} value={activeTab} onChange={setActiveTab} className="hidden lg:block w-56 flex-shrink-0 sticky top-0" />
        <Tabs tabs={tabs.map((t) => ({ id: t.id, label: t.label, icon: <t.icon className="w-4 h-4" /> }))} value={activeTab} onChange={setActiveTab} className="lg:hidden mb-5" />

        <div className="min-w-0 flex-1 max-w-4xl">
      {/* ── General Settings ──────────────────────────────────────────────── */}
      {activeTab === 'general' && (
        <div className="space-y-6">

        <AppUpdateCard />

        {/* ── Business Code card ── */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-bold text-blue-800">Business Code</span>
                <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-medium">Share with branch staff</span>
              </div>
              {/* Short code — big and easy to read */}
              <div className="font-mono text-2xl font-bold tracking-widest text-blue-900 bg-white border-2 border-blue-300 rounded-xl px-4 py-3 text-center select-all mb-2">
                {settings?.shortCode ?? '—'}
              </div>
              {/* UUID for reference */}
              <div className="text-xs text-blue-500 font-mono truncate select-all px-1">
                ID: {businessId}
              </div>
              <p className="text-xs text-blue-600 mt-2">
                Staff type this short code on their first PIN login to connect to your business.
                One-time setup per device.
              </p>
            </div>
            <button
              onClick={() => {
                const code = settings?.shortCode ?? businessId;
                void navigator.clipboard.writeText(code);
                const btn = document.getElementById('copy-biz-id-btn');
                if (btn) { btn.textContent = 'Copied'; setTimeout(() => { if (btn) btn.textContent = 'Copy'; }, 2000); }
              }}
              id="copy-biz-id-btn"
              className="flex-shrink-0 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              Copy
            </button>
          </div>
        </div>

        {/* ── Online Store link card ── */}
        {(() => {
          let serverUrl: string | null = null;
          try { serverUrl = localStorage.getItem('faida-server-url'); } catch { /* storage unavailable */ }
          const store = onlineStoreLink({
            inDesktopApp: inDesktopApp(),
            serverUrl,
            origin: window.location.origin,
            publicWebUrl: import.meta.env.VITE_PUBLIC_WEB_URL as string | undefined,
            businessId: businessId ?? '',
          });
          if (store.kind === 'unavailable') {
            return (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-bold text-gray-800">Online Store</span>
                  <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full font-medium">Not available on this computer</span>
                </div>
                <p className="text-sm text-gray-600">{store.reason}</p>
              </div>
            );
          }
          const shopUrl = store.url;
          return (
            <div className="bg-gradient-to-r from-indigo-50 to-violet-50 border border-indigo-200 rounded-xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-bold text-indigo-800">Online Store</span>
                    <span className="text-xs bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full font-medium">Share with customers</span>
                  </div>
                  <div className="font-mono text-sm text-indigo-900 bg-white border-2 border-indigo-200 rounded-xl px-3 py-2.5 truncate select-all mb-3">
                    {shopUrl}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      id="copy-shop-link-btn"
                      onClick={() => {
                        void navigator.clipboard.writeText(shopUrl);
                        const btn = document.getElementById('copy-shop-link-btn');
                        if (btn) { btn.textContent = 'Copied'; setTimeout(() => { if (btn) btn.textContent = 'Copy link'; }, 2000); }
                      }}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
                    >
                      Copy link
                    </button>
                    <a
                      href={shopUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-4 py-2 bg-white border border-indigo-300 text-indigo-700 text-sm font-semibold rounded-lg hover:bg-indigo-50 transition-colors"
                    >
                      Open
                    </a>
                  </div>
                  <p className="text-xs text-indigo-600 mt-2">
                    Customers open this link to order for delivery or pickup, pay by M-Pesa, and track their orders.
                  </p>
                </div>
                <div className="flex-shrink-0 text-center">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(shopUrl)}`}
                    alt="Online store QR code"
                    width={120}
                    height={120}
                    className="rounded-lg border border-indigo-200 bg-white p-1"
                  />
                  <p className="text-[11px] text-indigo-500 mt-1">Scan to order</p>
                </div>
              </div>
            </div>
          );
        })()}

        <div className="bg-white rounded-xl shadow p-6 space-y-5">
          <div>
            <label htmlFor="f-business-name" className="block text-sm font-medium text-gray-700 mb-1">Business Name</label>
            <input id="f-business-name"
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="f-pos-mode" className="block text-sm font-medium text-gray-700 mb-1">POS Mode</label>
            <select id="f-pos-mode"
              value={form.posMode}
              onChange={(e) => setForm((f) => ({ ...f, posMode: e.target.value }))}
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
              <option value="RETAIL">Retail — Standard product sales</option>
              <option value="HOSPITALITY">Hospitality / Restaurant — Tables, orders, KOT</option>
              <option value="FAST_FOOD">Fast Food — Counter service with KOT</option>
              <option value="SUPERMARKET">Supermarket — High-volume retail</option>
              <option value="CLINIC">Clinic / Pharmacy — Prescriptions & appointments</option>
              <option value="SALON">Salon / Spa — Appointments & services</option>
              <option value="FUEL_PUMP">Fuel Station — Pump management & fuel sales</option>
              <option value="CYBERCAFE">Cybercafe — PC sessions, time billing & service rates</option>
            </select>
          </div>

          {/* Optional modules: switch a capability on next to the main till */}
          {/* Only offer what the main till does not already include */}
          {OPTIONAL_MODULES.some((m) => !moduleIncludedByMode(m, form.posMode)) && (
            <div className="border rounded-xl p-4 space-y-3 bg-gray-50">
              <div>
                <h3 className="text-sm font-semibold text-gray-800">Also run</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Your POS mode is the main till. Switch these on if the business also does something else, such as a
                  fuel station with a restaurant or a shop with a kitchen.
                </p>
              </div>
              {OPTIONAL_MODULES.filter((m) => !moduleIncludedByMode(m, form.posMode)).map((m) => (
                <label key={m} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1 w-4 h-4 rounded text-blue-600"
                    checked={form.enabledModules.includes(m)}
                    onChange={(e) => setForm((f) => ({
                      ...f,
                      enabledModules: e.target.checked ? [...f.enabledModules, m] : f.enabledModules.filter((x) => x !== m),
                    }))}
                  />
                  <span>
                    <span className="block text-sm font-medium text-gray-800">{OPTIONAL_MODULE_LABELS[m].label}</span>
                    <span className="block text-xs text-gray-500">{OPTIONAL_MODULE_LABELS[m].description}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          {/* ── Tax Configuration ── */}
          <div className="border rounded-xl p-4 space-y-4 bg-gray-50">
            <h3 className="text-sm font-semibold text-gray-800">Tax Configuration</h3>
            <p className="text-xs text-gray-500 -mt-2">
              All taxes are <strong>inclusive</strong> — they are extracted from the item price, not added on top.
            </p>

            {/* Tax type selection */}
            <div className="space-y-2">
              {(
                [
                  { value: 'VAT',  label: 'VAT (16%)',  desc: 'Value Added Tax — for VAT-registered businesses' },
                  { value: 'TOT',  label: 'TOT (3%)',   desc: 'Turnover Tax — for businesses with turnover < KES 5M/year' },
                  { value: 'NONE', label: 'No Tax',     desc: 'Tax-exempt businesses or where tax is handled externally' },
                ] as const
              ).map(({ value, label, desc }) => (
                <label
                  key={value}
                  className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                    form.taxType === value
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="taxType"
                    value={value}
                    checked={form.taxType === value}
                    onChange={() => setForm((f) => ({ ...f, taxType: value }))}
                    className="mt-0.5 accent-blue-600"
                  />
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{label}</p>
                    <p className="text-xs text-gray-500">{desc}</p>
                  </div>
                </label>
              ))}
            </div>

            {/* TOT Rate — shown only when TOT is selected */}
            {form.taxType === 'TOT' && (
              <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-amber-900">TOT Rate (%)</p>
                    <p className="text-xs text-amber-700">KRA Finance Act 2023 current rate: <strong>3%</strong>. Update here if KRA revises the rate.</p>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={form.totRate}
                    onChange={(e) => setForm((f) => ({ ...f, totRate: Number(e.target.value) }))}
                    className="w-24 px-3 py-1.5 border border-amber-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 text-center font-bold"
                  />
                </div>
                <p className="text-xs text-amber-600">
                  TOT applies to businesses with annual turnover between KES 1M–25M. Verify current rate at <strong>kra.go.ke</strong> before changing.
                </p>
              </div>
            )}

            {/* Service charge */}
            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-800">Service Charge</p>
                  <p className="text-xs text-gray-500">Auto-apply on every sale (cashier can still toggle per transaction)</p>
                </div>
                <Switch label="Service charge on every sale" checked={form.serviceChargeDefault} onChange={(on) => setForm((f) => ({ ...f, serviceChargeDefault: on }))} />
              </div>
              {form.serviceChargeDefault && (
                <div className="flex items-center gap-3">
                  <label htmlFor="f-rate" className="text-sm text-gray-600 w-24 shrink-0">Rate (%)</label>
                  <input id="f-rate"
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={form.serviceChargeRate}
                    onChange={(e) => setForm((f) => ({ ...f, serviceChargeRate: Number(e.target.value) }))}
                    className="w-28 px-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-xs text-gray-400">Default: 10%</span>
                </div>
              )}
              <p className="text-xs text-gray-400">
                Service charge is not included in the VAT/TOT base (KRA compliance)
              </p>
            </div>
          </div>

          <div>
            <label htmlFor="f-negative-stock-policy" className="block text-sm font-medium text-gray-700 mb-1">
              Negative Stock Policy
            </label>
            <select id="f-negative-stock-policy"
              value={form.negativePolicyDefault}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  negativePolicyDefault: e.target.value as 'BLOCK' | 'WARN' | 'ALLOW',
                }))
              }
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
              <option value="BLOCK">Block — Prevent selling out-of-stock items</option>
              <option value="WARN">Warn — Show warning but allow sale</option>
              <option value="ALLOW">Allow — Silent negative stock</option>
            </select>
          </div>

          <div>
            <label htmlFor="f-expired-item-policy" className="block text-sm font-medium text-gray-700 mb-1">
              Expired Item Policy
            </label>
            <select id="f-expired-item-policy"
              value={form.expiredItemPolicy}
              onChange={(e) => setForm((f) => ({ ...f, expiredItemPolicy: e.target.value }))}
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
              <option value="BLOCK">Block — Cannot sell expired items</option>
              <option value="WARN">Warn — Alert but allow sale</option>
              <option value="ALLOW">Allow — No restriction on expired items</option>
            </select>
          </div>

          <div>
            <label htmlFor="f-expiry-alert-threshold-days" className="block text-sm font-medium text-gray-700 mb-1">
              Expiry Alert Threshold (days)
            </label>
            <input id="f-expiry-alert-threshold-days"
              type="number"
              min={1}
              max={365}
              value={form.expiryAlertDays}
              onChange={(e) => setForm((f) => ({ ...f, expiryAlertDays: Number(e.target.value) }))}
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              Items expiring within this many days will show an alert badge in inventory and POS
            </p>
          </div>

          <div>
            <label htmlFor="f-expense-approval-threshold-kes" className="block text-sm font-medium text-gray-700 mb-1">
              Expense Approval Threshold (KES)
            </label>
            <input id="f-expense-approval-threshold-kes"
              type="number"
              min={0}
              step={100}
              value={form.expenseApprovalThresholdCents / 100}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  expenseApprovalThresholdCents: Math.round(Number(e.target.value) * 100),
                }))
              }
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              Expenses above this amount require manager approval
            </p>
          </div>

          {/* ── Bank Transfer Details ── */}
          <div className="border-t pt-4">
            <h4 className="font-medium text-gray-800 mb-3">Bank Transfer Details</h4>
            <p className="text-xs text-gray-500 mb-3">Shown to customers in the Bank Transfer payment screen at checkout.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="f-bank-name" className="block text-sm font-medium text-gray-700 mb-1">Bank Name</label>
                <input id="f-bank-name" type="text" value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
                  placeholder="e.g. KCB, Equity, NCBA"
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label htmlFor="f-account-number" className="block text-sm font-medium text-gray-700 mb-1">Account Number</label>
                <input id="f-account-number" type="text" value={form.bankAccountNumber} onChange={(e) => setForm((f) => ({ ...f, bankAccountNumber: e.target.value }))}
                  placeholder="1234567890"
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 font-mono" />
              </div>
              <div>
                <label htmlFor="f-account-name" className="block text-sm font-medium text-gray-700 mb-1">Account Name</label>
                <input id="f-account-name" type="text" value={form.bankAccountName} onChange={(e) => setForm((f) => ({ ...f, bankAccountName: e.target.value }))}
                  placeholder="Business name as on account"
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label htmlFor="f-branch-optional" className="block text-sm font-medium text-gray-700 mb-1">Branch (optional)</label>
                <input id="f-branch-optional" type="text" value={form.bankBranch} onChange={(e) => setForm((f) => ({ ...f, bankBranch: e.target.value }))}
                  placeholder="e.g. Westlands"
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          </div>

          {/* ── Table Display Prefix ── */}
          <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Table Display Prefix</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Prefix shown before the table number/name on the floor plan. Use <strong>T</strong> for standard hotels (T1, T2…), leave blank for city names or custom labels that stand on their own (Tokyo, Berlin, Patio…).
            </p>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={form.tablePrefix}
                onChange={(e) => setForm((f) => ({ ...f, tablePrefix: e.target.value }))}
                placeholder="T"
                maxLength={5}
                className="w-24 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                Preview:
                <span className="font-bold text-gray-900 dark:text-white text-base">
                  {(form.tablePrefix || '') + '1'}&nbsp;&nbsp;{(form.tablePrefix || '') + '2'}&nbsp;&nbsp;{(form.tablePrefix || '') + '10'}
                </span>
              </div>
            </div>
          </div>

          {/* ── Pole Display ── */}
          <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Pole Display</h3>
            <div className="space-y-3">
              <div>
                <label htmlFor="f-idle-message" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Idle Message</label>
                <input id="f-idle-message"
                  type="text"
                  value={form.idleMessage}
                  onChange={(e) => setForm((f) => ({ ...f, idleMessage: e.target.value }))}
                  placeholder="Welcome!"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="f-logo-url-optional" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Logo URL (optional)</label>
                <input id="f-logo-url-optional"
                  type="url"
                  value={form.idleLogoUrl}
                  onChange={(e) => setForm((f) => ({ ...f, idleLogoUrl: e.target.value }))}
                  placeholder="https://your-logo-url.com/logo.png"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="p-3 bg-gray-800 rounded-lg text-center" style={{ minHeight: '60px' }}>
                {form.idleLogoUrl && (
                  <img src={form.idleLogoUrl} alt="Logo preview" className="h-8 w-auto mx-auto mb-2 object-contain" />
                )}
                <p className="text-white text-sm">{form.idleMessage || 'Welcome!'}</p>
                <p className="text-gray-400 text-xs mt-1">Pole Display Preview</p>
              </div>
            </div>
          </div>

          {/* ── Receipt Customization (STARTER+) ── */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Receipt Customization</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Add your own message above and below the receipt items</p>
              </div>
              {!hasFeature(user?.subscriptionTier ?? user?.planName, 'receipt-customization') && (
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">Starter+</span>
              )}
            </div>
            {!hasFeature(user?.subscriptionTier ?? user?.planName, 'receipt-customization') ? (
              <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-dashed border-gray-300 dark:border-gray-600 p-6 text-center space-y-2">
                <p className="text-sm text-gray-500 dark:text-gray-400">Upgrade to <strong className="text-gray-700 dark:text-gray-300">Starter</strong> to add custom header and footer text to your receipts.</p>
                <a href="/settings?tab=subscription" className="inline-block mt-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline">View plans →</a>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Receipt Header</label>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">Shown at the top of the receipt, before items</p>
                    <textarea
                      rows={2}
                      placeholder="e.g. Thank you for choosing us! Follow us @mybusiness"
                      value={form.receiptHeader}
                      onChange={(e) => setForm((f) => ({ ...f, receiptHeader: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Receipt Footer</label>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">Shown at the bottom, after the total</p>
                    <textarea
                      rows={2}
                      placeholder="e.g. No returns after 7 days. Goods once sold are not refundable."
                      value={form.receiptFooter}
                      onChange={(e) => setForm((f) => ({ ...f, receiptFooter: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                  </div>
                </div>
                {/* Live preview */}
                <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 p-4 text-xs text-gray-500 dark:text-gray-400 font-mono space-y-1">
                  <p className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-widest mb-2">Preview</p>
                  {form.receiptHeader && (
                    <div className="text-center font-medium text-gray-700 dark:text-gray-300 whitespace-pre-wrap border-b border-dashed border-gray-300 dark:border-gray-600 pb-2 mb-2">{form.receiptHeader}</div>
                  )}
                  <div className="text-center text-gray-400">· · · receipt items · · ·</div>
                  <div className="text-center text-gray-400">Total: KES XXXX</div>
                  {form.receiptFooter && (
                    <div className="text-center text-gray-600 dark:text-gray-300 whitespace-pre-wrap border-t border-dashed border-gray-300 dark:border-gray-600 pt-2 mt-2">{form.receiptFooter}</div>
                  )}
                  <div className="text-center text-gray-400 text-[10px] mt-1">Powered by Faida Systems</div>
                </div>
              </div>
            )}
          </div>

          {/* ── Display / Accessibility ───────────────────────────────────── */}
          <div className="border rounded-xl p-4 space-y-4 bg-gray-50 dark:bg-gray-800/50">
            <div>
              <h3 className="font-semibold text-gray-800 dark:text-white">Display &amp; Accessibility</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Adjust the interface font size for better readability.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Font Size</label>
              <div className="flex gap-2 flex-wrap">
                {([
                  { id: 'sm' as const, label: 'Small', preview: 'Aa' },
                  { id: 'md' as const, label: 'Default', preview: 'Aa' },
                  { id: 'lg' as const, label: 'Large', preview: 'Aa' },
                  { id: 'xl' as const, label: 'X-Large', preview: 'Aa' },
                ] as const).map(({ id, label, preview }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => applyFontSize(id)}
                    className={`flex flex-col items-center gap-1 px-4 py-3 rounded-xl border-2 transition-colors min-w-[72px] ${
                      fontSize === id
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                        : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'
                    }`}
                  >
                    <span style={{ fontSize: id === 'sm' ? '12px' : id === 'md' ? '15px' : id === 'lg' ? '18px' : '22px', lineHeight: 1.2, fontWeight: 600 }}>{preview}</span>
                    <span className="text-xs font-medium">{label}</span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">Changes apply immediately and persist across sessions.</p>
            </div>
            <div className="flex items-center justify-between pt-2 border-t dark:border-gray-600">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Auto-logout after sale</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Return to PIN screen automatically after each completed sale.</p>
              </div>
              <Switch label="Auto-logout after sale" checked={autoLogoutAfterSale} onChange={() => toggleAutoLogoutAfterSale()} />
            </div>
          </div>

          {/* ── Receipt Format Preferences ──────────────────────────────────── */}
          <div className="border rounded-xl p-4 space-y-4 bg-gray-50 dark:bg-gray-800/50">
            <div>
              <h3 className="font-semibold text-gray-800 dark:text-white">Receipt Format Preferences</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Choose receipt format per transaction type. THERMAL for fast counter sales, A4 PDF for professional invoices and delivery receipts.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="f-counter-sale-receipts" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Counter Sale Receipts</label>
                <select id="f-counter-sale-receipts"
                  value={(form as any).receiptFormatSale || 'THERMAL'}
                  onChange={(e) => setForm((f) => ({ ...f, receiptFormatSale: e.target.value } as any))}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
                  <option value="THERMAL">Thermal (80mm) — Fast printing</option>
                  <option value="A4">A4 PDF — Professional format</option>
                </select>
              </div>
              <div>
                <label htmlFor="f-b2b-invoices" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">B2B Invoices</label>
                <select id="f-b2b-invoices"
                  value={(form as any).receiptFormatInvoice || 'A4'}
                  onChange={(e) => setForm((f) => ({ ...f, receiptFormatInvoice: e.target.value } as any))}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
                  <option value="A4">A4 PDF — Professional letterhead</option>
                  <option value="THERMAL">Thermal (80mm)</option>
                </select>
              </div>
              <div>
                <label htmlFor="f-delivery-receipts" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Delivery Receipts</label>
                <select id="f-delivery-receipts"
                  value={(form as any).receiptFormatDelivery || 'A4'}
                  onChange={(e) => setForm((f) => ({ ...f, receiptFormatDelivery: e.target.value } as any))}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
                  <option value="A4">A4 PDF — With signature blocks</option>
                  <option value="THERMAL">Thermal (80mm)</option>
                </select>
              </div>
              <div>
                <label htmlFor="f-email-attachments" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email Attachments</label>
                <select id="f-email-attachments"
                  value={(form as any).receiptFormatEmail || 'A4'}
                  onChange={(e) => setForm((f) => ({ ...f, receiptFormatEmail: e.target.value } as any))}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
                  <option value="A4">A4 PDF — Professional attachment</option>
                  <option value="THERMAL">Thermal (80mm)</option>
                </select>
              </div>
            </div>
          </div>

          {/* ── Hardware Toggles ──────────────────────────────────────────── */}
          <div className="border rounded-xl p-4 space-y-4 bg-gray-50 dark:bg-gray-800/50">
            <div>
              <h3 className="font-semibold text-gray-800 dark:text-white">Hardware</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Enable only the hardware your business uses. Disabled hardware hides its buttons in the POS.
              </p>
            </div>
            {[
              { key: 'enableCashDrawer' as const, label: 'Cash Drawer', desc: 'Opens via printer RJ11 port after cash sales' },
              { key: 'enableBarcodeScanner' as const, label: 'Camera Barcode Scanner', desc: 'Built-in camera scan button on the POS' },
              { key: 'enablePoleDisplay' as const, label: 'Pole Display', desc: 'Customer-facing display at /pole-display' },
            ].map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-white">{label}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{desc}</p>
                </div>
                <Switch label={label} checked={!!form[key]} onChange={(on) => setForm((f) => ({ ...f, [key]: on }))} />
              </div>
            ))}
          </div>

          {settings && ['OWNER', 'MANAGER'].includes(String(user?.role)) && (settings.posMode === 'HOSPITALITY' || (settings as { hotelLevies?: string }).hotelLevies !== '[]') && (
            <HotelLeviesCard businessId={businessId} stored={(settings as { hotelLevies?: string }).hotelLevies} />
          )}

          {settings && user?.role === 'OWNER' && (
            <SalesPipelineCard
              businessId={businessId}
              enabled={!!(settings as { verticalSalesEnabled?: boolean }).verticalSalesEnabled}
              since={(settings as { verticalSalesFrom?: string | null }).verticalSalesFrom}
            />
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => updateMutation.mutate(form)}
              disabled={updateMutation.isPending}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {updateMutation.isPending ? 'Saving...' : 'Save Settings'}
            </button>
            {saved && (
              <span className="flex items-center gap-1.5 text-green-600 text-sm">
                <CheckCircle className="w-4 h-4" /> Saved
              </span>
            )}
            {updateMutation.isError && (
              <span className="flex items-center gap-1.5 text-red-600 text-sm">
                <AlertCircle className="w-4 h-4" /> Failed to save
              </span>
            )}
          </div>
        </div>

        {/* ── Multi-currency Display ─────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow p-6 space-y-4">
          <div>
            <h3 className="font-semibold text-gray-800">Multi-Currency Display</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              KES (Kenya Shilling) is the primary currency. Select additional currencies to show alongside KES at checkout. Click "Refresh Live Rates" to fetch current rates from Open Exchange Rates and store them server-side.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {SUPPORTED_CURRENCIES.map((code) => (
              <label key={code} className="flex items-center gap-2 p-2.5 border rounded-lg cursor-pointer hover:bg-blue-50 transition-colors">
                <input
                  type="checkbox"
                  checked={selectedCurrencies.includes(code)}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedCurrencies((prev) => [...prev, code]);
                    else setSelectedCurrencies((prev) => prev.filter((c) => c !== code));
                  }}
                  className="w-4 h-4 rounded accent-blue-600"
                />
                <span className="text-sm font-semibold text-gray-700">
                  {code}{code === 'KES' ? ' 🇰🇪 (Kenya Shilling)' : ''}
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-400">
            Rates are stored server-side. Source: Open Exchange Rates (open.er-api.com, free tier).
          </p>
          <div className="flex items-center gap-3 pt-1 flex-wrap">
            <button
              onClick={() => saveCurrencyMutation.mutate()}
              disabled={saveCurrencyMutation.isPending}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 text-sm"
            >
              <Save className="w-4 h-4" />
              {saveCurrencyMutation.isPending ? 'Saving...' : 'Save Preferences'}
            </button>
            <button
              onClick={() => refreshRatesMutation.mutate()}
              disabled={refreshRatesMutation.isPending || selectedCurrencies.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 text-sm"
            >
              <RefreshCw className={`w-4 h-4 ${refreshRatesMutation.isPending ? 'animate-spin' : ''}`} />
              {refreshRatesMutation.isPending ? 'Fetching...' : 'Refresh Live Rates'}
            </button>
            {currencySaved && (
              <span className="flex items-center gap-1.5 text-green-600 text-sm">
                <CheckCircle className="w-4 h-4" /> Saved
              </span>
            )}
          </div>
        </div>
        </div>
      )}

      {/* ── Users Tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'users' && (() => {
        const USER_LIMITS: Record<string, number> = { FREE: 1, STARTER: 8, GROWTH: 15, PRO: 30, ENTERPRISE: Infinity };
        const currentTierU = settings?.subscriptionTier ?? 'STARTER';
        const userLimit = USER_LIMITS[currentTierU] ?? 3;
        const atLimitU = userLimit !== Infinity && users.length >= userLimit;
        const nearLimitU = !atLimitU && userLimit !== Infinity && users.length / userLimit >= 0.8;
        return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">{users.length} staff member(s)</p>
              {userLimit !== Infinity && (
                <p className={`text-xs mt-0.5 ${atLimitU ? 'text-red-600' : nearLimitU ? 'text-amber-600' : 'text-gray-400'}`}>
                  {users.length} / {userLimit} user{userLimit !== 1 ? 's' : ''} on {currentTierU} plan
                </p>
              )}
            </div>
            <button
              onClick={() => { if (atLimitU) { toast.warning(`Your ${currentTierU} plan allows up to ${userLimit} users. Upgrade to add more staff.`); return; } setShowAddUser(true); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${atLimitU ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
            >
              <Plus className="w-4 h-4" />
              Add Staff
            </button>
          </div>
          {atLimitU && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              User limit reached for {currentTierU} plan. Upgrade your subscription to add more staff.
            </div>
          )}
          {nearLimitU && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              You're using {users.length} of {userLimit} user slots. Consider upgrading soon.
            </div>
          )}

          <div className="bg-white rounded-xl shadow divide-y">
            {users.map((u) => (
              <div key={u.id} className="divide-y divide-gray-50 dark:divide-gray-700/50">
                {/* ── User row ── */}
                <div className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-sm font-semibold text-gray-600">
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-sm">{u.name}</p>
                      <p className="text-xs text-gray-400">{u.email ?? 'No email (PIN only)'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                        ROLE_COLORS[u.role] ?? 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {ROLE_LABELS[u.role] ?? u.role}
                    </span>
                    {u.role === 'MANAGER' && (settings?.stores ?? []).length > 1 && (
                      <button
                        onClick={() => setStoreAssignUser(u)}
                        className="text-xs px-2 py-1 rounded border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                        title="Assign stores"
                      >
                        <span className="flex items-center gap-1">
                          <Store className="w-3 h-3" />
                          {(u.assignedStores ?? []).length === 0
                            ? 'All stores'
                            : `${(u.assignedStores ?? []).length} store${(u.assignedStores ?? []).length !== 1 ? 's' : ''}`}
                        </span>
                      </button>
                    )}
                    {/* Biometric button — PRO/ENTERPRISE only */}
                    {['PRO', 'ENTERPRISE'].includes(settings?.subscriptionTier ?? '') && (
                      <button
                        onClick={() => {
                          const next = biometricUserId === u.id ? null : u.id;
                          setBiometricUserId(next);
                          if (next) void loadBiometricCreds(next);
                        }}
                        className={`p-1 transition-colors ${biometricUserId === u.id ? 'text-emerald-600' : 'text-gray-400 hover:text-emerald-600'}`}
                        title="Manage biometrics (Fingerprint / Face ID)"
                      >
                        <Fingerprint className="w-4 h-4" />
                      </button>
                    )}
                    {/* PIN edit — available for all users including owner */}
                    <button
                      onClick={() => setEditingUser(u)}
                      className="text-gray-400 hover:text-blue-600 p-1"
                      title="Set / update PIN"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    {/* Delete — owner cannot be deleted */}
                    {u.role !== 'OWNER' && (
                      <button
                        onClick={() =>
                          showConfirm(
                            'Remove Team Member',
                            `Remove ${u.name} from your team? This action cannot be undone.`,
                            () => deleteUserMutation.mutate(u.id),
                          )
                        }
                        className="text-gray-400 hover:text-red-600 p-1"
                        title="Delete user"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
                {/* ── Biometric panel ── */}
                {biometricUserId === u.id && (
                  <div className="px-4 py-3 bg-emerald-50 dark:bg-emerald-900/10">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                        <Fingerprint className="w-3.5 h-3.5" />
                        Biometric Credentials
                      </p>
                      <button
                        onClick={() => void handleRegisterBiometric(u)}
                        disabled={biometricRegistering}
                        className="text-xs px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium disabled:opacity-50 flex items-center gap-1"
                      >
                        <Fingerprint className="w-3 h-3" />
                        {biometricRegistering ? 'Registering…' : 'Register This Device'}
                      </button>
                    </div>
                    {(biometricCreds[u.id] ?? []).length === 0 ? (
                      <p className="text-xs text-gray-500">No biometric devices registered yet.</p>
                    ) : (
                      <div className="space-y-1">
                        {(biometricCreds[u.id] ?? []).map(cred => (
                          <div key={cred.id} className="flex items-center justify-between text-xs">
                            <span className="text-gray-700 dark:text-gray-300">{cred.deviceName} — <span className="text-gray-400">{new Date(cred.createdAt).toLocaleDateString()}</span></span>
                            <button
                              onClick={() => void handleDeleteBiometric(cred.id, u.id)}
                              className="text-red-500 hover:text-red-700 p-0.5"
                              title="Remove credential"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {users.length === 0 && (
              <div className="p-8 text-center text-gray-400">
                <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
                No staff members yet
              </div>
            )}
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-700">
            <strong>Tip:</strong> Cashiers, Waiters, and Kitchen Staff log in with a PIN at the
            POS terminal. Managers and Accountants use email + password.
            {['PRO', 'ENTERPRISE'].includes(settings?.subscriptionTier ?? '') && (
              <span> Staff can also use <strong>Fingerprint / Face ID</strong> — click the <Fingerprint className="inline w-3.5 h-3.5 mx-0.5" /> icon on each user to register their device.</span>
            )}
          </div>
        </div>
        );
      })()}

      {/* ── Stores Tab ────────────────────────────────────────────────────── */}
      {activeTab === 'stores' && (() => {
        const STORE_LIMITS: Record<string, number> = { FREE: 1, STARTER: 1, GROWTH: 2, PRO: 5, ENTERPRISE: Infinity };
        const currentTierS = settings?.subscriptionTier ?? 'STARTER';
        const storeLimit = STORE_LIMITS[currentTierS] ?? 1;
        const storeCount = (settings?.stores ?? []).length;
        const atLimitS = storeLimit !== Infinity && storeCount >= storeLimit;
        const nearLimitS = !atLimitS && storeLimit !== Infinity && storeCount / storeLimit >= 0.8;
        return (
        <div className="space-y-4">
          {atLimitS && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              Store limit reached for {currentTierS} plan ({storeLimit} store{storeLimit !== 1 ? 's' : ''}). Upgrade to add more stores.
            </div>
          )}
          {nearLimitS && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              You're using {storeCount} of {storeLimit} store slots on your {currentTierS} plan.
            </div>
          )}
          <div className="bg-white rounded-xl shadow divide-y">
            {(settings?.stores ?? []).map((store) => (
              <div key={store.id} className="p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium">{store.name}</p>
                  <p className="text-sm text-gray-500">Code: {store.storeCode}</p>
                </div>
              </div>
            ))}
            {storeCount === 0 && (
              <div className="p-8 text-center text-gray-400">No stores configured</div>
            )}
          </div>

          {!atLimitS && (
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="font-semibold mb-4">Add New Store</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label htmlFor="f-store-name" className="block text-sm font-medium text-gray-700 mb-1">Store Name</label>
                <input id="f-store-name"
                  type="text"
                  value={newStore.name}
                  onChange={(e) => setNewStore((s) => ({ ...s, name: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Main Branch"
                />
              </div>
              <div>
                <label htmlFor="f-store-code" className="block text-sm font-medium text-gray-700 mb-1">Store Code</label>
                <input id="f-store-code"
                  type="text"
                  value={newStore.storeCode}
                  onChange={(e) =>
                    setNewStore((s) => ({ ...s, storeCode: e.target.value.toUpperCase() }))
                  }
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="NRB01"
                  maxLength={8}
                />
              </div>
            </div>
            <button
              onClick={() => createStoreMutation.mutate(newStore)}
              disabled={!newStore.name || !newStore.storeCode || createStoreMutation.isPending}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {createStoreMutation.isPending ? 'Creating...' : 'Create Store'}
            </button>
          </div>
          )}
        </div>
        );
      })()}

      {/* ── KRA eTIMS Tab ─────────────────────────────────────────────────── */}
      {activeTab === 'etims' && (
        <div className="space-y-4">
          <div
            className={`p-4 rounded-lg border ${
              settings?.hasEtimsCredentials
                ? 'bg-green-50 border-green-200'
                : 'bg-yellow-50 border-yellow-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {settings?.hasEtimsCredentials ? (
                <>
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <span className="font-medium text-green-700">eTIMS credentials configured</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-5 h-5 text-yellow-600" />
                  <span className="font-medium text-yellow-700">eTIMS not configured</span>
                </>
              )}
            </div>
            <p className="text-sm mt-1 text-gray-600">
              {settings?.hasEtimsCredentials
                ? 'Your KRA eTIMS credentials are saved. Re-enter below to update them.'
                : 'Enter your KRA eTIMS credentials to enable automatic fiscal receipt submission.'}
            </p>
          </div>

          <div className="bg-white rounded-xl shadow p-6 space-y-4">
            <h3 className="font-semibold">KRA eTIMS Credentials</h3>
            <p className="text-sm text-gray-500">
              Obtain these from the KRA eTIMS portal at{' '}
              <span className="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded">
                etims.kra.go.ke
              </span>
            </p>

            <div>
              <label htmlFor="f-branch-id-bhfid" className="block text-sm font-medium text-gray-700 mb-1">
                Branch ID (BhfId)
              </label>
              <input id="f-branch-id-bhfid"
                type="text"
                value={etimsForm.bhfId}
                onChange={(e) => setEtimsForm((f) => ({ ...f, bhfId: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 font-mono"
                placeholder="e.g. 00"
              />
            </div>

            <div>
              <label htmlFor="f-tax-identification-number-tin" className="block text-sm font-medium text-gray-700 mb-1">
                Tax Identification Number (TIN)
              </label>
              <input id="f-tax-identification-number-tin"
                type="text"
                value={etimsForm.tin}
                onChange={(e) => setEtimsForm((f) => ({ ...f, tin: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 font-mono"
                placeholder="e.g. P000000000M"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Device Serial No. <span className="text-gray-400 font-normal">(dvcSrno)</span>
              </label>
              <input
                type="text"
                value={etimsForm.dvcSrno}
                onChange={(e) => setEtimsForm((f) => ({ ...f, dvcSrno: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 font-mono"
                placeholder="e.g. VSCU12345678"
              />
              <p className="text-xs text-gray-400 mt-1">
                Assigned by KRA when you register your device on the eTIMS portal. Credentials are encrypted with AES-256 before storage.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => saveEtimsMutation.mutate(etimsForm)}
                disabled={
                  !etimsForm.bhfId ||
                  !etimsForm.tin ||
                  !etimsForm.dvcSrno ||
                  saveEtimsMutation.isPending
                }
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                <Shield className="w-4 h-4" />
                {saveEtimsMutation.isPending ? 'Saving...' : 'Save eTIMS Credentials'}
              </button>
              {etimsSaved && (
                <span className="flex items-center gap-1.5 text-green-600 text-sm">
                  <CheckCircle className="w-4 h-4" /> Saved securely
                </span>
              )}
            </div>
          </div>

          {/* eTIMS Pending Queue */}
          <div className="bg-white rounded-xl shadow p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Pending KRA Submissions</h3>
              <div className="flex items-center gap-2">
                {etimsPendingSales && (
                  <span className={`text-sm font-medium px-2.5 py-1 rounded-full ${
                    (etimsPendingSales.total ?? 0) > 0
                      ? 'bg-red-100 text-red-700'
                      : 'bg-green-100 text-green-700'
                  }`}>
                    {etimsPendingSales.total ?? 0} pending
                  </span>
                )}
                {(etimsPendingSales?.total ?? 0) > 0 && (
                  <button
                    onClick={() => batchSubmitEtims.mutate()}
                    disabled={batchSubmitEtims.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Zap className={`w-4 h-4 ${batchSubmitEtims.isPending ? 'animate-pulse' : ''}`} />
                    {batchSubmitEtims.isPending ? 'Submitting…' : 'Submit All'}
                  </button>
                )}
              </div>
            </div>
            {batchSubmitResult && (
              <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${batchSubmitResult.failed === 0 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                Batch complete: {batchSubmitResult.submitted} submitted, {batchSubmitResult.failed} failed
              </div>
            )}
            {!etimsPendingSales?.data?.length ? (
              <div className="text-center py-6 text-gray-400">
                <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-400" />
                <p className="text-sm">All sales submitted to KRA</p>
              </div>
            ) : (
              <div className="divide-y border rounded-lg overflow-hidden">
                {etimsPendingSales.data.map((sale) => (
                  <div key={sale.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <div className="font-medium text-sm">{sale.receiptNumber}</div>
                      <div className="text-xs text-gray-400">
                        {new Date(sale.createdAt).toLocaleString('en-KE')} · KES {(sale.totalCents / 100).toFixed(2)}
                      </div>
                    </div>
                    <button
                      onClick={() => submitEtimsManual.mutate(sale.id)}
                      disabled={submitEtimsManual.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${submitEtimsManual.isPending ? 'animate-spin' : ''}`} />
                      Submit to KRA
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── M-Pesa Tab ────────────────────────────────────────────────────── */}
      {activeTab === 'mpesa' && (
        <div className="space-y-4">
          <div
            className={`p-4 rounded-lg border ${
              settings?.hasMpesaCredentials
                ? 'bg-green-50 border-green-200'
                : 'bg-yellow-50 border-yellow-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {settings?.hasMpesaCredentials ? (
                <>
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <span className="font-medium text-green-700">M-Pesa credentials configured</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-5 h-5 text-yellow-600" />
                  <span className="font-medium text-yellow-700">M-Pesa not configured</span>
                </>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-6 space-y-4">
            <h3 className="font-semibold">Safaricom Daraja API Credentials</h3>
            <p className="text-sm text-gray-500">
              Obtain from the Safaricom Daraja portal. Required for M-Pesa STK Push payments.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="f-consumer-key" className="block text-sm font-medium text-gray-700 mb-1">
                  Consumer Key
                </label>
                <input id="f-consumer-key"
                  type="password"
                  value={mpesaForm.consumerKey}
                  onChange={(e) => setMpesaForm((f) => ({ ...f, consumerKey: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  placeholder="Daraja consumer key"
                />
              </div>
              <div>
                <label htmlFor="f-consumer-secret" className="block text-sm font-medium text-gray-700 mb-1">
                  Consumer Secret
                </label>
                <input id="f-consumer-secret"
                  type="password"
                  value={mpesaForm.consumerSecret}
                  onChange={(e) =>
                    setMpesaForm((f) => ({ ...f, consumerSecret: e.target.value }))
                  }
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  placeholder="Daraja consumer secret"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="f-shortcode-till-paybill" className="block text-sm font-medium text-gray-700 mb-1">
                  Shortcode (Till/Paybill)
                </label>
                <input id="f-shortcode-till-paybill"
                  type="text"
                  value={mpesaForm.shortcode}
                  onChange={(e) => setMpesaForm((f) => ({ ...f, shortcode: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 font-mono"
                  placeholder="e.g. 174379"
                />
              </div>
              <div>
                <label htmlFor="f-lipa-na-m-pesa-passkey" className="block text-sm font-medium text-gray-700 mb-1">
                  Lipa na M-Pesa Passkey
                </label>
                <input id="f-lipa-na-m-pesa-passkey"
                  type="password"
                  value={mpesaForm.passkey}
                  onChange={(e) => setMpesaForm((f) => ({ ...f, passkey: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  placeholder="Your LNM passkey"
                />
              </div>
            </div>

            <div>
              <label htmlFor="f-callback-url" className="block text-sm font-medium text-gray-700 mb-1">
                Callback URL
              </label>
              <input id="f-callback-url"
                type="url"
                value={mpesaForm.callbackUrl}
                onChange={(e) => setMpesaForm((f) => ({ ...f, callbackUrl: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                placeholder="https://your-api.com/api/payments/mpesa/callback"
              />
              <p className="text-xs text-gray-400 mt-1">
                Must be a publicly accessible HTTPS URL
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => saveMpesaMutation.mutate(mpesaForm)}
                disabled={
                  !mpesaForm.consumerKey ||
                  !mpesaForm.shortcode ||
                  saveMpesaMutation.isPending
                }
                className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
              >
                <Smartphone className="w-4 h-4" />
                {saveMpesaMutation.isPending ? 'Saving...' : 'Save M-Pesa Credentials'}
              </button>
              {mpesaSaved && (
                <span className="flex items-center gap-1.5 text-green-600 text-sm">
                  <CheckCircle className="w-4 h-4" /> Saved securely
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Subscription Tab ──────────────────────────────────────────────── */}
      {activeTab === 'subscription' && (() => {
        const handleUpgrade = async (tier: string) => {
          if (!businessId) return;
          setUpgradingTier(tier);
          try {
            const res = await api.post<{ authorizationUrl: string | null; reference: string | null }>(
              '/subscription/checkout',
              { tier, email: user?.email ?? '' },
            );
            if (res.authorizationUrl) {
              window.location.href = res.authorizationUrl;
            } else {
              toast.success('Plan activated!');
              window.location.reload();
            }
          } catch (err: any) {
            toast.error(err?.message ?? 'Could not initiate checkout. Please try again.');
          } finally {
            setUpgradingTier(null);
          }
        };
        const PLAN_LIMITS: Record<string, { stores: number; users: number }> = {
          FREE:       { stores: 1, users: 1 },
          STARTER:    { stores: 1, users: 8 },
          GROWTH:     { stores: 2, users: 15 },
          PRO:        { stores: 5, users: 30 },
          ENTERPRISE: { stores: Infinity, users: Infinity },
        };
        const PLANS = [
          {
            tier: 'FREE',
            label: 'Free',
            price: 'KES 0/mo',
            features: ['1 store', '1 user', 'Basic POS (cash only)', 'Basic inventory', 'Sales history'],
          },
          {
            tier: 'STARTER',
            label: 'Starter',
            price: 'KES 999/mo',
            features: ['1 store', '8 users', 'Full POS + M-Pesa', 'KRA eTIMS', 'Full reports', 'Offline + PWA'],
          },
          {
            tier: 'GROWTH',
            label: 'Growth',
            price: 'KES 2,499/mo',
            features: ['2 stores', '15 users', 'Hospitality (tables/KOT)', 'Suppliers & POs', 'Promotions & gift cards', 'WhatsApp & SMS receipts'],
          },
          {
            tier: 'PRO',
            label: 'Pro',
            price: 'KES 4,999/mo',
            features: ['5 stores', '30 users', 'Full HR + Kenya payroll', 'Bank reconciliation', 'Webhooks & API keys', 'Budget & expense approvals'],
          },
          {
            tier: 'ENTERPRISE',
            label: 'Enterprise',
            price: 'KES 14,999/mo',
            features: ['Unlimited stores & users', 'Field sales & agents', 'Hotel management', 'Franchise network', 'AI forecasting', 'Accounting integrations'],
          },
        ];
        const currentTier = subscription?.subscriptionTier ?? 'STARTER';
        const limits = PLAN_LIMITS[currentTier] ?? PLAN_LIMITS['STARTER'];
        const storeCount = settings?.stores?.length ?? 0;
        const userCount = users.length;
        const storePct = limits.stores === Infinity ? 0 : Math.round((storeCount / limits.stores) * 100);
        const userPct = limits.users === Infinity ? 0 : Math.round((userCount / limits.users) * 100);
        const atStoreLimit = limits.stores !== Infinity && storeCount >= limits.stores;
        const atUserLimit = limits.users !== Infinity && userCount >= limits.users;
        const nearStoreLimit = !atStoreLimit && storePct >= 80;
        const nearUserLimit = !atUserLimit && userPct >= 80;

        const barColor = (pct: number) =>
          pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-blue-500';

        return (
          <div className="space-y-5">
            {/* Payment verification banner */}
            {verifyState === 'verifying' && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3 text-sm text-blue-700">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                Confirming your payment, please wait…
              </div>
            )}
            {verifyState === 'success' && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3 text-sm text-green-700">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                Payment confirmed — your plan has been upgraded!
              </div>
            )}
            {verifyState === 'failed' && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
                We couldn't confirm your payment yet. If you were charged, it will activate within a few minutes — check back shortly or contact support.
              </div>
            )}

            {/* Header card */}
            <div className="bg-white rounded-xl shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm text-gray-500 mb-0.5">Current Plan</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {PLANS.find((p) => p.tier === currentTier)?.label ?? currentTier}
                  </p>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium ${
                    subscription?.subscriptionStatus === 'ACTIVE'
                      ? 'bg-green-100 text-green-700'
                      : subscription?.subscriptionStatus === 'TRIAL'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-red-100 text-red-700'
                  }`}
                >
                  {subscription?.subscriptionStatus ?? 'TRIAL'}
                </span>
              </div>

              {/* Trial banner */}
              {subscription?.subscriptionStatus === 'TRIAL' && (
                <div className={`rounded-lg p-3 mb-4 ${subscription?.isTrialExpired ? 'bg-red-50 border border-red-200' : 'bg-blue-50 border border-blue-200'}`}>
                  <p className={`font-medium text-sm ${subscription?.isTrialExpired ? 'text-red-700' : 'text-blue-700'}`}>
                    {subscription?.isTrialExpired
                      ? 'Your trial has expired — upgrade to continue'
                      : `${subscription?.daysRemaining ?? 0} days remaining in trial`}
                  </p>
                </div>
              )}

              {/* Usage meters */}
              <div className="space-y-4">
                <p className="text-sm font-medium text-gray-700">Usage</p>

                {/* Stores */}
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">Stores</span>
                    <span className={`font-medium ${atStoreLimit ? 'text-red-600' : nearStoreLimit ? 'text-amber-600' : 'text-gray-700'}`}>
                      {storeCount} / {limits.stores === Infinity ? '∞' : limits.stores}
                    </span>
                  </div>
                  {limits.stores !== Infinity && (
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${barColor(storePct)}`}
                        style={{ width: `${Math.min(storePct, 100)}%` }}
                      />
                    </div>
                  )}
                  {atStoreLimit && (
                    <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> Store limit reached — upgrade to add more stores
                    </p>
                  )}
                  {nearStoreLimit && (
                    <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> Approaching store limit
                    </p>
                  )}
                </div>

                {/* Users */}
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">Users</span>
                    <span className={`font-medium ${atUserLimit ? 'text-red-600' : nearUserLimit ? 'text-amber-600' : 'text-gray-700'}`}>
                      {userCount} / {limits.users === Infinity ? '∞' : limits.users}
                    </span>
                  </div>
                  {limits.users !== Infinity && (
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${barColor(userPct)}`}
                        style={{ width: `${Math.min(userPct, 100)}%` }}
                      />
                    </div>
                  )}
                  {atUserLimit && (
                    <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> User limit reached — upgrade to add more staff
                    </p>
                  )}
                  {nearUserLimit && (
                    <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> Approaching user limit
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Plan grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {PLANS.map((plan) => {
                const isCurrent = currentTier === plan.tier;
                return (
                  <div
                    key={plan.tier}
                    className={`border rounded-xl p-5 relative ${
                      isCurrent ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-400' : 'border-gray-200 bg-white'
                    }`}
                  >
                    {isCurrent && (
                      <span className="absolute -top-2.5 left-4 bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full font-medium">
                        Your Plan
                      </span>
                    )}
                    <h4 className="font-bold text-gray-900 mb-0.5">{plan.label}</h4>
                    <p className="text-blue-600 font-semibold text-sm mb-3">{plan.price}</p>
                    <ul className="space-y-1.5 mb-4">
                      {plan.features.map((f) => (
                        <li key={f} className="text-sm text-gray-600 flex items-center gap-1.5">
                          <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <button
                      disabled={isCurrent || upgradingTier === plan.tier}
                      onClick={() => !isCurrent && handleUpgrade(plan.tier)}
                      className={`w-full py-2 text-sm font-medium rounded-lg transition-colors ${
                        isCurrent
                          ? 'bg-blue-100 text-blue-700 cursor-default'
                          : upgradingTier === plan.tier
                          ? 'bg-blue-600 text-white opacity-70 cursor-wait'
                          : 'border border-blue-600 text-blue-600 hover:bg-blue-600 hover:text-white'
                      }`}
                    >
                      {isCurrent ? 'Current Plan' : upgradingTier === plan.tier ? 'Redirecting…' : 'Upgrade'}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* ── Cancel subscription ───────────────────────────────────────── */}
            {subscription?.subscriptionStatus !== 'CANCELLED' && (
              <div className="bg-white rounded-xl shadow p-6 border border-red-100">
                <h4 className="font-semibold text-gray-900 mb-1">Cancel Subscription</h4>
                <p className="text-sm text-gray-500 mb-4">
                  Cancelling will downgrade your account at the end of the current billing period. Your data is preserved and you can resubscribe at any time.
                </p>
                <button
                  onClick={() => { setShowCancelModal(true); setCancelReason(''); setCancelConfirmText(''); setCancelDone(false); }}
                  className="px-4 py-2 border border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors"
                >
                  Cancel Subscription
                </button>
              </div>
            )}

            {subscription?.subscriptionStatus === 'CANCELLED' && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
                Your subscription has been cancelled. Contact support to reactivate.
              </div>
            )}

            {/* Cancel modal */}
            {showCancelModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
                  {cancelDone ? (
                    <div className="text-center py-4">
                      <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
                        <CheckCircle className="w-6 h-6 text-gray-500" />
                      </div>
                      <h3 className="font-bold text-gray-900 mb-1">Subscription Cancelled</h3>
                      <p className="text-sm text-gray-500 mb-4">We're sorry to see you go. Your data remains intact.</p>
                      <button onClick={() => { setShowCancelModal(false); }} className="px-5 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium">Close</button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h3 className="font-bold text-gray-900">Cancel Subscription</h3>
                          <p className="text-sm text-gray-500 mt-0.5">Help us improve — tell us why you're leaving</p>
                        </div>
                        <button onClick={() => setShowCancelModal(false)} className="text-gray-400 hover:text-gray-600">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>

                      {/* Reason selection */}
                      <div className="space-y-2 mb-5">
                        {[
                          { value: 'PRICE',           label: 'Too expensive',                icon: Wallet },
                          { value: 'COMPETITOR',      label: 'Switching to a competitor',    icon: RefreshCw },
                          { value: 'MISSING_FEATURE', label: 'Missing a feature I need',     icon: Puzzle },
                          { value: 'POOR_SUPPORT',    label: 'Poor customer support',        icon: Headphones },
                          { value: 'OTHER',           label: 'Other reason',                 icon: MessageCircle },
                        ].map(r => (
                          <label key={r.value} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${cancelReason === r.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                            <input
                              type="radio"
                              name="cancelReason"
                              value={r.value}
                              checked={cancelReason === r.value}
                              onChange={() => setCancelReason(r.value)}
                              className="accent-blue-600"
                            />
                            <r.icon className="w-4 h-4 text-gray-500 shrink-0" aria-hidden="true" />
                            <span className="text-sm font-medium text-gray-700">{r.label}</span>
                          </label>
                        ))}
                      </div>

                      {/* Confirm text */}
                      <div className="mb-5">
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                          Type <strong>CANCEL</strong> to confirm
                        </label>
                        <input
                          value={cancelConfirmText}
                          onChange={e => setCancelConfirmText(e.target.value)}
                          placeholder="CANCEL"
                          className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-red-400 focus:border-red-400"
                        />
                      </div>

                      <div className="flex gap-3">
                        <button
                          onClick={() => setShowCancelModal(false)}
                          className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Keep Subscription
                        </button>
                        <button
                          disabled={!cancelReason || cancelConfirmText !== 'CANCEL' || cancelSubmitting}
                          onClick={async () => {
                            setCancelSubmitting(true);
                            try {
                              await api.post(`/business/${businessId}/cancel-subscription`, { reason: cancelReason });
                              setCancelDone(true);
                            } catch (e: any) {
                              showNotification(e.message ?? 'Failed to cancel', 'error');
                            } finally {
                              setCancelSubmitting(false);
                            }
                          }}
                          className="flex-1 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          {cancelSubmitting ? 'Cancelling…' : 'Yes, Cancel'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
        </div>
        );
      })()}

      {/* ── Messaging Tab (Africa's Talking) ────────────────────────────── */}
      {activeTab === 'messaging' && (
        <div className="space-y-4">
          <div className={`p-4 rounded-lg border ${
            settings?.hasAtCredentials ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'
          }`}>
            <div className="flex items-center gap-2">
              {settings?.hasAtCredentials ? (
                <><CheckCircle className="w-5 h-5 text-green-600" /><span className="font-medium text-green-700">Africa's Talking configured</span></>
              ) : (
                <><AlertCircle className="w-5 h-5 text-yellow-600" /><span className="font-medium text-yellow-700">Messaging not configured</span></>
              )}
            </div>
            <p className="text-sm mt-1 text-gray-600">
              Configure Africa's Talking to send WhatsApp and SMS receipts to customers.
              Get credentials at{' '}<span className="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded">africastalking.com</span>
            </p>
          </div>

          <div className="bg-white rounded-xl shadow p-6 space-y-4">
            <h3 className="font-semibold">Africa's Talking API Credentials</h3>
            <div>
              <label htmlFor="f-api-key" className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
              <input id="f-api-key"
                type="password"
                value={atForm.apiKey}
                onChange={(e) => setAtForm((f) => ({ ...f, apiKey: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                placeholder="Your AT API key"
              />
            </div>
            <div>
              <label htmlFor="f-username" className="block text-sm font-medium text-gray-700 mb-1">Username</label>
              <input id="f-username"
                type="text"
                value={atForm.username}
                onChange={(e) => setAtForm((f) => ({ ...f, username: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                placeholder="sandbox or your AT username"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sender ID <span className="text-gray-400 font-normal">(optional)</span></label>
              <input
                type="text"
                value={atForm.senderId}
                onChange={(e) => setAtForm((f) => ({ ...f, senderId: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. POSKENYA (alphanumeric, max 11 chars)"
                maxLength={11}
              />
              <p className="text-xs text-gray-400 mt-1">Custom sender name on SMS. Leave blank to use shortcode.</p>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => saveAtMutation.mutate(atForm)}
                disabled={!atForm.apiKey || !atForm.username || saveAtMutation.isPending}
                className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 disabled:opacity-50"
              >
                <MessageSquare className="w-4 h-4" />
                {saveAtMutation.isPending ? 'Saving...' : 'Save Messaging Credentials'}
              </button>
              {atSaved && (
                <span className="flex items-center gap-1.5 text-green-600 text-sm">
                  <CheckCircle className="w-4 h-4" /> Saved securely
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Loyalty Tab ──────────────────────────────────────────────────── */}
      {activeTab === 'loyalty' && (
        <div className="space-y-4">
          {loyaltyProgram && (
            <div className="p-4 rounded-lg border bg-green-50 border-green-200">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <span className="font-medium text-green-700">Loyalty program active: {loyaltyProgram.name}</span>
              </div>
              <p className="text-sm text-gray-600 mt-1">
                1 pt per KES {loyaltyProgram.kesPerPoint} spent · 1 pt = KES {(loyaltyProgram.pointValueCents / 100).toFixed(2)} discount · Min {loyaltyProgram.minRedemption} pts to redeem
              </p>
            </div>
          )}

          <div className="bg-white rounded-xl shadow p-6 space-y-4">
            <h3 className="font-semibold">{loyaltyProgram ? 'Update' : 'Create'} Loyalty Program</h3>
            <p className="text-sm text-gray-500">
              Customers earn points on purchases and can redeem them for discounts at checkout.
            </p>
            <div>
              <label htmlFor="f-program-name" className="block text-sm font-medium text-gray-700 mb-1">Program Name</label>
              <input id="f-program-name"
                type="text"
                value={loyaltyForm.name}
                onChange={(e) => setLoyaltyForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Customer Loyalty"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label htmlFor="f-kes-spent-per-1-point" className="block text-sm font-medium text-gray-700 mb-1">KES spent per 1 point</label>
                <input id="f-kes-spent-per-1-point"
                  type="number"
                  min={1}
                  step={1}
                  value={loyaltyForm.kesPerPoint}
                  onChange={(e) => setLoyaltyForm((f) => ({ ...f, kesPerPoint: Number(e.target.value) }))}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1">
                  KES 100 sale = {loyaltyForm.kesPerPoint > 0 ? Math.floor(100 / loyaltyForm.kesPerPoint) : 0} pts
                </p>
              </div>
              <div>
                <label htmlFor="f-1-point-value-kes-cents" className="block text-sm font-medium text-gray-700 mb-1">1 point value (KES cents)</label>
                <input id="f-1-point-value-kes-cents"
                  type="number"
                  min={1}
                  step={1}
                  value={loyaltyForm.pointValueCents}
                  onChange={(e) => setLoyaltyForm((f) => ({ ...f, pointValueCents: Number(e.target.value) }))}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1">
                  100 pts = KES {loyaltyForm.pointValueCents > 0 ? (100 * loyaltyForm.pointValueCents / 100).toFixed(2) : '0.00'} discount
                </p>
              </div>
              <div>
                <label htmlFor="f-min-points-to-redeem" className="block text-sm font-medium text-gray-700 mb-1">Min points to redeem</label>
                <input id="f-min-points-to-redeem"
                  type="number"
                  min={1}
                  step={10}
                  value={loyaltyForm.minRedemption}
                  onChange={(e) => setLoyaltyForm((f) => ({ ...f, minRedemption: Number(e.target.value) }))}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => saveLoyaltyMutation.mutate(loyaltyForm)}
                disabled={!loyaltyForm.name || saveLoyaltyMutation.isPending}
                className="flex items-center gap-2 px-5 py-2.5 bg-yellow-500 text-white rounded-lg font-medium hover:bg-yellow-600 disabled:opacity-50"
              >
                <Star className="w-4 h-4" />
                {saveLoyaltyMutation.isPending ? 'Saving...' : 'Save Loyalty Program'}
              </button>
              {loyaltySaved && (
                <span className="flex items-center gap-1.5 text-green-600 text-sm">
                  <CheckCircle className="w-4 h-4" /> Saved
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Loyalty Tiers Tab ────────────────────────────────────────────── */}
      {activeTab === 'loyalty-tiers' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-gray-800">Loyalty Tiers</h3>
              <p className="text-sm text-gray-500 mt-0.5">Define Bronze/Silver/Gold tiers by points threshold</p>
            </div>
            <button
              onClick={() => setShowAddTier(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              <Plus className="w-4 h-4" /> Add Tier
            </button>
          </div>

          {showAddTier && (
            <div className="bg-white border rounded-xl p-5 shadow-sm">
              <h4 className="font-medium text-gray-800 mb-4">New Tier</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="f-name-2" className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
                  <input id="f-name-2"
                    type="text"
                    value={tierForm.name}
                    onChange={(e) => setTierForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Bronze"
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="f-min-points" className="block text-xs font-medium text-gray-600 mb-1">Min Points *</label>
                  <input id="f-min-points"
                    type="number"
                    min={0}
                    value={tierForm.minPoints}
                    onChange={(e) => setTierForm((f) => ({ ...f, minPoints: e.target.value }))}
                    placeholder="0"
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="f-multiplier-earning-rate" className="block text-xs font-medium text-gray-600 mb-1">Multiplier (earning rate)</label>
                  <input id="f-multiplier-earning-rate"
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={tierForm.multiplier}
                    onChange={(e) => setTierForm((f) => ({ ...f, multiplier: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="f-color" className="block text-xs font-medium text-gray-600 mb-1">Color</label>
                  <select id="f-color"
                    value={tierForm.color}
                    onChange={(e) => setTierForm((f) => ({ ...f, color: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  >
                    {['gray', 'yellow', 'orange', 'blue', 'purple', 'green'].map((c) => (
                      <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2 mt-4 justify-end">
                <button onClick={() => setShowAddTier(false)} className="px-4 py-2 text-sm text-gray-600 border rounded-lg">Cancel</button>
                <button
                  disabled={!tierForm.name || !tierForm.minPoints}
                  onClick={() => {
                    api.post('/loyalty/tiers', {
                      businessId,
                      name: tierForm.name,
                      minPoints: Number(tierForm.minPoints),
                      multiplier: Number(tierForm.multiplier),
                      color: tierForm.color,
                    }).then(() => {
                      void queryClient.invalidateQueries({ queryKey: ['loyalty-tiers', businessId] });
                      void refetchTiers();
                      setTierForm({ name: '', minPoints: '', multiplier: '1', color: 'gray' });
                      setShowAddTier(false);
                    }).catch(() => {});
                  }}
                  className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  Create Tier
                </button>
              </div>
            </div>
          )}

          {loyaltyTiers.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl border">
              <Star className="w-10 h-10 mx-auto mb-3 text-gray-300" />
              <p className="text-gray-500 text-sm">No tiers configured. Add your first tier.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {loyaltyTiers.map((tier) => (
                <div key={tier.id} className="bg-white border rounded-xl p-4 flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full bg-${tier.color}-100 flex items-center justify-center text-${tier.color}-600 font-bold text-sm flex-shrink-0`}>
                    {tier.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-gray-800">{tier.name}</div>
                    <div className="text-xs text-gray-500">
                      Min {tier.minPoints.toLocaleString()} pts · {tier.multiplier}× multiplier
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      api.delete(`/loyalty/tiers/${tier.id}`)
                        .then(() => { void queryClient.invalidateQueries({ queryKey: ['loyalty-tiers', businessId] }); void refetchTiers(); })
                        .catch(() => {});
                    }}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg" aria-label="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Paystack POS Key */}
          <div className="bg-white border rounded-xl p-5 mt-6">
            <h4 className="font-semibold text-gray-800 mb-1">Paystack POS Public Key</h4>
            <p className="text-sm text-gray-500 mb-3">Required for card payments via Paystack Inline at checkout.</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={paystackPublicKeyInput || (settings as { paystackPublicKey?: string })?.paystackPublicKey || ''}
                onChange={(e) => setPaystackPublicKeyInput(e.target.value)}
                placeholder="pk_live_xxxxxxxxxxxxxxxx"
                className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono"
              />
              <button
                onClick={() => {
                  api.patch(`/business/${businessId}/settings`, { paystackPublicKey: paystackPublicKeyInput })
                    .then(() => { void queryClient.invalidateQueries({ queryKey: ['business-settings', businessId] }); setPaystackPublicKeyInput(''); })
                    .catch(() => {});
                }}
                disabled={!paystackPublicKeyInput}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── KDPA Tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'kdpa' && (
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold text-gray-800">KDPA Data Deletion Requests</h3>
            <p className="text-sm text-gray-500 mt-0.5">Kenya Data Protection Act compliance — manage customer data erasure requests</p>
          </div>

          {kdpaRequests.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl border">
              <Shield className="w-10 h-10 mx-auto mb-3 text-gray-300" />
              <p className="text-gray-500 text-sm">No deletion requests received.</p>
              <p className="text-xs text-gray-400 mt-1">Requests submitted by customers will appear here for your review.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {kdpaRequests.map((req) => (
                <div key={req.id} className="bg-white border rounded-xl p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium text-gray-800">{req.requestedBy}</div>
                      {req.reason && <div className="text-sm text-gray-500 mt-0.5">"{req.reason}"</div>}
                      <div className="text-xs text-gray-400 mt-1">{new Date(req.createdAt).toLocaleDateString('en-KE')}</div>
                    </div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                      req.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700'
                      : req.status === 'COMPLETED' ? 'bg-green-100 text-green-700'
                      : req.status === 'REJECTED' ? 'bg-red-100 text-red-600'
                      : 'bg-gray-100 text-gray-600'
                    }`}>
                      {req.status}
                    </span>
                  </div>
                  {req.status === 'PENDING' && (
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => {
                          api.patch(`/kdpa/requests/${req.id}`, {
                            action: 'APPROVED',
                            reviewedBy: user?.id,
                            reviewNotes: 'Approved via Settings',
                          }).then(() => { void refetchKdpa(); }).catch(() => {});
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700"
                      >
                        <CheckCircle className="w-3.5 h-3.5" /> Approve & Anonymise
                      </button>
                      <button
                        onClick={() => {
                          api.patch(`/kdpa/requests/${req.id}`, {
                            action: 'REJECTED',
                            reviewedBy: user?.id,
                            reviewNotes: 'Rejected — insufficient grounds',
                          }).then(() => { void refetchKdpa(); }).catch(() => {});
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-red-300 text-red-600 rounded-lg hover:bg-red-50"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Printers Tab ─────────────────────────────────────────────────── */}
      {activeTab === 'printers' && (
        <div className="space-y-4">
          {/* Per-terminal receipt printer: pair once, then every sale prints with no picker */}
          <ReceiptPrinterSettings businessName={settings?.name} printers={printers} />

          <div className="flex items-center justify-between pt-2">
            <p className="text-sm text-gray-500">{printers.length} routing printer(s) configured</p>
            <button
              onClick={() => setShowAddPrinter(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              <Plus className="w-4 h-4" />
              Add Printer
            </button>
          </div>

          {(() => {
            const PRINTER_HANDLES = ['KOT_FOOD', 'KOT_DRINKS', 'KOT_DESSERTS', 'BILL', 'RECEIPT', 'REPORTS', 'LABELS'];
            return (
              <div className="bg-white rounded-xl shadow divide-y">
                {printers.map((p) => {
                  const currentHandles: string[] = (() => { try { return JSON.parse(p.handles); } catch { return [p.handles]; } })();
                  return (
                    <div key={p.id} className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Printer className="w-5 h-5 text-gray-400" />
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-sm">{p.name}</p>
                              {p.isDefault && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Default</span>}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-gray-500">{p.connectionType}</span>
                              {p.connectionDetails && <span className="text-xs text-gray-400">{p.connectionDetails}</span>}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            showConfirm(
                              'Remove Printer',
                              `Remove "${p.name}" from your printer configuration?`,
                              () => deletePrinterMutation.mutate(p.id),
                            )
                          }
                          className="text-gray-400 hover:text-red-600 p-1" aria-label="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="mt-2 ml-8">
                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Routing (handles):</label>
                        <div className="flex flex-wrap gap-1.5">
                          {PRINTER_HANDLES.map((handle) => {
                            const isSelected = currentHandles.includes(handle);
                            return (
                              <button
                                key={handle}
                                onClick={() => {
                                  const newHandles = isSelected
                                    ? currentHandles.filter((h: string) => h !== handle)
                                    : [...currentHandles, handle];
                                  api.patch(`/printers/${p.id}`, { handles: JSON.stringify(newHandles) })
                                    .then(() => queryClient.invalidateQueries({ queryKey: ['printers'] }));
                                }}
                                className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                                  isSelected
                                    ? 'bg-blue-600 text-white border-blue-600'
                                    : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300'
                                }`}
                              >
                                {handle}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {printers.length === 0 && (
                  <div className="p-8 text-center text-gray-400">
                    <Printer className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    No printers configured
                  </div>
                )}
              </div>
            );
          })()}

          {showAddPrinter && (
            <div className="bg-white rounded-xl shadow p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Add Printer</h3>
                <button onClick={() => setShowAddPrinter(false)} aria-label="Close"><X className="w-4 h-4 text-gray-400" /></button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="f-name" className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input id="f-name"
                    type="text"
                    value={printerForm.name}
                    onChange={(e) => setPrinterForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. Receipt Printer"
                  />
                </div>
                <div>
                  <label htmlFor="f-connection-type" className="block text-sm font-medium text-gray-700 mb-1">Connection Type</label>
                  <select id="f-connection-type"
                    value={printerForm.connectionType}
                    onChange={(e) => setPrinterForm((f) => ({ ...f, connectionType: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
                    <option value="USB">USB (WebUSB — ESC/POS)</option>
                    <option value="BLUETOOTH">Bluetooth (ESC/POS)</option>
                    <option value="NETWORK">Network IP (ESC/POS proxy)</option>
                    <option value="STAR">Star WebPRNT (LAN)</option>
                    <option value="EPSON">Epson ePOS (LAN)</option>
                  </select>
                </div>
              </div>
              {(printerForm.connectionType === 'NETWORK' || printerForm.connectionType === 'STAR' || printerForm.connectionType === 'EPSON') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {printerForm.connectionType === 'STAR' ? 'IP Address (port defaults to 8008)' :
                     printerForm.connectionType === 'EPSON' ? 'IP Address' :
                     'IP Address:Port'}
                  </label>
                  <input
                    type="text"
                    value={printerForm.connectionDetails}
                    onChange={(e) => setPrinterForm((f) => ({ ...f, connectionDetails: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 font-mono"
                    placeholder={printerForm.connectionType === 'NETWORK' ? '192.168.1.100:9100' : '192.168.1.100'}
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Handles</label>
                <div className="flex gap-3">
                  {['RECEIPT', 'KOT', 'LABEL', 'INVOICE'].map((h) => (
                    <label key={h} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={printerForm.handles.includes(h)}
                        onChange={(e) => {
                          setPrinterForm((f) => ({
                            ...f,
                            handles: e.target.checked
                              ? [...f.handles, h]
                              : f.handles.filter((x) => x !== h),
                          }));
                        }}
                        className="rounded"
                      />
                      {h}
                    </label>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={printerForm.isDefault}
                  onChange={(e) => setPrinterForm((f) => ({ ...f, isDefault: e.target.checked }))}
                  className="rounded"
                />
                Set as default printer
              </label>
              <button
                onClick={() => {
                  // Save Star/Epson config to localStorage for PrintModal + KDS
                  if (printerForm.connectionType === 'STAR' && printerForm.connectionDetails) {
                    localStorage.setItem('star-printer', JSON.stringify({ host: printerForm.connectionDetails }));
                    if (printerForm.handles.some((h) => h.startsWith('KOT'))) {
                      localStorage.setItem('kot-printer-config', JSON.stringify({ type: 'STAR', host: printerForm.connectionDetails }));
                    }
                  } else if (printerForm.connectionType === 'EPSON' && printerForm.connectionDetails) {
                    localStorage.setItem('epson-printer', JSON.stringify({ host: printerForm.connectionDetails }));
                    if (printerForm.handles.some((h) => h.startsWith('KOT'))) {
                      localStorage.setItem('kot-printer-config', JSON.stringify({ type: 'EPSON', host: printerForm.connectionDetails }));
                    }
                  }
                  createPrinterMutation.mutate(printerForm);
                }}
                disabled={!printerForm.name || printerForm.handles.length === 0 || createPrinterMutation.isPending}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                <Printer className="w-4 h-4" />
                {createPrinterMutation.isPending ? 'Adding...' : 'Add Printer'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── API Keys Tab ──────────────────────────────────────────────────── */}
      {activeTab === 'api-keys' && (
        <div className="space-y-6">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
            <strong>Security notice:</strong> API keys grant programmatic access to your POS data.
            Keep them secret. Each key is shown only once at creation.
          </div>

          {/* Existing keys */}
          <div className="bg-white rounded-xl shadow divide-y">
            {apiKeys.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <Key className="w-8 h-8 mx-auto mb-2 opacity-40" />
                No API keys yet
              </div>
            ) : (
              apiKeys.map((k) => (
                <div key={k.id} className="p-4 flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${k.isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <div>
                      <p className="font-medium text-sm">{k.name}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {(k.scopes ?? []).map((s) => (
                          <span key={s} className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{s}</span>
                        ))}
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        Created {new Date(k.createdAt).toLocaleDateString('en-KE')}
                        {k.lastUsedAt && ` • Last used ${new Date(k.lastUsedAt).toLocaleDateString('en-KE')}`}
                        {!k.isActive && <span className="ml-1 text-red-500 font-medium">Revoked</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {k.isActive && (
                      <button
                        onClick={() =>
                          showConfirm(
                            'Revoke API Key',
                            `Revoke access for "${k.name}"? All requests using this key will be rejected immediately.`,
                            () => revokeApiKeyMutation.mutate(k.id),
                            'warning',
                            'Revoke Key',
                          )
                        }
                        className="text-xs px-3 py-1.5 border border-orange-300 text-orange-600 hover:bg-orange-50 rounded-lg"
                      >
                        <Lock className="w-3 h-3 inline mr-1" />
                        Revoke
                      </button>
                    )}
                    <button
                      onClick={() =>
                        showConfirm(
                          'Delete API Key',
                          `Permanently delete "${k.name}"? This cannot be undone and any integrations using this key will stop working.`,
                          () => deleteApiKeyMutation.mutate(k.id),
                        )
                      }
                      className="text-gray-400 hover:text-red-600 p-1" aria-label="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Show newly created raw key */}
          {createdRawKey && (
            <div className="bg-green-50 border-2 border-green-400 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-green-700 font-semibold">
                <CheckCircle className="w-5 h-5" />
                API key created — copy it now, it won't be shown again
              </div>
              <div className="flex gap-2">
                <code className="flex-1 px-3 py-2 bg-white border border-green-300 rounded-lg text-sm font-mono break-all text-gray-800">
                  {createdRawKey}
                </code>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(createdRawKey);
                    setKeyCopied(true);
                    setTimeout(() => setKeyCopied(false), 2000);
                  }}
                  className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium flex items-center gap-1"
                >
                  {keyCopied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {keyCopied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <button
                onClick={() => setCreatedRawKey(null)}
                className="text-xs text-gray-500 hover:text-gray-700 underline"
              >
                I've copied the key, dismiss
              </button>
            </div>
          )}

          {/* Create new key form */}
          <div className="bg-white rounded-xl shadow p-6 space-y-4">
            <h3 className="font-semibold text-gray-800">Create New API Key</h3>
            <div>
              <label htmlFor="f-key-name" className="block text-sm font-medium text-gray-700 mb-1">Key Name</label>
              <input id="f-key-name"
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g. Mobile App Integration"
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Scopes</label>
              <div className="flex flex-wrap gap-2">
                {['sales:read', 'sales:write', 'inventory:read', 'inventory:write', 'reports:read', 'bookings:write'].map((scope) => (
                  <label key={scope} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newKeyScopes.includes(scope)}
                      onChange={(e) => {
                        setNewKeyScopes((prev) =>
                          e.target.checked ? [...prev, scope] : prev.filter((s) => s !== scope),
                        );
                      }}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-700">{scope}</span>
                  </label>
                ))}
              </div>
            </div>
            <button
              onClick={() => createApiKeyMutation.mutate()}
              disabled={!newKeyName.trim() || newKeyScopes.length === 0 || createApiKeyMutation.isPending}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              <Key className="w-4 h-4" />
              {createApiKeyMutation.isPending ? 'Creating…' : 'Create API Key'}
            </button>
          </div>
        </div>
      )}

      {/* ── Scale Integration Tab ──────────────────────────────────────────── */}
      {activeTab === 'scale' && (
        <div className="space-y-6">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
            Connect a weighing scale to automatically read weights at checkout.
            Supported protocols: Mettler-Toledo, A&amp;D, CAS.
          </div>

          <div className="bg-white rounded-xl shadow p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">Scale Configuration</h3>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={scaleForm.enabled}
                  onChange={(e) => setScaleForm((f) => ({ ...f, enabled: e.target.checked }))}
                  className="w-4 h-4 rounded"
                />
                <span className="text-sm font-medium text-gray-700">Enable scale integration</span>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="f-protocol" className="block text-sm font-medium text-gray-700 mb-1">Protocol</label>
                <select id="f-protocol"
                  value={scaleForm.protocol}
                  onChange={(e) => setScaleForm((f) => ({ ...f, protocol: e.target.value }))}
                  disabled={!scaleForm.enabled}
                  className="w-full px-3 py-2 border rounded-lg text-sm disabled:opacity-50">
                  <option value="METTLER_TOLEDO">Mettler-Toledo (MT-SICS)</option>
                  <option value="AND">A&D (AD command set)</option>
                  <option value="CAS">CAS (CL5000 series)</option>
                  <option value="OHAUS">Ohaus (Scout/Ranger)</option>
                </select>
              </div>
              <div>
                <label htmlFor="f-port-connection" className="block text-sm font-medium text-gray-700 mb-1">Port / Connection</label>
                <input id="f-port-connection"
                  type="text"
                  value={scaleForm.port}
                  onChange={(e) => setScaleForm((f) => ({ ...f, port: e.target.value }))}
                  disabled={!scaleForm.enabled}
                  placeholder="COM1, /dev/ttyUSB0, or IP:port"
                  className="w-full px-3 py-2 border rounded-lg text-sm disabled:opacity-50"
                />
              </div>
              <div>
                <label htmlFor="f-baud-rate" className="block text-sm font-medium text-gray-700 mb-1">Baud Rate</label>
                <select id="f-baud-rate"
                  value={scaleForm.baudRate}
                  onChange={(e) => setScaleForm((f) => ({ ...f, baudRate: e.target.value }))}
                  disabled={!scaleForm.enabled}
                  className="w-full px-3 py-2 border rounded-lg text-sm disabled:opacity-50"
                >
                  {['1200', '2400', '4800', '9600', '19200', '38400', '115200'].map((b) => (
                    <option key={b} value={b}>{b} baud</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-500 space-y-1">
              <p>Scale integration uses the Web Serial API (Chrome 89+) or a local serial bridge.</p>
              <p>When enabled, a "Read Scale" button appears at checkout for weighed items.</p>
            </div>

            <button
              onClick={() => {
                setScaleSaved(true);
                setTimeout(() => setScaleSaved(false), 3000);
              }}
              disabled={!scaleForm.enabled}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {scaleSaved ? <CheckCircle className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {scaleSaved ? 'Saved!' : 'Save Scale Settings'}
            </button>
          </div>
        </div>
      )}

      {/* ── Webhooks Tab ─────────────────────────────────────────────────── */}
      {activeTab === 'webhooks' && (
        <div className="space-y-6">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
            <div className="flex items-start gap-3">
              <Zap className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">Outbound Webhooks</p>
                <p className="mt-0.5 text-blue-700">
                  Send real-time event notifications to external systems when sales complete or stock runs low.
                  Payloads are signed with HMAC-SHA256 using your secret key.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold text-gray-800">Registered Endpoints</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {webhooks.length} webhook{webhooks.length !== 1 ? 's' : ''} configured
                </p>
              </div>
              <button
                onClick={() => setShowAddWebhook(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
              >
                <Plus className="w-4 h-4" />
                Add Webhook
              </button>
            </div>

            {showAddWebhook && (
              <div className="mb-6 p-4 border rounded-lg bg-gray-50 space-y-4">
                <h3 className="font-medium text-gray-800 text-sm">New Webhook Endpoint</h3>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Endpoint URL *</label>
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <input
                      type="url"
                      value={webhookForm.url}
                      onChange={(e) => setWebhookForm((f) => ({ ...f, url: e.target.value }))}
                      placeholder="https://yourapp.example.com/webhooks"
                      className="flex-1 border rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="f-signing-secret-optional" className="block text-xs font-medium text-gray-600 mb-1">Signing Secret (optional)</label>
                  <input id="f-signing-secret-optional"
                    type="text"
                    value={webhookForm.secret}
                    onChange={(e) => setWebhookForm((f) => ({ ...f, secret: e.target.value }))}
                    placeholder="Leave blank to skip signature verification"
                    className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                  />
                  <p className="text-xs text-gray-400 mt-1">Sent as X-Webhook-Signature: sha256=... header</p>
                </div>
                <div>
                  <label htmlFor="f-description" className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                  <input id="f-description"
                    type="text"
                    value={webhookForm.description}
                    onChange={(e) => setWebhookForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="e.g. Accounting system sync"
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-2">Events to Subscribe *</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {[
                      { value: 'sale.completed', label: 'Sale Completed', desc: 'Fires after every paid sale' },
                      { value: 'sale.voided', label: 'Sale Voided', desc: 'Fires when a sale is voided' },
                      { value: 'inventory.low_stock', label: 'Low Stock Alert', desc: 'Stock ≤ reorder level' },
                      { value: 'customer.created', label: 'Customer Created', desc: 'New customer registered' },
                    ].map((ev) => (
                      <label key={ev.value} className="flex items-start gap-2 p-2 border rounded-lg cursor-pointer hover:bg-white">
                        <input
                          type="checkbox"
                          checked={webhookForm.events.includes(ev.value)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setWebhookForm((f) => ({ ...f, events: [...f.events, ev.value] }));
                            } else {
                              setWebhookForm((f) => ({ ...f, events: f.events.filter((ev2) => ev2 !== ev.value) }));
                            }
                          }}
                          className="mt-0.5 w-4 h-4 rounded"
                        />
                        <div>
                          <p className="text-sm font-medium text-gray-700">{ev.label}</p>
                          <p className="text-xs text-gray-400">{ev.desc}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => createWebhookMutation.mutate()}
                    disabled={!webhookForm.url.startsWith('http') || webhookForm.events.length === 0 || createWebhookMutation.isPending}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {createWebhookMutation.isPending ? 'Saving…' : 'Register Webhook'}
                  </button>
                  <button
                    onClick={() => setShowAddWebhook(false)}
                    className="px-4 py-2 border rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {webhooks.length === 0 && !showAddWebhook ? (
              <div className="text-center py-10 text-gray-400">
                <Zap className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No webhooks configured yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {webhooks.map((wh) => {
                  const events: string[] = JSON.parse(wh.events ?? '[]');
                  return (
                    <div key={wh.id} className={`border rounded-xl p-4 ${wh.isActive ? 'border-gray-200' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Globe className="w-4 h-4 text-blue-500 flex-shrink-0" />
                            <span className="font-mono text-sm text-gray-800 truncate">{wh.url}</span>
                            {wh.failureCount > 0 && (
                              <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-xs rounded-full flex-shrink-0">
                                {wh.failureCount} fail{wh.failureCount !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                          {wh.description && <p className="text-xs text-gray-500 mb-2">{wh.description}</p>}
                          <div className="flex flex-wrap gap-1.5">
                            {events.map((ev) => (
                              <span key={ev} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full font-mono">
                                {ev}
                              </span>
                            ))}
                          </div>
                          {wh.lastFiredAt && (
                            <p className="text-xs text-gray-400 mt-1.5">
                              Last fired: {new Date(wh.lastFiredAt).toLocaleString('en-KE')}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => pingWebhookMutation.mutate(wh.id)}
                            disabled={pingWebhookMutation.isPending}
                            title="Send test ping"
                            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => toggleWebhookMutation.mutate({ id: wh.id, isActive: !wh.isActive })}
                            title={wh.isActive ? 'Disable' : 'Enable'}
                            className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
                          >
                            {wh.isActive ? <ToggleRight className="w-4 h-4 text-green-600" /> : <ToggleLeft className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => showConfirm(
                              'Remove Webhook',
                              `Remove the webhook endpoint at ${wh.url}? It will no longer receive events.`,
                              () => deleteWebhookMutation.mutate(wh.id),
                            )}
                            className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg" aria-label="Delete">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="font-semibold text-gray-800 mb-3">Event Reference</h3>
            <div className="space-y-2">
              {[
                { event: 'sale.completed', payload: '{ saleId, receiptNumber, totalCents, customerId, items[] }' },
                { event: 'sale.voided', payload: '{ saleId, receiptNumber, reason }' },
                { event: 'inventory.low_stock', payload: '{ itemId, itemName, currentStock, reorderLevel }' },
                { event: 'customer.created', payload: '{ customerId, name, phone }' },
              ].map((ev) => (
                <div key={ev.event} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="font-mono text-xs font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded flex-shrink-0">{ev.event}</span>
                  <span className="font-mono text-xs text-gray-500">{ev.payload}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Audit Log Tab ────────────────────────────────────────────────── */}
      {activeTab === 'audit' && (
        <div className="space-y-6">
          {/* Hash chain integrity */}
          <div className="bg-white rounded-xl shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-gray-800">Tamper-Evident Audit Log</h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  SHA-256 hash-chained log of all financial operations. Compliant with KRA audit requirements.
                </p>
              </div>
              <button
                onClick={() => void verifyChain()}
                className="flex items-center gap-1.5 px-4 py-2 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-900"
              >
                <Activity className="w-4 h-4" />
                Verify Chain
              </button>
            </div>
            {auditIntegrity && (
              <div className={`flex items-center gap-3 p-3 rounded-lg ${auditIntegrity.valid ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                {auditIntegrity.valid ? (
                  <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                )}
                <div>
                  <p className={`font-medium text-sm ${auditIntegrity.valid ? 'text-green-800' : 'text-red-800'}`}>
                    {auditIntegrity.valid ? `Chain integrity verified (${auditIntegrity.checkedEntries} entries)` : 'Chain integrity compromised!'}
                  </p>
                  {!auditIntegrity.valid && (
                    <p className="text-xs text-red-600 mt-0.5">Broken at entry: {auditIntegrity.brokenAt}</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Filters */}
          <div className="bg-white rounded-xl shadow p-6">
            <div className="flex items-center gap-2 mb-4">
              <Filter className="w-4 h-4 text-gray-500" />
              <h3 className="font-semibold text-gray-800 text-sm">Filter Audit Entries</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">From Date</label>
                <input
                  type="date"
                  value={auditFilters.startDate}
                  onChange={(e) => setAuditFilters((f) => ({ ...f, startDate: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm" aria-label="Start date" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">To Date</label>
                <input
                  type="date"
                  value={auditFilters.endDate}
                  onChange={(e) => setAuditFilters((f) => ({ ...f, endDate: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm" aria-label="End date" />
              </div>
              <div>
                <label htmlFor="f-entity-type" className="block text-xs font-medium text-gray-600 mb-1">Entity Type</label>
                <select id="f-entity-type"
                  value={auditFilters.entity}
                  onChange={(e) => setAuditFilters((f) => ({ ...f, entity: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">All entities</option>
                  {['Sale', 'User', 'Item', 'InventoryMovement', 'Expense', 'GoodsReceivedNote'].map((e) => (
                    <option key={e} value={e}>{e}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="f-actor-id-search" className="block text-xs font-medium text-gray-600 mb-1">Actor ID / Search</label>
                <input id="f-actor-id-search"
                  type="text"
                  value={auditFilters.actor}
                  onChange={(e) => setAuditFilters((f) => ({ ...f, actor: e.target.value }))}
                  placeholder="Filter by user ID"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void refetchAudit()}
                disabled={auditLoading}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${auditLoading ? 'animate-spin' : ''}`} />
                {auditLoading ? 'Loading…' : 'Search'}
              </button>
              <button
                onClick={() => {
                  if (auditLogs.length === 0) return;
                  const headers = ['Timestamp', 'Actor', 'ActorType', 'Action', 'Entity', 'EntityID', 'Source', 'SHA256'];
                  const rows = auditLogs.map((e) => [
                    new Date(e.createdAt).toISOString(),
                    e.actor, e.actorType, e.action, e.entity, e.entityId, e.source, e.hash,
                  ]);
                  const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(blob);
                  a.download = `audit-log-${businessId}-${new Date().toISOString().slice(0,10)}.csv`;
                  a.click();
                }}
                disabled={auditLogs.length === 0}
                className="flex items-center gap-1.5 px-4 py-2 border rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV ({auditLogs.length})
              </button>
            </div>
          </div>

          {/* Log entries */}
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <div className="px-6 py-3 border-b bg-gray-50">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Recent Audit Entries — {auditLogs.length} shown
              </p>
            </div>
            {auditLogs.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No audit entries found. {auditLoading ? 'Loading…' : 'Run a search above.'}</p>
              </div>
            ) : (
              <div className="divide-y max-h-[500px] overflow-y-auto">
                {auditLogs.map((entry) => (
                  <div key={entry.id} className="px-6 py-3 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`px-1.5 py-0.5 text-xs rounded font-mono font-semibold ${
                            entry.action.includes('VOID') || entry.action.includes('DELETE')
                              ? 'bg-red-100 text-red-700'
                              : entry.action.includes('CREATE') || entry.action.includes('SALE')
                              ? 'bg-green-100 text-green-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}>{entry.action}</span>
                          <span className="text-xs text-gray-500">{entry.entity}</span>
                          <span className="text-xs text-gray-400">·</span>
                          <span className="text-xs text-gray-500 truncate">{entry.entityId}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                          <span>Actor: {entry.actor}</span>
                          <span>·</span>
                          <span>{entry.source}</span>
                          <span>·</span>
                          <span title={entry.hash} className="font-mono truncate max-w-[120px]">#{entry.hash.slice(0, 12)}…</span>
                        </div>
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        {new Date(entry.createdAt).toLocaleString('en-KE', { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Backup Tab ────────────────────────────────────────────────────── */}
      {activeTab === 'backup' && (() => {
        const BACKUP_KEY = `pos-backup-history-${businessId}`;
        const backupHistory: Array<{ name: string; date: string; type: string }> = (() => {
          try { return JSON.parse(localStorage.getItem(BACKUP_KEY) ?? '[]'); } catch { return []; }
        })();
        const lastBackup = backupHistory[0];
        const daysSinceBackup = lastBackup
          ? Math.floor((Date.now() - new Date(lastBackup.date).getTime()) / (1000 * 60 * 60 * 24))
          : null;
        const recordBackup = (name: string, type: string) => {
          const updated = [{ name, date: new Date().toISOString(), type }, ...backupHistory].slice(0, 7);
          localStorage.setItem(BACKUP_KEY, JSON.stringify(updated));
        };
        return (
          <div className="space-y-6">
            {/* Backup health */}
            {daysSinceBackup !== null && daysSinceBackup >= 7 && (
              <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <div>
                  <span className="font-semibold">Backup overdue</span> — last backup was {daysSinceBackup} days ago.
                  We recommend backing up weekly.
                </div>
              </div>
            )}
            {daysSinceBackup !== null && daysSinceBackup < 7 && (
              <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl text-sm text-green-800">
                <CheckCircle className="w-5 h-5 flex-shrink-0" />
                Last backup: <span className="font-semibold">{lastBackup!.name}</span> ({daysSinceBackup === 0 ? 'today' : `${daysSinceBackup}d ago`})
              </div>
            )}

            {/* Full Data Export */}
            <div className="bg-white rounded-xl shadow p-6 space-y-4">
              <div className="flex items-start gap-3">
                <HardDrive className="w-5 h-5 text-purple-600 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-gray-800">Full Data Backup</h3>
                  <p className="text-sm text-gray-500 mt-0.5">
                    Download all business data: items, sales (last 10,000), customers, expenses, suppliers, employees.
                    Use for full backups or migration.
                  </p>
                </div>
              </div>
              <button
                onClick={async () => {
                  try {
                    const data = await api.get(`/reports/full-data-export?businessId=${businessId}`);
                    const filename = `pos-full-backup-${new Date().toISOString().slice(0, 10)}.json`;
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    a.click();
                    URL.revokeObjectURL(url);
                    recordBackup(filename, 'FULL');
                    showNotification('Full data backup downloaded and recorded.', 'success');
                  } catch {
                    showNotification('Failed to generate backup.', 'error');
                  }
                }}
                className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700"
              >
                <Download className="w-4 h-4" />
                Download Full Backup
              </button>
            </div>

            {/* Settings Export */}
            <div className="bg-white rounded-xl shadow p-6 space-y-4">
              <div className="flex items-start gap-3">
                <Download className="w-5 h-5 text-blue-600 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-gray-800">Export Settings</h3>
                  <p className="text-sm text-gray-500 mt-0.5">
                    Download a JSON backup of your business settings, tax configuration,
                    user roles, and integration credentials (encrypted).
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  const backup = {
                    exportedAt: new Date().toISOString(),
                    businessId,
                    settings: {
                      name: settings?.name,
                      taxType: settings?.taxType,
                      serviceChargeRate: settings?.serviceChargeRate,
                      negativePolicyDefault: settings?.negativePolicyDefault,
                      posMode: settings?.posMode,
                      expiredItemPolicy: settings?.expiredItemPolicy,
                    },
                  };
                  const filename = `pos-settings-backup-${new Date().toISOString().slice(0, 10)}.json`;
                  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = filename;
                  a.click();
                  URL.revokeObjectURL(url);
                  recordBackup(filename, 'SETTINGS');
                }}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
              >
                <Download className="w-4 h-4" />
                Download Settings Backup
              </button>
            </div>

            {/* Backup history */}
            {backupHistory.length > 0 && (
              <div className="bg-white rounded-xl shadow p-6">
                <h3 className="font-semibold text-gray-800 mb-3">Backup History</h3>
                <div className="space-y-2">
                  {backupHistory.map((b, i) => (
                    <div key={i} className="flex items-center justify-between text-sm py-2 border-b last:border-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${b.type === 'FULL' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                          {b.type}
                        </span>
                        <span className="text-gray-700 font-mono text-xs truncate max-w-xs">{b.name}</span>
                      </div>
                      <span className="text-gray-400 text-xs flex-shrink-0">{new Date(b.date).toLocaleDateString('en-KE')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Import */}
            <div className="bg-white rounded-xl shadow p-6 space-y-4">
              <div className="flex items-start gap-3">
                <Upload className="w-5 h-5 text-green-600 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-gray-800">Import Settings</h3>
                  <p className="text-sm text-gray-500 mt-0.5">
                    Restore settings from a previously exported backup file.
                    This will overwrite current general settings.
                  </p>
                </div>
              </div>
              <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center">
                <input
                  type="file"
                  accept=".json"
                  id="backup-import"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      try {
                        const data = JSON.parse(ev.target?.result as string) as { settings?: typeof form };
                        if (data.settings) {
                          setForm((prev) => ({ ...prev, ...data.settings }));
                          showNotification('Settings loaded from backup. Click "Save Settings" on the General tab to apply.', 'success');
                        } else {
                          showNotification('Invalid backup file — no settings found.', 'error');
                        }
                      } catch {
                        showNotification('Failed to parse backup file. Make sure it is a valid JSON export.', 'error');
                      }
                      e.target.value = '';
                    };
                    reader.readAsText(file);
                  }}
                />
                <label htmlFor="backup-import" className="cursor-pointer">
                  <Upload className="w-10 h-10 mx-auto text-gray-300 mb-3" />
                  <p className="text-gray-500 text-sm font-medium">Click to select backup file</p>
                  <p className="text-gray-400 text-xs mt-1">JSON files only (.json)</p>
                </label>
              </div>
            </div>

            {/* Data retention notice */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-600">
              <p className="font-medium mb-1">Backup rotation</p>
              <p>The last 7 backups are tracked locally. For full recovery capability, store your backup files in a secure cloud drive (Google Drive, OneDrive, Dropbox).</p>
            </div>
          </div>
        );
      })()}

      {/* ── Automation Tab ────────────────────────────────────────────────── */}
      {activeTab === 'automation' && !hasFeature(user?.subscriptionTier ?? user?.planName, 'scheduled-reports') && (
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <div className="text-5xl">⏰</div>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white">Scheduled Reports</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm">Automatically email X/Z reports, VAT summaries and P&amp;L statements on a daily, weekly or monthly schedule. Available on the <strong className="text-gray-700 dark:text-gray-300">Pro plan</strong> and above.</p>
          <a href="/settings?tab=subscription" className="mt-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors">Upgrade to Pro →</a>
        </div>
      )}
      {activeTab === 'automation' && hasFeature(user?.subscriptionTier ?? user?.planName, 'scheduled-reports') && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold text-gray-800">Scheduled Reports</h2>
                <p className="text-sm text-gray-500 mt-0.5">Automatically email reports on a schedule</p>
              </div>
              <button
                onClick={() => setShowAddSchedule(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
              >
                <Plus className="w-4 h-4" />
                Add Schedule
              </button>
            </div>

            {showAddSchedule && (
              <div className="mb-6 p-4 border rounded-lg bg-gray-50 space-y-4">
                <h3 className="font-medium text-gray-800 text-sm">New Report Schedule</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="f-report-type" className="block text-xs font-medium text-gray-600 mb-1">Report Type</label>
                    <select id="f-report-type"
                      value={scheduleForm.reportType}
                      onChange={(e) => setScheduleForm((f) => ({ ...f, reportType: e.target.value }))}
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    >
                      {[
                        { value: 'SALES', label: 'Sales Summary' },
                        { value: 'PL', label: 'Profit & Loss' },
                        { value: 'TAX', label: 'VAT / TOT Report' },
                        { value: 'STOCK', label: 'Stock Valuation' },
                        { value: 'ALL', label: 'All Reports' },
                        { value: 'LOW_STOCK', label: 'Low Stock Digest' },
                        { value: 'EXPIRY', label: 'Expiry Digest' },
                      ].map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="f-frequency" className="block text-xs font-medium text-gray-600 mb-1">Frequency</label>
                    <select id="f-frequency"
                      value={scheduleForm.frequency}
                      onChange={(e) => setScheduleForm((f) => ({ ...f, frequency: e.target.value, dayOfWeek: undefined, dayOfMonth: undefined }))}
                      className="w-full border rounded-lg px-3 py-2 text-sm">
                      <option value="DAILY">Daily</option>
                      <option value="WEEKLY">Weekly</option>
                      <option value="MONTHLY">Monthly</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="f-send-at-hour" className="block text-xs font-medium text-gray-600 mb-1">Send At Hour</label>
                    <select id="f-send-at-hour"
                      value={scheduleForm.hour}
                      onChange={(e) => setScheduleForm((f) => ({ ...f, hour: Number(e.target.value) }))}
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    >
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>
                          {h === 0 ? '12:00 AM' : h < 12 ? `${h}:00 AM` : h === 12 ? '12:00 PM' : `${h - 12}:00 PM`}
                        </option>
                      ))}
                    </select>
                  </div>
                  {scheduleForm.frequency === 'WEEKLY' && (
                    <div>
                      <label htmlFor="f-day-of-week" className="block text-xs font-medium text-gray-600 mb-1">Day of Week</label>
                      <select id="f-day-of-week"
                        value={scheduleForm.dayOfWeek ?? 1}
                        onChange={(e) => setScheduleForm((f) => ({ ...f, dayOfWeek: Number(e.target.value) }))}
                        className="w-full border rounded-lg px-3 py-2 text-sm"
                      >
                        {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => (
                          <option key={i} value={i}>{d}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {scheduleForm.frequency === 'MONTHLY' && (
                    <div>
                      <label htmlFor="f-day-of-month" className="block text-xs font-medium text-gray-600 mb-1">Day of Month</label>
                      <select id="f-day-of-month"
                        value={scheduleForm.dayOfMonth ?? 1}
                        onChange={(e) => setScheduleForm((f) => ({ ...f, dayOfMonth: Number(e.target.value) }))}
                        className="w-full border rounded-lg px-3 py-2 text-sm"
                      >
                        {Array.from({ length: 28 }, (_, i) => (
                          <option key={i + 1} value={i + 1}>{i + 1}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <div>
                  <label htmlFor="f-recipients-comma-separated-emails" className="block text-xs font-medium text-gray-600 mb-1">
                    Recipients (comma-separated emails)
                  </label>
                  <input id="f-recipients-comma-separated-emails"
                    type="text"
                    value={scheduleForm.recipients}
                    onChange={(e) => setScheduleForm((f) => ({ ...f, recipients: e.target.value }))}
                    placeholder="owner@example.com, manager@example.com"
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => createScheduleMutation.mutate()}
                    disabled={!scheduleForm.recipients.trim() || createScheduleMutation.isPending}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {createScheduleMutation.isPending ? 'Saving…' : 'Save Schedule'}
                  </button>
                  <button
                    onClick={() => setShowAddSchedule(false)}
                    className="px-4 py-2 border rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {reportSchedules.length === 0 && !showAddSchedule ? (
              <div className="text-center py-10 text-gray-400">
                <Bell className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No scheduled reports yet</p>
                <p className="text-xs mt-1">Add a schedule to automatically email reports</p>
              </div>
            ) : (
              <div className="divide-y">
                {reportSchedules.map((sched) => {
                  const recipients = (() => {
                    try { return JSON.parse(sched.recipients) as string[]; } catch { return [sched.recipients]; }
                  })();
                  const freqLabel = sched.frequency === 'DAILY' ? 'Daily' : sched.frequency === 'WEEKLY' ? `Weekly (${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][sched.dayOfWeek ?? 1]})` : `Monthly (day ${sched.dayOfMonth ?? 1})`;
                  const hourLabel = sched.hour === 0 ? '12:00 AM' : sched.hour < 12 ? `${sched.hour}:00 AM` : sched.hour === 12 ? '12:00 PM' : `${sched.hour - 12}:00 PM`;
                  return (
                    <div key={sched.id} className="py-4 flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className={`p-2 rounded-lg ${sched.isActive ? 'bg-blue-100' : 'bg-gray-100'}`}>
                          <Mail className={`w-4 h-4 ${sched.isActive ? 'text-blue-600' : 'text-gray-400'}`} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm text-gray-800">{sched.reportType.replace('_', ' ')}</span>
                            {!sched.isActive && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Paused</span>}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {freqLabel} at {hourLabel}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5 truncate">{recipients.join(', ')}</p>
                          {sched.lastSentAt && (
                            <p className="text-xs text-gray-400">Last sent: {new Date(sched.lastSentAt).toLocaleString('en-KE')}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => triggerScheduleMutation.mutate(sched.id)}
                          title="Send now"
                          className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg"
                        >
                          <Play className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => toggleScheduleMutation.mutate({ id: sched.id, isActive: !sched.isActive })}
                          title={sched.isActive ? 'Pause' : 'Resume'}
                          className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg"
                        >
                          {sched.isActive ? <ToggleRight className="w-5 h-5 text-blue-600" /> : <ToggleLeft className="w-5 h-5" />}
                        </button>
                        <button
                          onClick={() =>
                            showConfirm(
                              'Delete Schedule',
                              'Remove this report schedule? It will no longer send emails automatically.',
                              () => deleteScheduleMutation.mutate(sched.id),
                            )
                          }
                          className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg" aria-label="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800">
                <p className="font-medium">Scheduled delivery requires a cron job</p>
                <p className="mt-0.5 text-amber-700">Schedules define when reports should be sent. The actual email delivery requires a server-side cron job to call the trigger endpoint. Use the Play button to send manually at any time.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Security ──────────────────────────────────────────────────────── */}
      {activeTab === 'security' && (
        <div className="space-y-6">
          {/* Change Password */}
          <div className="bg-white rounded-xl shadow p-6 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Lock className="w-5 h-5 text-blue-600" />
              <h2 className="text-base font-semibold text-gray-900">Change Password</h2>
            </div>
            <p className="text-sm text-gray-500">Update your account password. The new password must be at least 8 characters and include uppercase, lowercase, and a number.</p>
            {cpMsg && (
              <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm ${cpMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {cpMsg.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                {cpMsg.text}
              </div>
            )}
            <div className="grid gap-3">
              <div>
                <label htmlFor="f-current-password" className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
                <input id="f-current-password"
                  type="password"
                  value={cpCurrent}
                  onChange={(e) => { setCpCurrent(e.target.value); setCpMsg(null); }}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter current password"
                />
              </div>
              <div>
                <label htmlFor="f-new-password" className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                <input id="f-new-password"
                  type="password"
                  value={cpNew}
                  onChange={(e) => { setCpNew(e.target.value); setCpMsg(null); }}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter new password"
                />
              </div>
              <div>
                <label htmlFor="f-confirm-new-password" className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
                <input id="f-confirm-new-password"
                  type="password"
                  value={cpConfirm}
                  onChange={(e) => { setCpConfirm(e.target.value); setCpMsg(null); }}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Confirm new password"
                />
                {cpNew && cpConfirm && cpNew !== cpConfirm && (
                  <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
                )}
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => changePwdMutation.mutate()}
                disabled={!cpCurrent || !cpNew || !cpConfirm || cpNew !== cpConfirm || changePwdMutation.isPending}
                className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {changePwdMutation.isPending ? 'Saving...' : 'Change Password'}
              </button>
            </div>
          </div>

          {/* Active Sessions */}
          <div className="bg-white rounded-xl shadow p-6 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-blue-600" />
                <h2 className="text-base font-semibold text-gray-900">Active Sessions</h2>
              </div>
              <button
                onClick={() => revokeAllMutation.mutate()}
                disabled={revokeAllMutation.isPending}
                className="px-3 py-1.5 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
              >
                Revoke All Other Sessions
              </button>
            </div>
            <p className="text-sm text-gray-500">These are the active login sessions for your account. Revoke any you do not recognise.</p>
            {!activeSessions || activeSessions.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No active sessions found.</p>
            ) : (
              <div className="space-y-2">
                {activeSessions.map((session) => (
                  <div key={session.id} className="flex items-center justify-between p-3 border border-gray-100 rounded-lg">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {session.userAgent ? session.userAgent.slice(0, 40) + (session.userAgent.length > 40 ? '…' : '') : 'Unknown device'}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {session.ipAddress && <span className="mr-2">{session.ipAddress}</span>}
                        Last seen: {new Date(session.lastSeenAt).toLocaleString('en-KE')}
                      </p>
                    </div>
                    <button
                      onClick={() => revokeSessionMutation.mutate(session.id)}
                      disabled={revokeSessionMutation.isPending}
                      className="ml-3 px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 flex-shrink-0"
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      {showAddUser && (
        <AddUserModal businessId={businessId} onClose={() => setShowAddUser(false)} />
      )}
      {editingUser && (
        <EditUserModal
          user={editingUser}
          businessId={businessId}
          onClose={() => setEditingUser(null)}
        />
      )}

      {/* ── Store Assignment Modal ──────────────────────────────────────────── */}
      {storeAssignUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                Assign Stores — {storeAssignUser.name}
              </h2>
              <button onClick={() => setStoreAssignUser(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Select which stores this manager can access. If none are selected, they have access to all stores.
            </p>
            <div className="space-y-2">
              {(settings?.stores ?? []).map((store) => {
                const assigned = (storeAssignUser.assignedStores ?? []).some((s) => s.storeId === store.id);
                return (
                  <label key={store.id} className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <input
                      type="checkbox"
                      checked={assigned}
                      onChange={(e) => {
                        if (e.target.checked) {
                          assignStoreMutation.mutate({ userId: storeAssignUser.id, storeId: store.id });
                          setStoreAssignUser((prev) =>
                            prev ? { ...prev, assignedStores: [...(prev.assignedStores ?? []), { storeId: store.id }] } : prev,
                          );
                        } else {
                          removeStoreMutation.mutate({ userId: storeAssignUser.id, storeId: store.id });
                          setStoreAssignUser((prev) =>
                            prev ? { ...prev, assignedStores: (prev.assignedStores ?? []).filter((s) => s.storeId !== store.id) } : prev,
                          );
                        }
                      }}
                      className="w-4 h-4 accent-blue-600"
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{store.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{store.storeCode}</p>
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setStoreAssignUser(null)}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Professional Confirm Dialog ─────────────────────────────────────── */}
      {confirmDialog.open && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[200] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="p-6">
              <div className="flex items-start gap-4 mb-5">
                <div className={`p-2.5 rounded-xl flex-shrink-0 ${confirmDialog.variant === 'danger' ? 'bg-red-50' : 'bg-amber-50'}`}>
                  <AlertCircle className={`w-5 h-5 ${confirmDialog.variant === 'danger' ? 'text-red-600' : 'text-amber-600'}`} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-gray-900 text-base">{confirmDialog.title}</h3>
                  <p className="text-sm text-gray-500 mt-1 leading-relaxed">{confirmDialog.message}</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDialog((d) => ({ ...d, open: false }))}
                  className="flex-1 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    confirmDialog.onConfirm();
                    setConfirmDialog((d) => ({ ...d, open: false }));
                  }}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-medium text-white transition-colors ${
                    confirmDialog.variant === 'danger'
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-amber-500 hover:bg-amber-600'
                  }`}
                >
                  {confirmDialog.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast Notification ────────────────────────────────────────────────── */}
      {notification && (
        <div
          className={`fixed bottom-6 right-6 z-[300] flex items-center gap-3 px-5 py-4 rounded-xl shadow-2xl max-w-sm ${
            notification.type === 'success'
              ? 'bg-green-600'
              : notification.type === 'error'
              ? 'bg-red-600'
              : 'bg-gray-800'
          } text-white`}
        >
          {notification.type === 'success' ? (
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
          )}
          <p className="text-sm font-medium flex-1 leading-snug">{notification.message}</p>
          <button onClick={() => setNotification(null)} className="opacity-70 hover:opacity-100 ml-1 flex-shrink-0" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      </div>
        </div>
      </div>
    </div>
  );
}
