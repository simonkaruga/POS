import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ShoppingCart, BarChart3, Package, Settings, LogOut, Users,
  CreditCard, Truck, DollarSign, UserCheck, Coffee, Layers,
  Bell, ChevronDown, Wallet, Hash, ChefHat, Box,
  Tag, Gift, Sun, Moon, Monitor, Wand2, ArrowRightLeft, LayoutDashboard,
  AlertTriangle, X, Pill, CalendarClock, TrendingUp, GitBranch, Landmark,
  Fuel, Lock, BedDouble, CheckCircle2, Trash2, Radio, BookOpen,
  Link2, FileText, Clock, Send, Shield, Tablet, Fingerprint,
  ClipboardList, MapPin, Store, Zap, Building2, PanelLeftClose, PanelLeftOpen,
  ShoppingBag, HardDrive, KeyRound,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { readLastKnown, writeLastKnown } from '../lib/lastKnown';
import { prefetchRoute } from '../lib/routeLoaders';
import { api, getToken, setToken } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';
import { connectSocket, disconnectSocket, subscribeToEvent, SocketEvents } from '../lib/socket';
import { keepsOwnData } from '../lib/desktopSetup';
import { useDesktopMode } from '../lib/useLocalServer';
import { toast } from 'sonner';
import SyncStatusBadge, { OfflineBanner } from './SyncStatusBadge';
import LicenseBanner from './LicenseBanner';
import UpdateBanner from './UpdateBanner';
import { useLicense } from '../lib/license';
import MobileNav from './MobileNav';
import { hasFeature } from '../lib/featureGates';
import { parseEnabledModules } from '@pos/shared';

interface NavItem {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  roles?: string[];
}

interface NavGroup {
  label: string;
  roles?: string[];
  items: NavItem[];
}

interface NavItemWithBusinessTypes extends NavItem {
  businessTypes?: string[];
  /** Optional modules that also reveal this item, whatever the business type. */
  modules?: string[];
  /** Business types that already have this elsewhere, so the module entry is hidden for them. */
  notForTypes?: string[];
  newTab?: boolean; // open in new browser tab
}

interface NavGroupWithBusinessTypes extends Omit<NavGroup, 'items'> {
  businessTypes?: string[];
  items: NavItemWithBusinessTypes[];
}

