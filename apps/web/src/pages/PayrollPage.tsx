import { useState } from 'react';
import { useDialog } from '../components/Dialog';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DollarSign, Plus, CheckCircle, CreditCard, Printer,
  ChevronLeft, Loader2, Trash2, AlertCircle, Users,
  LayoutDashboard, FileText, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { printHtml } from '../lib/printHtml';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Payslip {
  id: string;
  employeeId: string;
  employeeName: string;
  basicSalary: number;
  housingAllowance: number;
  transportAllowance: number;
  otherAllowances: number;
  grossPay: number;
  payeAmount: number;
  shifAmount: number;
  nssf1Amount: number;
  nssf2Amount: number;
  housingLevyAmount: number;
  otherDeductions: number;
  netPay: number;
  commissionCents: number;
  status: string;
}

interface PayrollRun {
  id: string;
  businessId: string;
  month: number;
  year: number;
  status: string;
  totalGrossCents: number;
  totalNetCents: number;
  totalDeductionsCents: number;
  notes?: string;
  approvedBy?: string;
  paidAt?: string;
  createdAt: string;
  payslips: Payslip[];
}

interface Employee {
  id: string;
  user: { name: string; email: string; role: string };
}

interface ExpenseClaim {
  id: string;
  employeeId: string;
  amountCents: number;
  description: string;
  category: string;
  status: string;
  submittedAt: string;
  approvedBy?: string;
  rejectedBy?: string;
  rejectionReason?: string;
  employee: { user: { name: string } };
}

