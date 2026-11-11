import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, CheckCircle, AlertTriangle, FileText, Settings } from 'lucide-react';
import { api } from '../lib/api';
import EtimsConnectionPanel from '../components/EtimsConnectionPanel';
import { useAuthStore } from '../stores/auth';

interface Business {
  id: string;
  name: string;
  etimsMode: 'SANDBOX' | 'PRODUCTION';
  etimsProductionOnboarded: boolean;
  kraItaxIntegrationEnabled: boolean;
}

interface VatReturnData {
  period: string;
  totalSales: number;
  totalPurchases: number;
  vatOnSales: number;
  vatOnPurchases: number;
  netVat: number;
  salesCount: number;
  expensesCount: number;
}

export default function EtimsSettingsPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [activeTab, setActiveTab] = useState<'onboarding' | 'itax' | 'vat-returns'>('onboarding');
  const [showItaxForm, setShowItaxForm] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const businessId = user?.businessId ?? '';

  // Fetch business info
  const { data: business } = useQuery<Business>({
    queryKey: ['business', businessId],
    queryFn: () => api.get<Business>(`/business/${businessId}/settings`),
    enabled: !!businessId,
  });

  // Fetch VAT return data
  const { data: vatData } = useQuery<VatReturnData>({
    queryKey: ['vat-return-data', businessId, selectedPeriod],
    queryFn: () => api.get<VatReturnData>(`/etims/vat-return-data?businessId=${businessId}&period=${selectedPeriod}`),
    enabled: !!businessId && activeTab === 'vat-returns',
  });

  // Enable iTax integration mutation
  const enableItaxMutation = useMutation({
    mutationFn: (data: any) => api.post('/etims/enable-itax', { ...data, businessId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['business'] });
      setShowItaxForm(false);
    },
  });

  // Submit VAT return mutation
  const submitVatMutation = useMutation({
    mutationFn: (data: any) => api.post('/etims/submit-vat-return', { ...data, businessId }),
    onSuccess: () => {
      // Show success message
    },
  });

  const handleItaxSetup = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    enableItaxMutation.mutate({
      username: formData.get('username'),
      password: formData.get('password'),
      kraPin: formData.get('kraPin'),
    });
  };

  const handleVatSubmission = () => {
    if (!vatData) return;
    
    submitVatMutation.mutate({
      period: selectedPeriod,
      totalSales: vatData.totalSales,
      totalPurchases: vatData.totalPurchases,
      vatOnSales: vatData.vatOnSales,
      vatOnPurchases: vatData.vatOnPurchases,
      netVat: vatData.netVat,
    });
  };

  const formatKES = (amount: number) =>
    `KES ${amount.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

  const tabs = [
    { id: 'onboarding', label: 'eTIMS Production', icon: Shield },
    { id: 'itax', label: 'iTax Integration', icon: Settings },
    { id: 'vat-returns', label: 'VAT Returns', icon: FileText },
  ];

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
            <Shield className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">KRA eTIMS & iTax</h1>
            <p className="text-sm text-gray-500">Manage tax compliance and integrations</p>
          </div>
        </div>

        {/* Status Indicators */}
        <div className="flex gap-4 mt-6">
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
            business?.etimsMode === 'PRODUCTION' 
              ? 'bg-green-100 text-green-700' 
              : 'bg-yellow-100 text-yellow-700'
          }`}>
            {business?.etimsMode === 'PRODUCTION' ? (
              <CheckCircle className="w-4 h-4" />
            ) : (
              <AlertTriangle className="w-4 h-4" />
            )}
            <span className="text-sm font-medium">
              eTIMS: {business?.etimsMode || 'SANDBOX'}
            </span>
          </div>
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
            business?.kraItaxIntegrationEnabled 
              ? 'bg-green-100 text-green-700' 
              : 'bg-gray-100 text-gray-700'
          }`}>
            {business?.kraItaxIntegrationEnabled ? (
              <CheckCircle className="w-4 h-4" />
            ) : (
              <AlertTriangle className="w-4 h-4" />
            )}
            <span className="text-sm font-medium">
              iTax: {business?.kraItaxIntegrationEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-6">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* eTIMS Production Onboarding */}
        {activeTab === 'onboarding' && <EtimsConnectionPanel />}

        {/* iTax Integration */}
        {activeTab === 'itax' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">iTax Integration</h2>
              
              {!business?.kraItaxIntegrationEnabled ? (
                <div className="space-y-4">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <Settings className="w-5 h-5 text-blue-600 mt-0.5" />
                      <div>
                        <h3 className="font-medium text-blue-800">Enable iTax Integration</h3>
                        <p className="text-sm text-blue-700 mt-1">
                          Connect your iTax account to automatically submit VAT returns.
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  <button
                    onClick={() => setShowItaxForm(true)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Setup iTax Integration
                  </button>
                </div>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                    <div>
                      <h3 className="font-medium text-green-800">iTax Integration Active</h3>
                      <p className="text-sm text-green-700 mt-1">
                        Your system is connected to KRA iTax for automated VAT return submissions.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* VAT Returns */}
        {activeTab === 'vat-returns' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-gray-900">VAT Return Submission</h2>
                <select
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value)}
                  className="px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" aria-label="{date.toLocaleDateString('en-KE', { year: 'numeric', month: 'long' })}">
                  {Array.from({ length: 12 }, (_, i) => {
                    const date = new Date();
                    date.setMonth(date.getMonth() - i);
                    const period = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                    return (
                      <option key={period} value={period}>
                        {date.toLocaleDateString('en-KE', { year: 'numeric', month: 'long' })}
                      </option>
                    );
                  })}
                </select>
              </div>

              {vatData && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-blue-50 rounded-lg p-4">
                      <p className="text-sm font-medium text-blue-700">Total Sales</p>
                      <p className="text-xl font-bold text-blue-900">{formatKES(vatData.totalSales)}</p>
                      <p className="text-xs text-blue-600">{vatData.salesCount} transactions</p>
                    </div>
                    <div className="bg-green-50 rounded-lg p-4">
                      <p className="text-sm font-medium text-green-700">VAT on Sales</p>
                      <p className="text-xl font-bold text-green-900">{formatKES(vatData.vatOnSales)}</p>
                    </div>
                    <div className="bg-orange-50 rounded-lg p-4">
                      <p className="text-sm font-medium text-orange-700">VAT on Purchases</p>
                      <p className="text-xl font-bold text-orange-900">{formatKES(vatData.vatOnPurchases)}</p>
                      <p className="text-xs text-orange-600">{vatData.expensesCount} expenses</p>
                    </div>
                    <div className="bg-purple-50 rounded-lg p-4">
                      <p className="text-sm font-medium text-purple-700">Net VAT</p>
                      <p className="text-xl font-bold text-purple-900">{formatKES(vatData.netVat)}</p>
                    </div>
                  </div>

                  {business?.kraItaxIntegrationEnabled ? (
                    <button
                      onClick={handleVatSubmission}
                      disabled={submitVatMutation.isPending}
                      className="w-full py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                    >
                      {submitVatMutation.isPending ? 'Submitting...' : 'Submit VAT Return to iTax'}
                    </button>
                  ) : (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <p className="text-sm text-yellow-800">
                        Enable iTax integration to automatically submit VAT returns.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* iTax Setup Form Modal */}
      {showItaxForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Setup iTax Integration</h2>
            </div>
            <form onSubmit={handleItaxSetup} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">iTax Username</label>
                <input
                  name="username"
                  type="text"
                  required
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">iTax Password</label>
                <input
                  name="password"
                  type="password"
                  required
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">KRA PIN</label>
                <input
                  name="kraPin"
                  type="text"
                  required
                  pattern="[A-Z]\d{9}[A-Z]"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="A123456789Z"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowItaxForm(false)}
                  className="flex-1 py-2 text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={enableItaxMutation.isPending}
                  className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {enableItaxMutation.isPending ? 'Connecting...' : 'Connect'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}