const NAV_GROUPS: NavGroupWithBusinessTypes[] = [
  {
    label: 'Home',
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/agent', icon: UserCheck, label: 'Agent Dashboard', roles: ['SALES_AGENT', 'OWNER', 'MANAGER'] },
    ],
  },
  {
    label: 'Sales',
    items: [
      // /pos is the universal entry-point; POSRouterPage redirects to the right UI per posMode
      { to: '/pos', icon: ShoppingCart, label: 'Point of Sale', roles: ['OWNER', 'MANAGER', 'CASHIER', 'WAITER'] },
      { to: '/kds', icon: Monitor, label: 'Kitchen Display', roles: ['OWNER', 'MANAGER', 'WAITER', 'KITCHEN'], businessTypes: ['HOSPITALITY', 'FAST_FOOD', 'BAR_TAB'], modules: ['RESTAURANT'] },
      // A fuel station or shop that runs a restaurant on the side: the till stays its main POS, tables live here.
      { to: '/hospitality', icon: Coffee, label: 'Restaurant Tables', roles: ['OWNER', 'MANAGER', 'WAITER', 'CASHIER'], businessTypes: [], modules: ['RESTAURANT'], notForTypes: ['HOSPITALITY', 'FAST_FOOD', 'BAR_TAB'] },
      // Kiosk mode is launched from within the POS page (not a permanent nav item)
      { to: '/layaway', icon: Layers, label: 'Layaway', roles: ['OWNER', 'MANAGER', 'CASHIER'], businessTypes: ['RETAIL', 'SUPERMARKET'] },
      { to: '/proforma', icon: CreditCard, label: 'Proformas', roles: ['OWNER', 'MANAGER', 'CASHIER'] },
      { to: '/prescriptions', icon: Pill, label: 'Prescriptions', roles: ['OWNER', 'MANAGER', 'CASHIER'], businessTypes: ['CLINIC'] },
      { to: '/pharmacy', icon: Pill, label: 'Pharmacy Mgmt', roles: ['OWNER', 'MANAGER'], businessTypes: ['CLINIC'] },
      { to: '/appointments', icon: CalendarClock, label: 'Appointments', roles: ['OWNER', 'MANAGER', 'CASHIER'], businessTypes: ['CLINIC', 'SALON'] },
    ],
  },
  {
    label: 'Operations',
    roles: ['OWNER', 'MANAGER'],
    items: [
      { to: '/delivery', icon: Truck, label: 'Delivery', businessTypes: ['HOSPITALITY', 'FAST_FOOD', 'RETAIL', 'SUPERMARKET'] },
      { to: '/online-orders', icon: ShoppingBag, label: 'Online Orders', roles: ['OWNER', 'MANAGER', 'CASHIER'], businessTypes: ['HOSPITALITY', 'FAST_FOOD', 'RETAIL', 'SUPERMARKET'] },
      { to: '/delivery-management', icon: Truck, label: 'Delivery Dispatch', roles: ['OWNER', 'MANAGER'], businessTypes: ['HOSPITALITY', 'FAST_FOOD', 'RETAIL', 'SUPERMARKET'] },
      { to: '/field-orders', icon: ClipboardList, label: 'Field Orders', roles: ['OWNER', 'MANAGER', 'CASHIER'] },
      { to: '/delivery-routes', icon: MapPin, label: 'Delivery Routes', roles: ['OWNER', 'MANAGER'] },
      { to: '/waitlist', icon: Clock, label: 'Waitlist', roles: ['OWNER', 'MANAGER', 'WAITER'], businessTypes: ['HOSPITALITY', 'FAST_FOOD'] },
      { to: '/hotel', icon: BedDouble, label: 'Hotel Integration', roles: ['OWNER', 'MANAGER'], businessTypes: ['HOSPITALITY'], modules: ['HOTEL'] },
      { to: '/channel-manager', icon: Radio, label: 'Channel Manager', roles: ['OWNER', 'MANAGER'], businessTypes: ['HOSPITALITY'], modules: ['HOTEL'] },
      { to: '/fuel-pump', icon: Fuel, label: 'Fuel Pumps', roles: ['OWNER', 'MANAGER', 'CASHIER'], businessTypes: ['FUEL_PUMP'] },
      { to: '/cybercafe', icon: Monitor, label: 'Cybercafe', roles: ['OWNER', 'MANAGER', 'CASHIER'], businessTypes: ['CYBERCAFE'] },
    ],
  },
  {
    label: 'Inventory',
    roles: ['OWNER', 'MANAGER'],
    items: [
      { to: '/inventory', icon: Package, label: 'Items & Stock' },
      { to: '/batch', icon: Layers, label: 'Batch & Expiry', businessTypes: ['CLINIC', 'SUPERMARKET'] },
      { to: '/serial', icon: Hash, label: 'Serial Tracking', businessTypes: ['RETAIL'] },
      { to: '/recipe', icon: ChefHat, label: 'Recipes / BOM', businessTypes: ['HOSPITALITY', 'FAST_FOOD'] },
      { to: '/bundle', icon: Box, label: 'Bundles / Kits' },
      { to: '/suppliers', icon: Truck, label: 'Suppliers & POs' },
      { to: '/rfq', icon: Send, label: 'RFQ', roles: ['OWNER', 'MANAGER'] },
      { to: '/transfers', icon: ArrowRightLeft, label: 'Stock Transfers' },
      { to: '/stocktake', icon: CheckCircle2, label: 'Stocktake' },
      { to: '/damaged-goods', icon: Trash2, label: 'Damaged Goods' },
    ],
  },
  {
    label: 'Finance',
    roles: ['OWNER', 'MANAGER', 'ACCOUNTANT', 'CASHIER'],
    items: [
      { to: '/owner-dashboard', icon: LayoutDashboard, label: 'Owner Dashboard', roles: ['OWNER'] },
      { to: '/cash-drawer', icon: Wallet, label: 'Cash Drawer' },
      { to: '/expenses', icon: DollarSign, label: 'Expenses', roles: ['OWNER', 'MANAGER', 'ACCOUNTANT'] },
      { to: '/cheques', icon: FileText, label: 'Cheques', roles: ['OWNER', 'MANAGER', 'ACCOUNTANT'] },
      { to: '/ledger', icon: BookOpen, label: 'General Ledger', roles: ['OWNER', 'MANAGER', 'ACCOUNTANT'] },
      { to: '/reconciliation', icon: Landmark, label: 'Reconciliation', roles: ['OWNER', 'MANAGER', 'ACCOUNTANT'] },
      { to: '/payment-links', icon: Link2, label: 'Payment Links', roles: ['OWNER', 'MANAGER', 'CASHIER'] },
      { to: '/reports', icon: BarChart3, label: 'Reports', roles: ['OWNER', 'MANAGER', 'ACCOUNTANT'] },
      { to: '/sales-list', icon: ShoppingCart, label: 'Sales History', roles: ['OWNER', 'MANAGER', 'ACCOUNTANT'] },
    ],
  },
  {
    label: 'People',
    roles: ['OWNER', 'MANAGER'],
    items: [
      { to: '/customers', icon: Users, label: 'Customers' },
      { to: '/hr', icon: UserCheck, label: 'Staff & HR' },
      { to: '/payroll', icon: DollarSign, label: 'Payroll' },
    ],
  },
  {
    label: 'Marketing',
    roles: ['OWNER', 'MANAGER'],
    items: [
      { to: '/promotions', icon: Tag, label: 'Promotions' },
      { to: '/gift-cards', icon: Gift, label: 'Gift Cards' },
    ],
  },
  {
    label: 'Analytics',
    roles: ['OWNER', 'MANAGER'],
    items: [
      { to: '/forecasting', icon: TrendingUp, label: 'AI Forecasting', roles: ['OWNER', 'MANAGER'] },
      { to: '/franchise', icon: GitBranch, label: 'Franchise Network', roles: ['OWNER'] },
      { to: '/security-settings', icon: Shield, label: 'Security & Roles', roles: ['OWNER', 'MANAGER'] },
    ],
  },
];