interface LeaveRequest {
  id: string;
  status: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(cents: number): string {
  return `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function statusColor(status: string): string {
  switch (status) {
    case 'DRAFT':    return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
    case 'APPROVED': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
    case 'PAID':     return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
    default:         return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
  }
}

function claimStatusColor(status: string): string {
  switch (status) {
    case 'PENDING':  return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
    case 'APPROVED': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
    case 'REJECTED': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
    case 'PAID':     return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
    default:         return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
  }
}

const CLAIM_CATEGORIES = ['FUEL', 'MEALS', 'ACCOMMODATION', 'TRANSPORT', 'OTHER'];

// ─── Print helper ─────────────────────────────────────────────────────────────

function printPayslips(run: PayrollRun) {
  const monthName = MONTHS[run.month - 1];
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payslips — ${monthName} ${run.year}</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 12px; color: #111; }
        h1 { font-size: 16px; margin-bottom: 4px; }
        .payslip { page-break-after: always; padding: 20px; border: 1px solid #ccc; margin-bottom: 20px; }
        .payslip:last-child { page-break-after: avoid; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        td, th { padding: 6px 8px; border-bottom: 1px solid #eee; text-align: left; }
        th { background: #f4f4f4; font-weight: bold; }
        .right { text-align: right; }
        .total-row td { font-weight: bold; border-top: 2px solid #333; }
        .section-header { background: #e8e8e8; font-weight: bold; }
        .net-row td { background: #1F6BFF; color: white; font-size: 14px; font-weight: bold; }
      </style>
    </head>
    <body>
    ${run.payslips.map((p) => `
      <div class="payslip">
        <h1>PAYSLIP</h1>
        <p><strong>Period:</strong> ${monthName} ${run.year}</p>
        <p><strong>Employee:</strong> ${p.employeeName}</p>
        <p><strong>Status:</strong> ${p.status}</p>
        <table>
          <tr class="section-header"><td colspan="2">EARNINGS</td></tr>
          <tr><td>Basic Salary</td><td class="right">${fmt(p.basicSalary)}</td></tr>
          ${p.housingAllowance > 0 ? `<tr><td>Housing Allowance</td><td class="right">${fmt(p.housingAllowance)}</td></tr>` : ''}
          ${p.transportAllowance > 0 ? `<tr><td>Transport Allowance</td><td class="right">${fmt(p.transportAllowance)}</td></tr>` : ''}
          ${p.commissionCents > 0 ? `<tr><td>Commission</td><td class="right">${fmt(p.commissionCents)}</td></tr>` : ''}
          ${p.otherAllowances > 0 ? `<tr><td>Other Allowances</td><td class="right">${fmt(p.otherAllowances)}</td></tr>` : ''}
          <tr class="total-row"><td>GROSS PAY</td><td class="right">${fmt(p.grossPay)}</td></tr>

          <tr class="section-header"><td colspan="2">DEDUCTIONS</td></tr>
          <tr><td>PAYE (Income Tax)</td><td class="right">${fmt(p.payeAmount)}</td></tr>
          <tr><td>SHIF</td><td class="right">${fmt(p.shifAmount)}</td></tr>
          <tr><td>NSSF Tier 1</td><td class="right">${fmt(p.nssf1Amount)}</td></tr>
          <tr><td>NSSF Tier 2</td><td class="right">${fmt(p.nssf2Amount)}</td></tr>
          <tr><td>Affordable Housing Levy (1.5%)</td><td class="right">${fmt(p.housingLevyAmount)}</td></tr>
          ${p.otherDeductions > 0 ? `<tr><td>Other Deductions</td><td class="right">${fmt(p.otherDeductions)}</td></tr>` : ''}
          <tr class="total-row"><td>TOTAL DEDUCTIONS</td><td class="right">${fmt(p.payeAmount + p.shifAmount + p.nssf1Amount + p.nssf2Amount + p.housingLevyAmount + p.otherDeductions)}</td></tr>

          <tr class="net-row"><td>NET PAY</td><td class="right">${fmt(p.netPay)}</td></tr>
        </table>
        <p style="margin-top:16px; font-size:10px; color:#666;">This is a computer-generated payslip. No signature required.</p>
      </div>
    `).join('')}
    </body>
    </html>
  `;

  printHtml(html);
}

// ─── Payslip Detail Table ─────────────────────────────────────────────────────

function PayslipTable({ payslips, month, year }: { payslips: Payslip[]; month: number; year: number }) {
  const totals = payslips.reduce(
    (acc, p) => ({
      basic: acc.basic + p.basicSalary,
      housing: acc.housing + p.housingAllowance,
      transport: acc.transport + p.transportAllowance,
      commission: acc.commission + p.commissionCents,
      gross: acc.gross + p.grossPay,
      paye: acc.paye + p.payeAmount,
      shif: acc.shif + p.shifAmount,
      nssf1: acc.nssf1 + p.nssf1Amount,
      nssf2: acc.nssf2 + p.nssf2Amount,
      housing_levy: acc.housing_levy + p.housingLevyAmount,
      net: acc.net + p.netPay,
    }),
    { basic: 0, housing: 0, transport: 0, commission: 0, gross: 0, paye: 0, shif: 0, nssf1: 0, nssf2: 0, housing_levy: 0, net: 0 },
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-100 dark:bg-gray-700 text-left">
            <th className="px-3 py-2 font-semibold text-gray-700 dark:text-gray-300">Employee</th>
            <th className="px-3 py-2 font-semibold text-gray-700 dark:text-gray-300 text-right">Basic</th>
            <th className="px-3 py-2 font-semibold text-gray-700 dark:text-gray-300 text-right">Allowances</th>
            <th className="px-3 py-2 font-semibold text-gray-700 dark:text-gray-300 text-right">Commission</th>
            <th className="px-3 py-2 font-semibold text-gray-700 dark:text-gray-300 text-right">Gross</th>
            <th className="px-3 py-2 font-semibold text-gray-700 dark:text-gray-300 text-right">PAYE</th>
            <th className="px-3 py-2 font-semibold text-gray-700 dark:text-gray-300 text-right">SHIF</th>
            <th className="px-3 py-2 font-semibold text-gray-700 dark:text-gray-300 text-right">NSSF</th>
            <th className="px-3 py-2 font-semibold text-gray-700 dark:text-gray-300 text-right">Hse Levy</th>
            <th className="px-3 py-2 font-semibold text-gray-700 dark:text-gray-300 text-right">Net Pay</th>
            <th className="px-3 py-2 font-semibold text-gray-700 dark:text-gray-300">Status</th>
            <th className="px-3 py-2 font-semibold text-gray-700 dark:text-gray-300">PDFs</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
          {payslips.map((p) => (
            <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
              <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{p.employeeName}</td>
              <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{fmt(p.basicSalary)}</td>
              <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{fmt(p.housingAllowance + p.transportAllowance + p.otherAllowances)}</td>
              <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{fmt(p.commissionCents)}</td>
              <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-white">{fmt(p.grossPay)}</td>
              <td className="px-3 py-2 text-right text-red-600 dark:text-red-400">{fmt(p.payeAmount)}</td>
              <td className="px-3 py-2 text-right text-red-600 dark:text-red-400">{fmt(p.shifAmount)}</td>
              <td className="px-3 py-2 text-right text-red-600 dark:text-red-400">{fmt(p.nssf1Amount + p.nssf2Amount)}</td>
              <td className="px-3 py-2 text-right text-red-600 dark:text-red-400">{fmt(p.housingLevyAmount)}</td>
              <td className="px-3 py-2 text-right font-bold text-green-700 dark:text-green-400">{fmt(p.netPay)}</td>
              <td className="px-3 py-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.status === 'PAID' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>
                  {p.status}
                </span>
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <a
                    href={`/api/v1/reports/pdf/payslip/${p.employeeId}?month=${month}&year=${year}`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2 py-0.5 text-[11px] font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                    title="Open payslip PDF"
                  >
                    Payslip
                  </a>
                  <a
                    href={`/api/v1/reports/pdf/p9/${p.employeeId}?year=${year}`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2 py-0.5 text-[11px] font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 rounded transition-colors"
                    title="Open KRA P9A annual form"
                  >
                    P9A
                  </a>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-gray-100 dark:bg-gray-700 font-bold border-t-2 border-gray-300 dark:border-gray-600">
            <td className="px-3 py-2 text-gray-900 dark:text-white">TOTALS</td>
            <td className="px-3 py-2 text-right text-gray-900 dark:text-white">{fmt(totals.basic)}</td>
            <td className="px-3 py-2 text-right text-gray-900 dark:text-white">{fmt(totals.housing + totals.transport)}</td>
            <td className="px-3 py-2 text-right text-gray-900 dark:text-white">{fmt(totals.commission)}</td>
            <td className="px-3 py-2 text-right text-gray-900 dark:text-white">{fmt(totals.gross)}</td>
            <td className="px-3 py-2 text-right text-red-700 dark:text-red-400">{fmt(totals.paye)}</td>
            <td className="px-3 py-2 text-right text-red-700 dark:text-red-400">{fmt(totals.shif)}</td>
            <td className="px-3 py-2 text-right text-red-700 dark:text-red-400">{fmt(totals.nssf1 + totals.nssf2)}</td>
            <td className="px-3 py-2 text-right text-red-700 dark:text-red-400">{fmt(totals.housing_levy)}</td>
            <td className="px-3 py-2 text-right text-green-700 dark:text-green-400">{fmt(totals.net)}</td>
            <td />
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── New Claim Modal ──────────────────────────────────────────────────────────

interface NewClaimModalProps {
  employees: Employee[];
  businessId: string;
  onClose: () => void;
  onCreate: (data: { businessId: string; employeeId: string; amountCents: number; description: string; category: string }) => void;
  isPending: boolean;
}

function NewClaimModal({ employees, businessId, onClose, onCreate, isPending }: NewClaimModalProps) {
  const [employeeId, setEmployeeId] = useState('');
  const [category, setCategory] = useState('OTHER');
  const [amountKes, setAmountKes] = useState('');
  const [description, setDescription] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId || !amountKes || !description) return;
    onCreate({
      businessId,
      employeeId,
      amountCents: Math.round(parseFloat(amountKes) * 100),
      description,
      category,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">New Expense Claim</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Employee</label>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              required
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
              <option value="">Select employee...</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.user.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              {CLAIM_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount (KES)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amountKes}
              onChange={(e) => setAmountKes(e.target.value)}
              required
              placeholder="0.00"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={3}
              placeholder="Describe the expense..."
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none"
            />
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Submit Claim
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

interface OverviewTabProps {
  employees: Employee[];
  claims: ExpenseClaim[];
  runs: PayrollRun[];
  pendingLeaves: LeaveRequest[];
  onGoToPayroll: () => void;
  onGoToClaims: () => void;
}

function OverviewTab({ employees, claims, runs, pendingLeaves, onGoToPayroll, onGoToClaims }: OverviewTabProps) {
  const now = new Date();
  const thisMonth = runs.find((r) => r.month === now.getMonth() + 1 && r.year === now.getFullYear());
  const pendingClaimsCount = claims.filter((c) => c.status === 'PENDING').length;
  const pendingLeavesCount = pendingLeaves.filter((l) => l.status === 'PENDING').length;

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{employees.length}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Total Employees</p>
        </div>
        <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-300">{pendingClaimsCount}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Pending Claims</p>
        </div>
        <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-green-700 dark:text-green-300">
            {thisMonth ? `KES ${(thisMonth.totalNetCents / 100).toLocaleString('en-KE', { maximumFractionDigits: 0 })}` : '—'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">This Month's Net Pay</p>
        </div>
        <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-purple-700 dark:text-purple-300">{pendingLeavesCount}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Pending Leave Requests</p>
        </div>
      </div>

      {/* Quick actions */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Quick Actions</h3>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={onGoToPayroll}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            <DollarSign className="w-4 h-4" />
            Run Payroll
          </button>
          <button
            onClick={onGoToClaims}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600"
          >
            <FileText className="w-4 h-4" />
            View Claims
          </button>
        </div>
      </div>

      {/* Recent payroll runs */}
      {runs.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Recent Payroll Runs</h3>
          <div className="space-y-2">
            {runs.slice(0, 5).map((run) => (
              <div key={run.id} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  {MONTHS[run.month - 1]} {run.year}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 dark:text-gray-400">{fmt(run.totalNetCents)}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusColor(run.status)}`}>
                    {run.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Claims Tab ───────────────────────────────────────────────────────────────

interface ClaimsTabProps {
  claims: ExpenseClaim[];
  employees: Employee[];
  businessId: string;
  userRole: string;
  userId: string;
}

function ClaimsTab({ claims, employees, businessId, userRole, userId }: ClaimsTabProps) {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const canManage = userRole === 'OWNER' || userRole === 'MANAGER';

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/hr/expense-claims/${id}/approve`, { approverId: userId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['expense-claims', businessId] }),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.patch(`/hr/expense-claims/${id}/reject`, { rejectorId: userId, reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['expense-claims', businessId] }),
  });

  const paidMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/hr/expense-claims/${id}/paid`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['expense-claims', businessId] }),
  });

  const createClaimMutation = useMutation({
    mutationFn: (data: { businessId: string; employeeId: string; amountCents: number; description: string; category: string }) =>
      api.post('/hr/expense-claims', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expense-claims', businessId] });
      setShowModal(false);
    },
  });

  function handleReject(id: string) {
    setRejectingId(id);
    setRejectReason('');
  }

  function confirmReject() {
    if (!rejectingId || !rejectReason.trim()) { toast.warning('Please enter a rejection reason'); return; }
    rejectMutation.mutate({ id: rejectingId, reason: rejectReason.trim() });
    setRejectingId(null);
    setRejectReason('');
  }

  return (
    <div className="space-y-4">
      {showModal && (
        <NewClaimModal
          employees={employees}
          businessId={businessId}
          onClose={() => setShowModal(false)}
          onCreate={(data) => createClaimMutation.mutate(data)}
          isPending={createClaimMutation.isPending}
        />
      )}

      {/* Reject reason modal */}
      {rejectingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">Rejection Reason</h3>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Enter reason for rejection…"
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-red-500"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setRejectingId(null); setRejectReason(''); }} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
              <button onClick={confirmReject} disabled={rejectMutation.isPending} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                {rejectMutation.isPending ? 'Rejecting…' : 'Reject Claim'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Expense Claims</h2>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          New Claim
        </button>
      </div>

      {claims.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-500 dark:text-gray-400">
          <FileText className="w-12 h-12 mb-3 opacity-30" />
          <p className="text-lg font-medium">No expense claims yet</p>
          <p className="text-sm mt-1">Submit a claim to get started</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700 text-left">
                  <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Employee</th>
                  <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Category</th>
                  <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 text-right">Amount</th>
                  <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Description</th>
                  <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Status</th>
                  <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Date</th>
                  <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {claims.map((claim) => (
                  <tr key={claim.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                      {claim.employee?.user?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-xs font-medium">
                        {claim.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">
                      {fmt(claim.amountCents)}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400 max-w-[200px] truncate" title={claim.description}>
                      {claim.description}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${claimStatusColor(claim.status)}`}>
                        {claim.status}
                      </span>
                      {claim.rejectionReason && (
                        <p className="text-xs text-red-500 mt-0.5">{claim.rejectionReason}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">
                      {new Date(claim.submittedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {claim.status === 'PENDING' && canManage && (
                          <>
                            <button
                              onClick={() => approveMutation.mutate(claim.id)}
                              disabled={approveMutation.isPending}
                              title="Approve"
                              className="p-1.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded hover:bg-green-200 dark:hover:bg-green-900/50 disabled:opacity-50"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleReject(claim.id)}
                              disabled={rejectMutation.isPending}
                              title="Reject"
                              className="p-1.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-50"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        {claim.status === 'APPROVED' && userRole === 'OWNER' && (
                          <button
                            onClick={() => paidMutation.mutate(claim.id)}
                            disabled={paidMutation.isPending}
                            className="flex items-center gap-1 px-2 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                          >
                            {paidMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CreditCard className="w-3 h-3" />}
                            Mark Paid
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'payroll' | 'claims';

export default function PayrollPage() {
  const user = useAuthStore(s => s.user);
  const businessId = user?.businessId ?? '';
  const queryClient = useQueryClient();
  const { confirm } = useDialog();

  const now = new Date();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedRun, setSelectedRun] = useState<PayrollRun | null>(null);
  const [error, setError] = useState('');

  const canManage = user?.role === 'OWNER' || user?.role === 'MANAGER';

  // Fetch payroll runs
  const { data: runs = [], isLoading } = useQuery<PayrollRun[]>({
    queryKey: ['payroll-runs', businessId],
    queryFn: () => api.get(`/hr/payroll?businessId=${businessId}`),
    enabled: !!businessId,
  });

  // Fetch employees
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ['employees', businessId],
    queryFn: () => api.get<Employee[]>(`/hr/employees?businessId=${businessId}`),
    enabled: !!businessId,
  });

  // Fetch expense claims
  const { data: claims = [] } = useQuery<ExpenseClaim[]>({
    queryKey: ['expense-claims', businessId],
    queryFn: () => api.get<ExpenseClaim[]>(`/hr/expense-claims?businessId=${businessId}`),
    enabled: !!businessId,
  });

  // Fetch pending leaves for overview
  const { data: pendingLeaves = [] } = useQuery<LeaveRequest[]>({
    queryKey: ['pending-leaves', businessId],
    queryFn: () => api.get<LeaveRequest[]>(`/hr/leave?businessId=${businessId}`),
    enabled: !!businessId,
  });

  // Generate payroll run
  const generateMutation = useMutation({
    mutationFn: () =>
      api.post<PayrollRun>('/hr/payroll', {
        businessId,
        month: selectedMonth,
        year: selectedYear,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-runs', businessId] });
      setError('');
    },
    onError: (e: Error) => setError(e.message),
  });

  // Approve
  const approveMutation = useMutation({
    mutationFn: (runId: string) =>
      api.patch<PayrollRun>(`/hr/payroll/${runId}/approve`, { approvedBy: user?.name ?? 'Manager' }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['payroll-runs', businessId] });
      setSelectedRun(updated);
    },
    onError: (e: Error) => setError(e.message),
  });

  // Mark as paid
  const paidMutation = useMutation({
    mutationFn: (runId: string) => api.patch<PayrollRun>(`/hr/payroll/${runId}/paid`, {}),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['payroll-runs', businessId] });
      setSelectedRun(updated);
    },
    onError: (e: Error) => setError(e.message),
  });

  // Delete
  const deleteMutation = useMutation({
    mutationFn: (runId: string) => api.delete<{ deleted: boolean }>(`/hr/payroll/${runId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-runs', businessId] });
      setSelectedRun(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const bulkSendMutation = useMutation({
    mutationFn: ({ runId, channel }: { runId: string; channel: string }) =>
      api.post<{ sent: number; channel: string }>(`/hr/payroll/${runId}/bulk-send`, { channel }),
    onSuccess: (data) => toast.success(`Sent ${data.sent} payslips via ${data.channel}`),
    onError: (e: Error) => setError(e.message),
  });

  const b2cMutation = useMutation({
    mutationFn: (runId: string) => api.post(`/payments/mpesa/b2c-bulk`, { businessId, payrollRunId: runId }),
    onSuccess: () => toast.success('M-Pesa B2C disbursement initiated — check Safaricom dashboard for status'),
    onError: (e: Error) => setError(e.message),
  });

  const yearOptions = [selectedYear - 2, selectedYear - 1, selectedYear, selectedYear + 1];

  // ─── Payroll run detail view ─────────────────────────────────────────────────

  if (selectedRun) {
    return (
      <div className="p-4 max-w-full">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => setSelectedRun(null)}
            className="flex items-center gap-1 text-blue-600 hover:text-blue-800 dark:text-blue-400"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Payroll Runs
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => printPayslips(selectedRun)}
              className="flex items-center gap-1 px-3 py-1.5 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm"
            >
              <Printer className="w-4 h-4" />
              Print Payslips
            </button>
            {canManage && selectedRun.status === 'DRAFT' && (
              <button
                onClick={() => approveMutation.mutate(selectedRun.id)}
                disabled={approveMutation.isPending}
                className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-50"
              >
                {approveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                Approve
              </button>
            )}
            {canManage && selectedRun.status === 'APPROVED' && (
              <button
                onClick={() => paidMutation.mutate(selectedRun.id)}
                disabled={paidMutation.isPending}
                className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 text-sm disabled:opacity-50"
              >
                {paidMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                Mark Paid
              </button>
            )}
            {canManage && (selectedRun.status === 'APPROVED' || selectedRun.status === 'PAID') && (
              <>
                <button
                  onClick={() => bulkSendMutation.mutate({ runId: selectedRun.id, channel: 'EMAIL' })}
                  disabled={bulkSendMutation.isPending}
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-50"
                >
                  {bulkSendMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                  Email Payslips
                </button>
                <button
                  onClick={() => bulkSendMutation.mutate({ runId: selectedRun.id, channel: 'WHATSAPP' })}
                  disabled={bulkSendMutation.isPending}
                  className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 text-sm disabled:opacity-50"
                >
                  {bulkSendMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                  WhatsApp Payslips
                </button>
              </>
            )}
            {canManage && selectedRun.status === 'PAID' && (
              <button
                onClick={async () => { const ok = await confirm({ title: 'Send M-Pesa Disbursements', message: 'Send M-Pesa B2C disbursements to all employees? This action will initiate real payments.', variant: 'warning', confirmLabel: 'Send Payments' }); if (ok) b2cMutation.mutate(selectedRun.id); }}
                disabled={b2cMutation.isPending}
                className="flex items-center gap-1 px-3 py-1.5 bg-green-700 text-white rounded hover:bg-green-800 text-sm disabled:opacity-50"
              >
                {b2cMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                M-Pesa B2C
              </button>
            )}
            {canManage && selectedRun.status === 'DRAFT' && (
              <button
                onClick={async () => {
                  const ok = await confirm({ title: 'Delete Payroll Run', message: 'Delete this draft payroll run? This cannot be undone.', variant: 'danger', confirmLabel: 'Delete' });
                  if (ok) deleteMutation.mutate(selectedRun.id);
                }}
                disabled={deleteMutation.isPending}
                className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 text-sm disabled:opacity-50"
              >
                {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete
              </button>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {MONTHS[selectedRun.month - 1]} {selectedRun.year} Payroll
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {selectedRun.payslips.length} employee{selectedRun.payslips.length !== 1 ? 's' : ''}
                {selectedRun.approvedBy ? ` · Approved by ${selectedRun.approvedBy}` : ''}
                {selectedRun.paidAt ? ` · Paid ${new Date(selectedRun.paidAt).toLocaleDateString()}` : ''}
              </p>
            </div>
            <span className={`px-3 py-1 rounded-full text-sm font-semibold ${statusColor(selectedRun.status)}`}>
              {selectedRun.status}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4">
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">Total Gross</p>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{fmt(selectedRun.totalGrossCents)}</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">Total Deductions</p>
              <p className="text-lg font-bold text-red-600 dark:text-red-400">{fmt(selectedRun.totalDeductionsCents)}</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">Total Net Pay</p>
              <p className="text-lg font-bold text-green-700 dark:text-green-400">{fmt(selectedRun.totalNetCents)}</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 mb-4 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white">Payslip Breakdown</h3>
          </div>
          {selectedRun.payslips.length === 0 ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">No payslips found.</div>
          ) : (
            <PayslipTable payslips={selectedRun.payslips} month={selectedRun.month} year={selectedRun.year} />
          )}
        </div>

        <div className="mt-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-xs text-blue-700 dark:text-blue-400">
          <strong>Kenya 2024 Tax Rates Applied:</strong> PAYE (10%–35% brackets, KES 2,400 personal relief, charged on pay after allowable deductions) · SHIF (2.75% of gross, min KES 300) · NSSF Tier 1 (6% of KES 7,000) + Tier 2 (6% of excess up to KES 29,000) · Affordable Housing Levy (1.5% of gross). SHIF, NSSF and the housing levy are deducted before PAYE per the Tax Laws (Amendment) Act 2024.
        </div>
      </div>
    );
  }

  // ─── Tabbed list view ────────────────────────────────────────────────────────

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'payroll', label: 'Payroll Runs', icon: <DollarSign className="w-4 h-4" /> },
    { id: 'claims', label: 'Claims', icon: <FileText className="w-4 h-4" /> },
  ];

  return (
    <div className="p-4 max-w-full">
      {/* Page header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">HR &amp; Payroll</h1>
        </div>

        {activeTab === 'payroll' && canManage && (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              {MONTHS.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <button
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
            >
              {generateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Generate Payroll
            </button>
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 mb-6 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 mb-4 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={() => setError('')} className="ml-auto text-red-500 hover:text-red-700">x</button>
        </div>
      )}

      {/* Tab content */}
      {activeTab === 'overview' && (
        <OverviewTab
          employees={employees}
          claims={claims}
          runs={runs}
          pendingLeaves={pendingLeaves}
          onGoToPayroll={() => setActiveTab('payroll')}
          onGoToClaims={() => setActiveTab('claims')}
        />
      )}

      {activeTab === 'payroll' && (
        <>
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : runs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500 dark:text-gray-400">
              <DollarSign className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-lg font-medium">No payroll runs yet</p>
              <p className="text-sm mt-1">Select a month and year, then click Generate Payroll</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="surface-interactive rounded-xl p-4" role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.currentTarget.click(); } }}
                  onClick={async () => {
                    const full = await api.get<PayrollRun>(`/hr/payroll/${run.id}/payslips`);
                    setSelectedRun(full);
                  }}
                >
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                        <DollarSign className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-white">
                          {MONTHS[run.month - 1]} {run.year}
                        </h3>
                        <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                          <Users className="w-3.5 h-3.5" />
                          {run.payslips.length} employee{run.payslips.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Gross</p>
                        <p className="font-semibold text-gray-900 dark:text-white">{fmt(run.totalGrossCents)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Deductions</p>
                        <p className="font-semibold text-red-600 dark:text-red-400">{fmt(run.totalDeductionsCents)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Net Pay</p>
                        <p className="font-bold text-green-700 dark:text-green-400">{fmt(run.totalNetCents)}</p>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColor(run.status)}`}>
                        {run.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-400">
            <strong>Note:</strong> Employee salary details (basic salary, housing allowance, transport allowance) must be configured on each employee record. Commissions are automatically calculated from sales data for the selected period. Generated payslips use current Kenyan statutory rates (PAYE, SHIF, NSSF, Housing Levy).
          </div>
        </>
      )}

      {activeTab === 'claims' && (
        <ClaimsTab
          claims={claims}
          employees={employees}
          businessId={businessId}
          userRole={user?.role ?? ''}
          userId={user?.id ?? ''}
        />
      )}
    </div>
  );
}