/** Generate initials avatar colour from name */
function avatarColor(name: string) {
  const colors = [
    // 600 to 700 shades: white initials on them reach 4.5:1 (the 500s do not)
    'bg-brand-600', 'bg-brand-800', 'bg-emerald-700', 'bg-amber-700',
    'bg-rose-600', 'bg-gray-700', 'bg-fuchsia-700', 'bg-orange-700',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function getInitials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// POS mode display metadata
const POS_MODE_META: Record<string, { label: string; color: string; icon: React.ComponentType<{className?: string}> }> = {
  RETAIL:       { label: 'Retail',       color: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',      icon: ShoppingCart },
  SUPERMARKET:  { label: 'Supermarket',  color: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400',   icon: Store },
  HOSPITALITY:  { label: 'Hospitality',  color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',   icon: Coffee },
  FAST_FOOD:    { label: 'Fast Food',    color: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400', icon: Zap },
  FUEL_PUMP:    { label: 'Fuel Station', color: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',           icon: Fuel },
  CYBERCAFE:    { label: 'Cybercafe',    color: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400', icon: Monitor },
  CLINIC:       { label: 'Clinic',       color: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400',       icon: Pill },
  SALON:        { label: 'Salon',        color: 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-400',       icon: CalendarClock },
  BAR_TAB:      { label: 'Bar',          color: 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400', icon: Coffee },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const { isDark, toggle: toggleTheme } = useThemeStore();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [trialBannerDismissed, setTrialBannerDismissed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const stored = localStorage.getItem('sidebar-collapsed');
    if (stored !== null) return stored === 'true';
    // Default: collapsed below 1180px (tablets, and a desktop window at its 1024px minimum), where the 260px menu
    // would take a quarter of the screen. The user's own choice is remembered once they toggle it.
    return window.innerWidth < 1180;
  });

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((v) => {
      const next = !v;
      localStorage.setItem('sidebar-collapsed', String(next));
      return next;
    });
  }, []);

  const bizId = user?.businessId;
  type SubscriptionInfo = { subscriptionStatus: string; trialEndsAt: string | null; daysRemaining: number | null; isTrialExpired: boolean };
  type BusinessInfo = { posMode: string; enabledModules?: string; name: string; subscriptionTier: string; stores?: { id: string; name: string; storeCode: string }[] };

  // Both are drawn from what the server last said (initialData, marked stale so they are re-fetched straight away), so the
  // menu is right on the first paint and only changes if something really changed.
  const { data: subscription } = useQuery<SubscriptionInfo>({
    queryKey: ['subscription', bizId],
    queryFn: () => api.get(`/business/${bizId}/subscription`),
    enabled: !!bizId,
    staleTime: 5 * 60_000,
    retry: false,
    initialData: () => (bizId ? readLastKnown<SubscriptionInfo>(`subscription:${bizId}`) : undefined),
    initialDataUpdatedAt: 0,
  });

  const { data: businessSettings, isPending: settingsPending } = useQuery<BusinessInfo>({
    queryKey: ['business-settings', bizId],
    queryFn: () => api.get(`/business/${bizId}/settings`),
    enabled: !!bizId,
    staleTime: 10 * 60_000,
    retry: false,
    initialData: () => (bizId ? readLastKnown<BusinessInfo>(`settings:${bizId}`) : undefined),
    initialDataUpdatedAt: 0,
  });

  useEffect(() => { if (bizId && subscription) writeLastKnown(`subscription:${bizId}`, subscription); }, [bizId, subscription]);
  useEffect(() => {
    if (bizId && businessSettings) {
      // only what the menu needs, not the whole settings document
      const { posMode, enabledModules, name, subscriptionTier, stores } = businessSettings;
      writeLastKnown(`settings:${bizId}`, { posMode, enabledModules, name, subscriptionTier, stores });
    }
  }, [bizId, businessSettings]);

  // True only on a first-ever visit with nothing remembered: the menu then shows placeholders instead of guessing RETAIL.
  const menuLoading = !!bizId && settingsPending && !businessSettings;

  const businessType = businessSettings?.posMode ?? 'RETAIL';
  const enabledModules = parseEnabledModules(businessSettings?.enabledModules);
  const businessName = businessSettings?.name ?? 'Faida POS';
  const currentStore = businessSettings?.stores?.find(s => s.id === user?.storeId);

  // ─── Live clock ───────────────────────────────────────────────────────────
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);
  const timeStr = now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' });

  const showTrialBanner =
    !trialBannerDismissed &&
    subscription?.subscriptionStatus === 'TRIAL' &&
    subscription.daysRemaining !== null &&
    subscription.daysRemaining <= 7;

  // ─── WebSocket ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const token = sessionStorage.getItem('pos-access-token');
    if (token && user?.businessId) {
      // Short delay so React StrictMode's cleanup-remount cycle completes
      // before we open a socket connection (avoids "closed before established").
      const t = setTimeout(() => {
        if (!cancelled) connectSocket(token, user.businessId!);
      }, 80);
      return () => { cancelled = true; clearTimeout(t); disconnectSocket(); };
    }
    return () => { disconnectSocket(); };
  }, [user?.businessId]);

  // ─── Live stock ───────────────────────────────────────────────────────────
  // A sale made on another till or the mobile app moves stock on the server. The item lists are cached for minutes,
  // so without this a cashier keeps seeing the old count (148 after 10 were sold elsewhere) until a reload. Every list
  // that shows stock has a query key starting with 'items'; a burst of sales is folded into one refetch.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!user?.businessId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refreshStock = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { void queryClient.invalidateQueries({ queryKey: ['items'] }); }, 400);
    };
    const offSale = subscribeToEvent(SocketEvents.SALE_CREATED, refreshStock);
    const offStock = subscribeToEvent(SocketEvents.INVENTORY_UPDATED, refreshStock);
    return () => { clearTimeout(timer); offSale(); offStock(); };
  }, [user?.businessId, queryClient]);

  // ─── Notification unread count + real-time badge ──────────────────────────
  const [unreadCount, setUnreadCount] = useState(0);
  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ['notifications-unread', user?.businessId],
    queryFn: () => api.get(`/notifications/unread-count?businessId=${user!.businessId}`),
    enabled: !!user?.businessId,
    refetchInterval: 60_000,
  });

  // ─── Stock Request badge (unread STOCK_REQUEST notifications) ─────────────
  const { data: stockRequestNotifs = [] } = useQuery<{ id: string }[]>({
    queryKey: ['notifications-stock-requests', user?.businessId],
    queryFn: () => api.get(`/notifications?businessId=${user!.businessId}&type=STOCK_REQUEST&unreadOnly=true`),
    enabled: !!user?.businessId && ['OWNER', 'MANAGER'].includes(user?.role ?? ''),
    refetchInterval: 120_000,
  });
  const stockRequestCount = stockRequestNotifs.length;
  useEffect(() => {
    if (unreadData?.count !== undefined) setUnreadCount(unreadData.count);
  }, [unreadData?.count]);
  // Clear badge when user opens notifications page
  useEffect(() => {
    if (location.pathname === '/notifications') setUnreadCount(0);
  }, [location.pathname]);
  useEffect(() => {
    if (!user?.businessId) return;
    return subscribeToEvent(SocketEvents.NOTIFICATION_CREATED, (data) => {
      setUnreadCount((n) => n + 1);
      if (data.priority === 'HIGH') {
        toast(data.title as string, {
          description: data.body as string,
          duration: 8000,
        });
      }
    });
  }, [user?.businessId]);

  // ─── Auto-lock ────────────────────────────────────────────────────────────
  const LOCK_TIMEOUT_MS = parseInt(localStorage.getItem('pos-lock-timeout') ?? '900000', 10);
  const [isLocked, setIsLocked] = useState(false);
  const [lockPin, setLockPin] = useState('');
  const [lockError, setLockError] = useState('');
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [hasBiometric, setHasBiometric] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setIsLocked(true), LOCK_TIMEOUT_MS);
  }, [LOCK_TIMEOUT_MS]);

  useEffect(() => {
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();
    return () => {
      events.forEach((e) => window.removeEventListener(e, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [resetTimer]);

  // Check if user has registered biometrics
  useEffect(() => {
    if (!isLocked || !user?.id) return;
    void (async () => {
      try {
        const creds = await api.get<{ id: string }[]>(`/auth/webauthn/credentials?userId=${user.id}`);
        setHasBiometric(Array.isArray(creds) && creds.length > 0);
      } catch {
        setHasBiometric(false);
      }
    })();
  }, [isLocked, user?.id]);

  async function handleBiometricUnlock() {
    if (!user?.businessId || !user?.id) return;
    setBiometricLoading(true);
    setLockError('');
    try {
      const options = await api.get<{
        challenge: string;
        challengeKey: string;
        rpId: string;
        allowCredentials: { type: string; id: string; transports?: AuthenticatorTransport[] }[];
        userVerification: UserVerificationRequirement;
        timeout: number;
      }>(`/auth/webauthn/login/begin?businessId=${user.businessId}&userId=${user.id}`);

      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: Uint8Array.from(atob(options.challenge.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
          rpId: options.rpId,
          allowCredentials: options.allowCredentials.map(c => ({
            type: 'public-key' as const,
            id: Uint8Array.from(atob(c.id.replace(/-/g, '+').replace(/_/g, '/')), x => x.charCodeAt(0)),
            transports: c.transports,
          })),
          userVerification: options.userVerification,
          timeout: options.timeout,
        },
      }) as PublicKeyCredential | null;

      if (!credential) { setBiometricLoading(false); return; }
      const response = credential.response as AuthenticatorAssertionResponse;

      const toBase64url = (buf: ArrayBuffer) =>
        btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

      const result = await api.post<{ accessToken: string; user: { id: string; name: string; role: string; businessId: string; storeId?: string } }>(
        '/auth/webauthn/login/complete',
        {
          businessId: user.businessId,
          challengeKey: options.challengeKey,
          credentialId: credential.id,
          clientDataJSON: toBase64url(response.clientDataJSON),
          authenticatorData: toBase64url(response.authenticatorData),
          signature: toBase64url(response.signature),
          userHandle: response.userHandle ? toBase64url(response.userHandle) : undefined,
        },
      );

      if (result?.accessToken) {
        setToken(result.accessToken);
        setIsLocked(false);
        setLockPin('');
        setLockError('');
        resetTimer();
        toast.success('Unlocked with biometrics');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Biometric auth failed';
      if (!msg.includes('cancelled') && !msg.includes('NotAllowedError')) {
        setLockError('Biometric failed — use PIN');
      }
    } finally {
      setBiometricLoading(false);
    }
  }

  async function handleUnlock(pinValue?: string) {
    const p = pinValue ?? lockPin;
    if (p.length < 4) return;
    try {
      const res = await fetch('/api/v1/auth/login/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Unlocking proves it is the SAME person: without their id, any colleague's PIN unlocked this session.
        body: JSON.stringify({ pin: p, businessId: user?.businessId, userId: user?.id }),
      });
      if (res.ok) {
        setIsLocked(false);
        setLockPin('');
        setLockError('');
        resetTimer();
      } else {
        setLockError('Incorrect PIN');
        setLockPin('');
      }
    } catch {
      setLockError('Network error');
    }
  }

  // Keyboard support for lock screen
  useEffect(() => {
    if (!isLocked) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key >= '0' && e.key <= '9') {
        setLockPin((p) => {
          if (p.length >= 6) return p;
          const next = p + e.key;
          // Pass next directly to avoid stale-closure issue with `lockPin` state
          if (next.length >= 4) setTimeout(() => void handleUnlock(next), 0);
          return next;
        });
      } else if (e.key === 'Backspace') {
        setLockPin((p) => p.slice(0, -1));
      } else if (e.key === 'Enter') {
        void handleUnlock();
      } else if (e.key === 'Escape' || e.key === 'Delete') {
        setLockPin('');
        setLockError('');
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocked]);

  const userRole = user?.role ?? '';

  const isActive = (path: string) =>
    path === '/pos' ? location.pathname === path : location.pathname.startsWith(path);

  const toggleGroup = (label: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  // Current page label + icon for the top header bar
  const currentPageInfo = (() => {
    const allItems = NAV_GROUPS.flatMap((g) => g.items);
    const match = allItems.find((item) => isActive(item.to));
    if (match) return { label: match.label, Icon: match.icon };
    // Screens that are not in the menu still say what they are, instead of falling back to "Dashboard".
    if (location.pathname.startsWith('/supermart')) return { label: 'Supermarket POS', Icon: ShoppingCart };
    if (location.pathname === '/notifications') return { label: 'Notifications', Icon: Bell };
    if (location.pathname.startsWith('/settings'))   return { label: 'Settings',      Icon: Settings };
    if (location.pathname.startsWith('/setup'))      return { label: 'Setup Wizard',  Icon: Wand2 };
    return { label: 'Dashboard', Icon: LayoutDashboard };
  })();

  const canSee = (roles?: string[]) => !roles || roles.includes(userRole);
  const canSeeBusinessType = (businessTypes?: string[], modules?: string[], notForTypes?: string[]) => {
    if (notForTypes?.includes(businessType)) return false;
    if (!businessTypes && !modules) return true;
    if (businessTypes?.includes(businessType)) return true;
    return !!modules?.some((m) => (enabledModules as string[]).includes(m));
  };

  const userPlan = user?.planName ?? 'STARTER';
  const subStatus = subscription?.subscriptionStatus;
  // Fall back to the tier on the auth user rather than to FREE: businessSettings
  // resolves asynchronously, so defaulting to FREE briefly hid paid nav items on
  // every page load for customers who had paid for them.
  const subTier = businessSettings?.subscriptionTier ?? user?.subscriptionTier ?? 'FREE';
  const canSeePlan = (to: string) => hasFeature(userPlan, to.replace(/^\//, ''), subStatus, subTier);

  const visibleGroups = NAV_GROUPS
    .filter((g) => canSee(g.roles) && canSeeBusinessType(g.businessTypes))
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (item) => canSee(item.roles) && canSeeBusinessType(item.businessTypes, item.modules, item.notForTypes) && canSeePlan(item.to),
      ),
    }))
    .filter((g) => g.items.length > 0);

  // Once the menu is settled, quietly fetch the first few pages while the browser is idle, so they open instantly.
  // Production only: in development this would make the dev server compile eight pages nobody asked for.
  useEffect(() => {
    if (!import.meta.env.PROD || menuLoading) return;
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
    const targets = visibleGroups.flatMap((g) => g.items.map((i) => i.to)).filter((to) => to !== location.pathname).slice(0, 8);
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const timers: number[] = [];
    targets.forEach((to, i) => {
      const run = () => prefetchRoute(to);
      if (idle) idle(run); else timers.push(window.setTimeout(run, 1500 + i * 400));
    });
    return () => timers.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuLoading, businessType]);

  const showSettings = canSee(['OWNER', 'MANAGER']);
  // Only a computer that keeps its own data has a server to look after.
  const desktopMode = useDesktopMode();
  // Only the offline edition has a licence; on the cloud the answer is 'CLOUD' and nothing is shown.
  const offlineEdition = useLicense().data?.edition === 'LOCAL';

  // ─── Lock screen ─────────────────────────────────────────────────────────
  if (isLocked) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-gray-900/95 backdrop-blur-md">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-xs p-8 text-center">
          {/* Icon */}
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Lock className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Session Locked</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {user?.name ? <><span className="font-medium text-gray-700 dark:text-gray-300">{user.name}</span> — </> : ''}
            enter your PIN to continue
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 mb-5">
            You can also type on your keyboard
          </p>

          {/* PIN dots */}
          <div className="flex justify-center gap-3 mb-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className={`w-10 h-10 rounded-full border-2 flex items-center justify-center text-sm font-bold transition-all duration-150 ${
                  i < lockPin.length
                    ? 'bg-blue-600 border-blue-600 text-white scale-110'
                    : 'border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700'
                }`}
              >
                {i < lockPin.length ? '●' : ''}
              </div>
            ))}
          </div>
          {lockError && (
            <p className="text-sm text-red-500 mb-3 font-medium">{lockError}</p>
          )}

          {/* PIN pad */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[1,2,3,4,5,6,7,8,9,'C',0,'⌫'].map((k, i) => (
              <button
                key={i}
                onClick={() => {
                  if (k === 'C') { setLockPin(''); setLockError(''); }
                  else if (k === '⌫') setLockPin((p) => p.slice(0, -1));
                  else if (lockPin.length < 6) {
                    const next = lockPin + k.toString();
                    setLockPin(next);
                    if (next.length >= 4) void handleUnlock(next);
                  }
                }}
                className={`h-12 rounded-xl font-semibold text-base transition-all duration-100 active:scale-90 ${
                  k === 'C'
                    ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm hover:bg-red-100 dark:hover:bg-red-900/40'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-700 dark:hover:text-blue-300'
                }`}
              >
                {k}
              </button>
            ))}
          </div>

          {/* Enter button */}
          <button
            onClick={() => void handleUnlock()}
            disabled={lockPin.length < 4}
            className="w-full h-12 mb-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-30 text-white font-bold rounded-xl transition-all text-sm flex items-center justify-center gap-2"
          >
            Unlock  <kbd className="bg-white/20 text-white text-xs px-1.5 py-0.5 rounded font-mono">↵ Enter</kbd>
          </button>

          {/* Biometric button */}
          {hasBiometric && (
            <button
              onClick={() => void handleBiometricUnlock()}
              disabled={biometricLoading}
              className="w-full h-11 mb-4 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-semibold rounded-xl transition-all text-sm flex items-center justify-center gap-2 border border-emerald-200 dark:border-emerald-800 disabled:opacity-50"
            >
              <Fingerprint className="w-4 h-4" />
              {biometricLoading ? 'Verifying…' : 'Use Fingerprint / Face ID'}
            </button>
          )}

          <button
            onClick={logout}
            className="text-sm text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
          >
            Sign out instead
          </button>
        </div>
      </div>
    );
  }

  // ─── Main layout ──────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-950 overflow-hidden">

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className={`hidden md:flex flex-col flex-shrink-0 bg-white dark:bg-gray-900 border-r border-gray-200/80 dark:border-white/[0.055] relative transition-all duration-300 ease-in-out overflow-hidden ${sidebarCollapsed ? 'w-0 border-r-0' : 'w-[260px]'}`}>

        {/* 2px gradient accent line at the very top */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-accent via-accent to-brand-600 z-10" />

        {/* ── Brand header ──────────────────────────────────────────────── */}
        <div className="px-4 pt-6 pb-4 mt-[2px]">

          {/* Logo + wordmark row */}
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-shrink-0">
              <img
                src="/logo.png"
                alt="Faida POS"
                className="w-10 h-10 object-contain rounded-[10px]"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.setProperty('display', 'flex');
                }}
              />
              {/* Fallback gradient icon shown only if logo fails to load */}
              <div className="w-10 h-10 rounded-[10px] bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-700 items-center justify-center shadow-lg shadow-blue-500/30 ring-1 ring-inset ring-white/15 hidden">
                <span className="text-white font-extrabold text-lg">F</span>
              </div>
              {/* Online dot */}
              <div className="absolute -bottom-0.5 -right-0.5 w-[11px] h-[11px] bg-emerald-400 rounded-full border-2 border-white dark:border-gray-900 shadow-sm" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-extrabold text-gray-900 dark:text-white leading-tight tracking-[-0.01em] truncate" title={businessName}>
                {businessName}
              </div>
              <div className="flex items-center gap-1.5 mt-[3px] flex-wrap">
                {/* POS mode badge */}
                {(() => {
                  const meta = POS_MODE_META[businessType] ?? POS_MODE_META.RETAIL;
                  const ModeIcon = meta.icon;
                  return (
                    <span className={`inline-flex items-center gap-[3px] text-[9px] font-bold px-1.5 py-[1.5px] rounded-full uppercase tracking-wide ${meta.color}`}>
                      <ModeIcon className="w-[9px] h-[9px]" />
                      {meta.label}
                    </span>
                  );
                })()}
                <span className="w-[3px] h-[3px] rounded-full bg-gray-300 dark:bg-white/20 flex-shrink-0" />
                <span className={`text-[9px] font-semibold px-1.5 py-[1px] rounded-full uppercase tracking-wide ${
                  subscription?.subscriptionStatus === 'ACTIVE'
                    ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                    : subscription?.subscriptionStatus === 'TRIAL'
                      ? 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400'
                      : 'bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/60'
                }`}>
                  {subscription?.subscriptionStatus === 'ACTIVE' ? 'Active' : subscription?.subscriptionStatus === 'TRIAL' ? 'Trial' : 'Free'}
                </span>
              </div>
            </div>
          </div>

          {/* User identity card */}
          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl bg-white dark:bg-white/[0.05] border border-gray-200/70 dark:border-white/[0.08] shadow-sm hover:shadow dark:shadow-none hover:border-gray-300/70 dark:hover:border-white/[0.13] transition-all duration-200 cursor-default">
            <div className={`w-8 h-8 rounded-full ${avatarColor(user?.name ?? 'U')} flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0 ring-2 ring-white dark:ring-white/20 shadow-sm`}>
              {getInitials(user?.name ?? 'U')}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-gray-800 dark:text-white/90 truncate leading-tight">{user?.name}</div>
              <div className="flex items-center gap-1.5 mt-[2px]">
                <div className="w-[5px] h-[5px] rounded-full bg-emerald-400 ring-[2px] ring-emerald-400/25 flex-shrink-0" />
                <span className="text-[11px] text-gray-400 dark:text-white/60 capitalize font-medium leading-none">{user?.role?.toLowerCase()}</span>
                {currentStore && (
                  <>
                    <span className="text-[9px] text-gray-300 dark:text-white/60">·</span>
                    <span className="text-[10px] text-gray-400 dark:text-white/60 font-medium leading-none truncate max-w-[70px]" title={currentStore.name}>
                      {currentStore.storeCode}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="mt-2.5">
            <SyncStatusBadge />
          </div>
        </div>

        {/* Section separator */}
        <div className="mx-3.5 h-px bg-gray-200/70 dark:bg-white/[0.055]" />

        {/* ── Navigation ────────────────────────────────────────────────── */}
        <nav className="stagger flex-1 overflow-y-auto py-2.5 px-2.5 scrollbar-thin scrollbar-thumb-gray-300/60 dark:scrollbar-thumb-white/10 scrollbar-track-transparent">
          {menuLoading && (
            <div className="space-y-5 px-1.5 py-2" aria-busy="true" aria-label="Loading menu">
              {[4, 5, 3].map((rows, g) => (
                <div key={g} className="space-y-2">
                  <div className="skeleton h-2.5 w-16" />
                  {Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton h-7 w-full" />)}
                </div>
              ))}
            </div>
          )}
          {!menuLoading && visibleGroups.map((group) => {
            const collapsed = collapsedGroups.has(group.label);
            return (
              <div key={group.label} className="mb-2">

                {/* Group header */}
                <button
                  onClick={() => toggleGroup(group.label)}
                  aria-expanded={!collapsed}
                  className="w-full flex items-center justify-between px-2 py-[5px] mb-[3px] rounded-md transition-colors duration-150 group hover:bg-black/[0.04] dark:hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                >
                  <span className="text-[10px] font-bold text-gray-600 dark:text-white/60 uppercase tracking-[0.14em] group-hover:text-gray-800 dark:group-hover:text-white/70 transition-colors duration-150">
                    {group.label}
                  </span>
                  <ChevronDown className="nav-chevron w-[11px] h-[11px] text-gray-400 dark:text-white/60 group-hover:text-gray-700 dark:group-hover:text-white" aria-hidden />
                </button>

                {/* Group items */}
                <div
                  aria-hidden={collapsed}
                  className={`grid transition-[grid-template-rows,opacity,visibility] duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
                    collapsed ? 'grid-rows-[0fr] opacity-0 invisible' : 'grid-rows-[1fr] opacity-100 visible'
                  }`}
                >
                  <div className="space-y-[2px] overflow-hidden min-h-0">
                    {group.items.map((item) => {
                      const active = isActive(item.to);
                      const navCls = 'nav-item group';
                      const isInventoryItem = item.to === '/inventory';
                      const navInner = (
                        <>
                          <span className="nav-icon"><item.icon className="w-[14px] h-[14px]" /></span>
                          <span className="nav-label">{item.label}</span>
                          {isInventoryItem && stockRequestCount > 0 && (
                            <span className="flex-shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[9px] font-bold flex items-center justify-center">
                              {stockRequestCount > 99 ? '99+' : stockRequestCount}
                            </span>
                          )}
                        </>
                      );
                      return item.newTab ? (
                        <button
                          key={item.to}
                          onClick={() => {
                            const biz = user?.businessId ?? '';
                            const store = user?.storeId ?? '';
                            // Pass token via localStorage so the new tab can pick it up
                            // (sessionStorage is tab-scoped and not shared with new tabs)
                            const token = getToken();
                            if (token) localStorage.setItem('kiosk-tab-token', token);
                            window.open(`${item.to}?businessId=${biz}&storeId=${store}`, '_blank', 'noopener');
                          }}
                          className={`w-full text-left cursor-pointer ${navCls}`}
                        >
                          {navInner}
                        </button>
                      ) : (
                        <Link
                          key={item.to}
                          to={item.to}
                          className={navCls}
                          aria-current={active ? 'page' : undefined}
                          // Start fetching the page now, so the click finds it already loaded.
                          onMouseEnter={() => prefetchRoute(item.to)}
                          onFocus={() => prefetchRoute(item.to)}
                          onTouchStart={() => prefetchRoute(item.to)}
                        >
                          {navInner}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </nav>

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <div className="px-2.5 pb-3 pt-1">
          {/* Separator above footer */}
          <div className="mx-0.5 mb-2 h-px bg-gray-200/70 dark:bg-white/[0.055]" />

          {/* Footer actions */}
          <div className="rounded-xl bg-white/70 dark:bg-white/[0.035] border border-gray-200/60 dark:border-white/[0.07] overflow-hidden divide-y divide-gray-200/50 dark:divide-white/[0.05]">

            {showSettings && (
              <>
                <Link
                  to="/settings"
                  className="nav-item group !px-3 !py-[8px] !rounded-none"
                  aria-current={isActive('/settings') ? 'page' : undefined}
                  onMouseEnter={() => prefetchRoute('/settings')}
                  onFocus={() => prefetchRoute('/settings')}
                >
                  <span className="nav-icon"><Settings className="w-[14px] h-[14px] transition-transform duration-300 group-hover:rotate-90" /></span>
                  <span className="nav-label">Settings</span>
                </Link>
                {keepsOwnData(desktopMode) && (
                  <Link
                    to="/server"
                    className="nav-item group !px-3 !py-[8px] !rounded-none"
                    aria-current={isActive('/server') ? 'page' : undefined}
                  >
                    <span className="nav-icon"><HardDrive className="w-[14px] h-[14px]" /></span>
                    <span className="nav-label">Server and backups</span>
                  </Link>
                )}
                {offlineEdition && (
                  <Link
                    to="/license"
                    className="nav-item group !px-3 !py-[8px] !rounded-none"
                    aria-current={isActive('/license') ? 'page' : undefined}
                    onMouseEnter={() => prefetchRoute('/license')}
                    onFocus={() => prefetchRoute('/license')}
                  >
                    <span className="nav-icon"><KeyRound className="w-[14px] h-[14px]" /></span>
                    <span className="nav-label">Licence</span>
                  </Link>
                )}
                <Link
                  to="/setup"
                  className="nav-item group !px-3 !py-[8px] !rounded-none"
                  aria-current={isActive('/setup') ? 'page' : undefined}
                  onMouseEnter={() => prefetchRoute('/setup')}
                  onFocus={() => prefetchRoute('/setup')}
                >
                  <span className="nav-icon"><Wand2 className="w-[14px] h-[14px]" /></span>
                  <span className="nav-label">Setup Wizard</span>
                </Link>
              </>
            )}

            {/* Sign out */}
            <button
              onClick={logout}
              className="w-full group flex items-center gap-2.5 px-3 py-[8px] text-[13px] font-medium text-gray-600 dark:text-white/60 active:scale-[0.98] transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50/80 dark:hover:bg-red-500/[0.07] transition-all duration-150"
            >
              <div className="flex-shrink-0 flex items-center justify-center w-[26px] h-[26px] rounded-md bg-transparent group-hover:bg-red-100/60 dark:group-hover:bg-red-500/10 transition-all duration-150">
                <LogOut className="w-[14px] h-[14px] group-hover:translate-x-0.5 transition-transform duration-200" />
              </div>
              <span className="flex-1 text-left">Sign Out</span>
            </button>
          </div>
        </div>
      </aside>

      {/* ── Content area ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <MobileNav isOpen={mobileMenuOpen} onOpen={() => setMobileMenuOpen(true)} onClose={() => setMobileMenuOpen(false)} businessType={businessType} enabledModules={enabledModules} userPlan={userPlan} subscriptionStatus={subStatus} subscriptionTier={subTier} />
        <OfflineBanner />

        {/* ── Top header bar (desktop) ──────────────────────────────────── */}
        <header className="hidden md:flex items-center justify-between px-5 h-[52px] bg-white/95 backdrop-blur-sm border-b-[3px] border-b-accent dark:border-b dark:border-b-white/[0.06] dark:bg-gradient-to-r dark:from-[#0d1a3a] dark:via-navy-soft dark:to-[#182a57] shadow-[0_4px_18px_rgb(10_42_85_/_0.08)] flex-shrink-0 z-10">
          {/* Left: Sidebar toggle + Page title */}
          <div className="flex items-center gap-2 min-w-0">
            {/* Sidebar collapse / expand toggle */}
            <button
              onClick={toggleSidebar}
              title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
              className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/[0.06] hover:text-gray-600 dark:hover:text-white transition-all duration-150"
            >
              {sidebarCollapsed
                ? <PanelLeftOpen className="w-[15px] h-[15px]" />
                : <PanelLeftClose className="w-[15px] h-[15px]" />}
            </button>
            <div className="w-px h-4 bg-gray-200 dark:bg-white/[0.07]" />
            <div className="w-6 h-6 rounded-md bg-gray-100 dark:bg-white/[0.07] flex items-center justify-center flex-shrink-0">
              <currentPageInfo.Icon className="w-3.5 h-3.5 text-gray-500 dark:text-white/60" />
            </div>
            <h1 className="text-[14px] font-bold text-gray-800 dark:text-white/90 tracking-tight truncate">{currentPageInfo.label}</h1>
            {/* Store context pill */}
            {currentStore && (
              <span className="hidden lg:inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 dark:text-white/60 bg-gray-100 dark:bg-white/[0.05] border border-gray-200/70 dark:border-white/[0.06] px-2 py-[3px] rounded-full">
                <Building2 className="w-[9px] h-[9px]" />
                {currentStore.name}
              </span>
            )}
          </div>
          {/* Right: Actions */}
          <div className="flex items-center gap-0.5">
            {/* Live clock */}
            <div className="hidden lg:flex flex-col items-end mr-2 select-none">
              <span className="text-[13px] font-bold text-gray-700 dark:text-white/75 tabular-nums leading-tight">{timeStr}</span>
              <span className="text-[10px] text-gray-600 dark:text-white/60 leading-tight">{dateStr}</span>
            </div>
            <div className="hidden lg:block w-px h-5 bg-gray-200 dark:bg-white/[0.07] mx-1" />

            {/* Quick New Sale button */}
            {['OWNER', 'MANAGER', 'CASHIER'].includes(user?.role ?? '') && location.pathname !== '/pos' && (
              <button
                onClick={() => navigate('/pos')}
                title="New Sale (go to POS)"
                className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-sm shadow-blue-500/20 transition-all duration-150 mr-1"
              >
                <ShoppingCart className="w-3.5 h-3.5" />
                New Sale
              </button>
            )}

            {/* Kiosk launcher */}
            {(user?.role === 'OWNER' || user?.role === 'MANAGER') && (
              <button
                onClick={() => {
                  const token = getToken();
                  if (token) localStorage.setItem('kiosk-tab-token', token);
                  window.open(
                    `/kiosk?businessId=${user.businessId ?? ''}&storeId=${user.storeId ?? ''}`,
                    '_blank',
                    'noopener',
                  );
                }}
                title="Launch Kiosk Mode (opens in new tab)"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-gray-400 dark:text-white/60 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all duration-150 mr-0.5"
              >
                <Tablet className="w-3.5 h-3.5" />
                Kiosk
              </button>
            )}
            <Link
              to="/notifications"
              className="relative p-2 rounded-lg text-gray-400 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/[0.06] hover:text-gray-600 dark:hover:text-white transition-all duration-150"
              title="Notifications"
            >
              <Bell className="w-[15px] h-[15px]" />
              {unreadCount > 0 && (
                <span className="absolute top-[7px] right-[7px] w-[7px] h-[7px] rounded-full bg-red-500 border-[1.5px] border-white dark:border-gray-900" />
              )}
            </Link>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg text-gray-400 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/[0.06] hover:text-gray-600 dark:hover:text-white transition-all duration-150"
              title={isDark ? 'Light mode' : 'Dark mode'}
            >
              {isDark
                ? <Sun className="w-[15px] h-[15px] text-amber-400" />
                : <Moon className="w-[15px] h-[15px]" />
              }
            </button>
            <div className="w-px h-4 bg-gray-200 dark:bg-white/[0.07] mx-1.5" />
            <div className={`w-7 h-7 rounded-full ${avatarColor(user?.name ?? 'U')} flex items-center justify-center text-white text-[10px] font-bold ring-[1.5px] ring-white dark:ring-white/10 shadow-sm cursor-default`}>
              {getInitials(user?.name ?? 'U')}
            </div>
          </div>
        </header>

        {/* Trial banner */}
        {showTrialBanner && (
          <div className={`flex items-center justify-between px-4 py-2 text-sm font-medium ${
            subscription!.isTrialExpired
              ? 'bg-red-600 text-white'
              : subscription!.daysRemaining! <= 3
                ? 'bg-orange-500 text-white'
                : 'bg-amber-400 text-amber-900'
          }`}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {subscription!.isTrialExpired
                ? 'Your trial has expired. API access is restricted. Please subscribe to continue.'
                : `Trial ending in ${subscription!.daysRemaining} day${subscription!.daysRemaining === 1 ? '' : 's'}. Subscribe to keep full access.`
              }
            </div>
            <button
              onClick={() => setTrialBannerDismissed(true)}
              className="ml-4 hover:opacity-70 transition-opacity flex-shrink-0"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <main
          className={`flex-1 flex flex-col bg-gray-100 dark:bg-gray-950 relative ${
            ['/pos', '/supermart', '/hospitality', '/kds', '/fuel-pump', '/cybercafe'].some(p => location.pathname.startsWith(p))
              ? 'overflow-hidden'
              : 'overflow-y-auto'
          } ${
            // The phone tab bar is fixed over the page, so reserve its height. /pos draws its own
            // cart bar above the tab bar and positions itself.
            location.pathname.startsWith('/pos') ? '' : 'pb-[calc(57px+env(safe-area-inset-bottom))] md:pb-0'
          }`}
        >
          {/* Subtle background pattern */}
          <div className="absolute inset-0 opacity-[0.02] dark:opacity-[0.01]">
            <div className="absolute inset-0" style={{
              backgroundImage: `radial-gradient(circle at 1px 1px, rgb(0 0 0) 1px, transparent 0)`,
              backgroundSize: '20px 20px'
            }} />
          </div>
          {/* NOTE: intentionally no z-index here. A positioned z-index would create
              a stacking context that traps in-page modals (fixed z-50) BELOW the
              z-30 mobile bottom nav. DOM order already paints this above the
              background pattern, so `relative` alone is enough. */}
          <div className="relative"><UpdateBanner /><LicenseBanner /></div>
          <div className={`relative ${
            ['/pos', '/supermart', '/hospitality', '/kds', '/fuel-pump', '/cybercafe'].some(p => location.pathname.startsWith(p))
              ? 'flex-1 flex flex-col overflow-hidden'
              : ''
          }`}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
