import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGoogleLogin } from '@react-oauth/google';
import { isDesktopApp, getDesktopGoogleAccessToken } from '../lib/googleDesktop';
import { useAuthStore } from '../stores/auth';
import type { AuthUser } from '../stores/auth';
import { Eye, EyeOff, ChevronLeft, Building2, Sparkles, Fingerprint, Settings, ShieldCheck, Phone, LockKeyhole, Cloud, CloudOff, Sun, Moon } from 'lucide-react';
import { useThemeStore } from '../stores/theme';
import '../styles/faida-login.css';
import { isBiometricAvailable } from '../lib/biometric';
import { setToken } from '../lib/api';
import { reconfigureThisComputer } from '../lib/desktopServer';
import { describeConnection, googleSignInAvailable } from '../lib/desktopSetup';
import { useDesktopMode, useDesktopSetup } from '../lib/useLocalServer';

const PLAN_LABELS: Record<string, { label: string; color: string; price: string }> = {
  FREE:       { label: 'Free',       color: 'bg-green-500',   price: 'KES 0/mo' },
  STARTER:    { label: 'Starter',    color: 'bg-emerald-500', price: 'KES 999/mo' },
  GROWTH:     { label: 'Growth',     color: 'bg-cyan-500',    price: 'KES 2,499/mo' },
  PRO:        { label: 'Pro',        color: 'bg-blue-600',    price: 'KES 4,999/mo' },
  ENTERPRISE: { label: 'Enterprise', color: 'bg-purple-600',  price: 'KES 14,999/mo' },
  LIFETIME:   { label: 'Lifetime',   color: 'bg-amber-500',   price: 'Pay once' },
};

type LoginMode = 'email' | 'pin' | 'register';
type PinStep = 'business' | 'staff' | 'pad';

const PIN_DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 'clear', 0, 'del', 'enter'] as const;

/** Faida support line shown on the sign-in screen (call or WhatsApp). */
const SUPPORT_PHONE = '+254 797 033 513';

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 20_000); return () => clearInterval(t); }, []);
  const h = now.getHours();
  return {
    time: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    date: now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
    longDate: now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
    greeting: h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening',
  };
}

function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return online;
}

interface StaffMember {
  id: string;
  name: string;
  role: string;
}

const ROLE_COLORS: Record<string, string> = {
  OWNER:    'bg-purple-600',
  MANAGER:  'bg-blue-600',
  CASHIER:  'bg-emerald-600',
  WAITER:   'bg-amber-500',
  KITCHEN:  'bg-orange-500',
  ACCOUNTANT: 'bg-indigo-600',
};

function initials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export default function LoginPage() {
  const navigate = useNavigate();
  // Google sign-in needs the internet and the cloud server's Google settings; an offline setup has neither.
  const desktopSetup = useDesktopMode();
  const googleAvailable = googleSignInAvailable(isDesktopApp(), desktopSetup);
  // Which server and business this installation is connected to, so a till never has to guess where its sales go.
  const connection = describeConnection(useDesktopSetup());
  const clock = useClock();
  const online = useOnline();
  const isDark = useThemeStore((t) => t.isDark);
  const toggleTheme = useThemeStore((t) => t.toggle);

  // Read URL params on mount
  const urlParams = new URLSearchParams(window.location.search);
  const urlMode = urlParams.get('mode');
  const urlPlan = (urlParams.get('plan') ?? '').toUpperCase();
  const urlAffiliate = urlParams.get('aff') ?? ''; // affiliate referral code

  const [mode, setMode] = useState<LoginMode>(urlMode === 'register' ? 'register' : 'email');

  // ── Email mode ──────────────────────────────────────────────────────────────
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [showTotp, setShowTotp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ── PIN mode ─────────────────────────────────────────────────────────────────
  const [pinStep, setPinStep] = useState<PinStep>('business');
  const [businessIdInput, setBusinessIdInput] = useState('');
  const [savedBusinessId, setSavedBusinessId] = useState(''); // real UUID stored here
  const [resolvedBusinessName, setResolvedBusinessName] = useState('');
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffLoadError, setStaffLoadError] = useState('');
  const [selectedUser, setSelectedUser] = useState<StaffMember | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  /** Bumped on every wrong PIN; used as a React key so the shake replays each time. */
  const [pinShake, setPinShake] = useState(0);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);

  // ── Register mode ────────────────────────────────────────────────────────────
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [regBusiness, setRegBusiness] = useState(() => {
    try { return localStorage.getItem('desktop-business-name') ?? ''; } catch { return ''; }
  });
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState('');
  const [regSuccess, setRegSuccess] = useState(false);

  // ── Forgot password ──────────────────────────────────────────────────────────
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotError, setForgotError] = useState('');

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotLoading(true);
    setForgotError('');
    try {
      const res = await fetch(`${API_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      });
      const data = await res.json() as { sent: boolean };
      if (data.sent) setForgotSent(true);
      else setForgotError('Something went wrong. Please try again.');
    } catch {
      setForgotError('Network error. Please try again.');
    } finally {
      setForgotLoading(false);
    }
  };

  const { login, loginWithPin, loginWithBiometric, loginWithOAuth } = useAuthStore();
  const API_URL = (() => {
    try {
      const stored = localStorage.getItem('faida-server-url');
      if (stored) return stored.replace(/\/$/, '') + '/api/v1';
    } catch { /* ignore */ }
    return import.meta.env.VITE_API_URL ?? '/api/v1';
  })();

  // Handle OAuth redirect (legacy redirect flow fallback)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('oauth_token');
    const businessId = params.get('oauth_businessId');
    const role = params.get('oauth_role');
    const name = params.get('oauth_name');
    const id = params.get('oauth_id');

    if (token && businessId && role && name && id) {
      const user: AuthUser = {
        id,
        name: decodeURIComponent(name),
        email: null,
        role: role as AuthUser['role'],
        businessId,
      };
      void loginWithOAuth(token, user).catch((err) => {
        setError(err instanceof Error ? err.message : 'OAuth login failed');
      });
      window.history.replaceState({}, '', '/');
    }
  }, [loginWithOAuth]);

  // Google login via @react-oauth/google (frontend-initiated flow)
  async function finishGoogleLogin(accessToken: string) {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/auth/google/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken }),
      });
      const data = await res.json() as { accessToken?: string; user?: AuthUser; message?: string };
      if (!res.ok) throw new Error(data.message ?? 'Google login failed');
      setToken(data.accessToken!);
      await loginWithOAuth(data.accessToken!, data.user!);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google login failed');
    } finally {
      setLoading(false);
    }
  }

  const handleGoogleLogin = useGoogleLogin({
    onSuccess: (tokenResponse) => finishGoogleLogin(tokenResponse.access_token),
    onError: () => setError('Google sign-in was cancelled or failed'),
  });

  // Desktop app: system-browser flow instead of the popup
  async function desktopGoogleLogin() {
    setError('');
    setLoading(true);
    try {
      await finishGoogleLogin(await getDesktopGoogleAccessToken());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google login failed');
      setLoading(false);
    }
  }

  // Google register — needs businessName first
  const [googleRegBusiness, setGoogleRegBusiness] = useState(() => {
    try { return localStorage.getItem('desktop-business-name') ?? ''; } catch { return ''; }
  });
  const [showGoogleRegPrompt, setShowGoogleRegPrompt] = useState(false);
  const [pendingGoogleToken, setPendingGoogleToken] = useState('');
  const [googleRegLoading, setGoogleRegLoading] = useState(false);

  const handleGoogleRegister = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setPendingGoogleToken(tokenResponse.access_token);
      setShowGoogleRegPrompt(true);
    },
    onError: () => setRegError('Google sign-in was cancelled or failed'),
  });

  async function desktopGoogleRegister() {
    setRegError('');
    try {
      setPendingGoogleToken(await getDesktopGoogleAccessToken());
      setShowGoogleRegPrompt(true);
    } catch (err) {
      setRegError(err instanceof Error ? err.message : 'Google sign-in failed');
    }
  }

  async function submitGoogleRegister() {
    if (!googleRegBusiness.trim()) return;
    setGoogleRegLoading(true);
    setRegError('');
    try {
      const res = await fetch(`${API_URL}/auth/google/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: pendingGoogleToken, businessName: googleRegBusiness.trim() }),
      });
      const data = await res.json() as { accessToken?: string; user?: AuthUser; message?: string };
      if (!res.ok) throw new Error(data.message ?? 'Registration failed');
      setToken(data.accessToken!);
      await loginWithOAuth(data.accessToken!, data.user!);
      navigate(urlPlan ? `/setup?plan=${urlPlan}` : '/setup');
    } catch (err) {
      setRegError(err instanceof Error ? err.message : 'Google registration failed');
      setShowGoogleRegPrompt(false);
    } finally {
      setGoogleRegLoading(false);
    }
  }

  // Check biometric availability on mount
  useEffect(() => {
    void isBiometricAvailable().then(setBiometricAvailable);
  }, []);

  // On mount: check if businessId is already saved → skip directly to staff grid
  useEffect(() => {
    const stored = localStorage.getItem('pos-business-id') ?? '';
    const storedName = localStorage.getItem('pos-business-name') ?? '';
    if (stored) {
      setSavedBusinessId(stored);
      setResolvedBusinessName(storedName);
      setPinStep('staff');
      // A till that already knows its business opens on the staff PIN pad, like the Faida counter.
      if (urlMode !== 'register') setMode('pin');
      void loadStaff(stored);
    }
  }, []);

  async function loadStaff(bizId: string) {
    setStaffLoading(true);
    setStaff([]);
    setStaffLoadError('');
    try {
      const res = await fetch(`${API_URL}/business/${bizId}/staff`);
      if (res.status === 404) {
        // The server says this business does not exist: forget it and ask for the code again.
        setSavedBusinessId('');
        setResolvedBusinessName('');
        localStorage.removeItem('pos-business-id');
        localStorage.removeItem('pos-business-name');
        setPinStep('business');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStaff((await res.json()) as StaffMember[]);
    } catch {
      // The server could not be reached (or failed). Keep the business: a till that starts while the network is down
      // must not forget which shop it belongs to.
      setStaffLoadError('Could not reach the server to load the staff list. Check the connection, then retry.');
    } finally {
      setStaffLoading(false);
    }
  }

  async function handleBusinessSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = businessIdInput.trim().toUpperCase();
    if (!code) return;
    setStaffLoading(true);
    try {
      // Resolve short code → real UUID
      const res = await fetch(`${API_URL}/business/resolve/${encodeURIComponent(code)}`);
      // Only a 404 means the code is wrong. Anything else (502 while the API restarts, 500, no network) is a server
      // problem, and telling the user their code is wrong sends them to their owner for nothing.
      if (res.status === 404) throw new Error('NOT_FOUND');
      if (!res.ok) throw new Error('SERVER');
      const biz = (await res.json()) as { id: string; name: string; shortCode: string | null };
      localStorage.setItem('pos-business-id', biz.id);
      localStorage.setItem('pos-business-name', biz.name);
      setSavedBusinessId(biz.id);
      setResolvedBusinessName(biz.name);
      setPinStep('staff');
      void loadStaff(biz.id);
    } catch (err) {
      setError(
        err instanceof Error && err.message === 'NOT_FOUND'
          ? 'Business code not found. Check with your owner.'
          : 'Cannot reach the server right now. Check your connection, or that the API is running, and try again.',
      );
      setStaffLoading(false);
    }
  }

  function selectStaff(member: StaffMember) {
    setSelectedUser(member);
    setPin('');
    setPinError('');
    setPinStep('pad');
  }

  // Keyboard support for PIN pad
  useEffect(() => {
    if (mode !== 'pin' || pinStep !== 'pad') return;
    function onKey(e: KeyboardEvent) {
      if (e.key >= '0' && e.key <= '9') {
        handlePinPad(Number(e.key) as typeof PIN_DIGITS[number]);
      } else if (e.key === 'Enter') {
        handlePinPad('enter');
      } else if (e.key === 'Backspace') {
        handlePinPad('del');
      } else if (e.key === 'Escape' || e.key === 'Delete') {
        handlePinPad('clear');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pinStep, pin]);

  async function handlePinLogin(pinValue?: string) {
    const p = pinValue ?? pin;
    if (p.length < 4 || !selectedUser) return;
    setError('');
    setPinError('');
    setLoading(true);
    try {
      await loginWithPin(p, savedBusinessId, undefined, selectedUser?.id);
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Invalid PIN');
      setPin('');
      setPinShake((n) => n + 1); // the dots shake, so a wrong PIN is felt as well as read
    } finally {
      setLoading(false);
    }
  }

  function handlePinPad(key: typeof PIN_DIGITS[number]) {
    if (key === 'clear') {
      setPin('');
    } else if (key === 'del') {
      setPin((p) => p.slice(0, -1));
    } else if (key === 'enter') {
      void handlePinLogin();
    } else if (typeof key === 'number' && pin.length < 6) {
      setPin(pin + key.toString());
      setPinError('');
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setRegError('');
    if (regPassword !== regConfirm) {
      setRegError('Passwords do not match');
      return;
    }
    if (regPassword.length < 8) {
      setRegError('Password must be at least 8 characters');
      return;
    }
    if (!/[A-Z]/.test(regPassword)) {
      setRegError('Password must contain at least one uppercase letter');
      return;
    }
    if (!/[0-9]/.test(regPassword)) {
      setRegError('Password must contain at least one number');
      return;
    }
    setRegLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: regName,
          email: regEmail,
          password: regPassword,
          businessName: regBusiness,
          ...(urlPlan ? { plan: urlPlan } : {}),
          ...(urlAffiliate ? { affiliateCode: urlAffiliate } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { message?: string };
        throw new Error(data.message ?? 'Registration failed');
      }
      const data = await res.json() as { accessToken: string; user: AuthUser };
      // Use the token returned by registration — no second round-trip needed
      await loginWithOAuth(data.accessToken, data.user);
      navigate(urlPlan ? `/setup?plan=${urlPlan}` : '/setup');
    } catch (err) {
      setRegError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setRegLoading(false);
    }
  }

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password, showTotp ? totpCode : undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      if (msg.toLowerCase().includes('totp')) {
        setShowTotp(true);
        setError('Please enter your 2FA code');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  const businessTitle = resolvedBusinessName || connection?.business || 'Faida POS';
  const isTauri = !!(window.__TAURI_INTERNALS__ ?? window.__TAURI__);

  return (
    <div className={`faida-login ${isDark ? 'is-dark' : ''}`}>
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header className="topbar">
        <span className="brand"><span className="faida-mark"><img src="/faida-mark.png" alt="" /></span>{businessTitle}</span>
        <span className="topbar-spacer" />
        <span className={`status ${online ? 'green' : 'yellow'}`}>
          {online ? <Cloud size={18} /> : <CloudOff size={18} />} {online ? 'Online' : 'Offline'}
        </span>
        <button type="button" className="status topbar-look" onClick={toggleTheme}>
          {isDark ? <Moon size={18} /> : <Sun size={18} />} {isDark ? 'Dark' : 'Bright'}
        </button>
        <span className="topbar-clock">{clock.time}<small>{clock.date}</small></span>
      </header>

      <main className="pin-login">
        {/* The Faida scene: orbs, a spinning ring, tumbling cubes and a glass tile (decorative only) */}
        <div className="pin-scene" aria-hidden="true">
          <span className="orb orb-orange" /><span className="orb orb-blue" /><span className="orb orb-navy" /><span className="pin-ring" />
          {['cube cube-big', 'cube cube-small'].map((c) => (
            <span key={c} className={c}>
              {['front', 'back', 'right', 'left', 'top', 'bottom'].map((f) => <span key={f} className={`face ${f}`} />)}
            </span>
          ))}
          <span className="glass-tile" />
        </div>

        {/* ── Left: the brand ───────────────────────────────────────────── */}
        <section className="pin-brand">
          <div className="pin-logo-card"><img src="/faida-wordmark.png" alt="Faida POS" /></div>
          <div className="pin-business">
            <h1>{businessTitle}</h1>
            <span>Karibu · {clock.greeting} · {clock.time}, {clock.longDate}</span>
          </div>
          <p className="pin-hint"><ShieldCheck size={18} /> Every action is recorded under your PIN. Never share it.</p>
          <p className="pin-hint pin-support"><Phone size={18} /> Faida support (call or WhatsApp): {SUPPORT_PHONE}</p>
          {/* Which server and business this installation is connected to — Tauri desktop only */}
          {connection && (
            <p className="pin-hint" data-testid="connection-note"><Building2 size={18} /> {connection.business ?? 'Business not named yet'} · {connection.where}</p>
          )}
          {/* Reconfigure terminal — Tauri desktop only */}
          {isTauri && (
            <button
              type="button"
              className="pin-hint"
              onClick={async () => {
                // Stops this computer's own server (with a backup) if it runs one, then forgets the setup.
                await reconfigureThisComputer();
                window.location.reload();
              }}
            >
              <Settings size={18} /> Reconfigure this terminal
            </button>
          )}
        </section>

        {/* ── Right: the PIN card ───────────────────────────────────────── */}
        <section className="pin-pad">
          <div className="pin-card">
            <div className="segmented" role="group" aria-label="How to sign in">
              {([
                { id: 'email' as LoginMode,    label: 'Sign In' },
                { id: 'pin' as LoginMode,      label: 'Staff PIN' },
                { id: 'register' as LoginMode, label: 'Register' },
              ]).map(({ id, label }) => (
                <button key={id} type="button" className={mode === id ? 'on' : ''} aria-pressed={mode === id}
                  onClick={() => { setMode(id); setError(''); setRegError(''); }}>
                  {label}
                </button>
              ))}
            </div>
            <div className="pin-body">

          {/* ── Register mode ──────────────────────────────────────────────── */}
          {mode === 'register' && (
            regSuccess ? (
              <div className="py-6 text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                  <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                </div>
                <div>
                  <h3 className="font-bold text-gray-800 text-lg">Account created!</h3>
                  <p className="text-sm text-gray-500 mt-1">Your business account is ready. Sign in to get started.</p>
                </div>
                <button
                  onClick={() => { setMode('email'); setEmail(regEmail); setRegSuccess(false); }}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors"
                >
                  Go to Sign In →
                </button>
              </div>
            ) : showGoogleRegPrompt ? (
              <div className="space-y-4">
                <div className="text-center">
                  <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-3">
                    <svg className="w-6 h-6" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                  </div>
                  <h3 className="font-bold text-gray-800">One last step</h3>
                  <p className="text-sm text-gray-500 mt-1">Enter your business name to complete registration</p>
                </div>
                {regError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{regError}</div>
                )}
                <input
                  type="text"
                  value={googleRegBusiness}
                  onChange={(e) => setGoogleRegBusiness(e.target.value)}
                  className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Premier Cafe Ltd"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submitGoogleRegister(); } }}
                />
                <button
                  type="button"
                  onClick={() => void submitGoogleRegister()}
                  disabled={googleRegLoading || !googleRegBusiness.trim()}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl disabled:opacity-50 transition-colors"
                >
                  {googleRegLoading ? 'Creating account…' : 'Create Account →'}
                </button>
                <button type="button" onClick={() => { setShowGoogleRegPrompt(false); setRegError(''); }} className="w-full text-xs text-gray-400 hover:text-gray-600">
                  ← Back
                </button>
              </div>
            ) : (
              <form onSubmit={(e) => void handleRegister(e)} className="space-y-4">
                {/* Plan context banner */}
                {urlPlan && PLAN_LABELS[urlPlan] && (
                  <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-white ${PLAN_LABELS[urlPlan].color}`}>
                    <Sparkles className="w-4 h-4 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm leading-tight">{PLAN_LABELS[urlPlan].label} Plan — 30-day free trial</p>
                      <p className="text-xs opacity-80">Then {PLAN_LABELS[urlPlan].price} · Cancel anytime</p>
                    </div>
                  </div>
                )}
                {regError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{regError}</div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Your Full Name</label>
                  <input
                    type="text"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Jane Waweru"
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Business Name</label>
                  <input
                    type="text"
                    value={regBusiness}
                    onChange={(e) => setRegBusiness(e.target.value)}
                    className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Premier Cafe Ltd"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                  <input
                    type="email"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="jane@yourbusiness.co.ke"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                  <div className="relative">
                    <input
                      type={showRegPassword ? 'text' : 'password'}
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      className="w-full px-4 py-3 pr-12 border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Min. 8 characters"
                      required
                    />
                    <button type="button" onClick={() => setShowRegPassword(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showRegPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  {regPassword.length > 0 && (
                    <div className="flex gap-3 mt-2 text-xs flex-wrap">
                      <span className={regPassword.length >= 8 ? 'text-green-600' : 'text-gray-400'}>✓ 8+ chars</span>
                      <span className={/[A-Z]/.test(regPassword) ? 'text-green-600' : 'text-gray-400'}>✓ Uppercase</span>
                      <span className={/[a-z]/.test(regPassword) ? 'text-green-600' : 'text-gray-400'}>✓ Lowercase</span>
                      <span className={/[0-9]/.test(regPassword) ? 'text-green-600' : 'text-gray-400'}>✓ Number</span>
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                  <input
                    type={showRegPassword ? 'text' : 'password'}
                    value={regConfirm}
                    onChange={(e) => setRegConfirm(e.target.value)}
                    className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Re-enter password"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={regLoading}
                  className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl disabled:opacity-50 transition-colors"
                >
                  {regLoading ? 'Creating account…' : 'Create Account →'}
                </button>
                {googleAvailable && (
                <>
                <div className="flex items-center gap-3">
                  <div className="flex-1 border-t border-gray-200" />
                  <span className="text-xs text-gray-400 font-medium">OR</span>
                  <div className="flex-1 border-t border-gray-200" />
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (isDesktopApp()) { void desktopGoogleRegister(); return; }
                    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
                    if (!clientId || clientId === 'disabled') {
                      setRegError('Google sign-in is not configured. Use email registration above, or contact your administrator.');
                      return;
                    }
                    handleGoogleRegister();
                  }}
                  className="flex items-center justify-center gap-3 w-full py-3 border-2 border-gray-200 rounded-xl font-semibold text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors text-sm"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Sign up with Google
                </button>
                </>
                )}

                <p className="text-center text-xs text-gray-400">
                  Already have an account?{' '}
                  <button type="button" onClick={() => setMode('email')} className="text-blue-600 font-semibold hover:underline">Sign in</button>
                </p>
              </form>
            )
          )}

          {/* ── Email mode ─────────────────────────────────────────────────── */}
          {mode === 'email' && (
            <form onSubmit={(e) => void handleEmailLogin(e)} className="space-y-4">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {error}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="owner@business.com"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 pr-12 border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {showTotp && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">2FA Code (Authenticator App)</label>
                  <input
                    type="text"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 text-center text-2xl tracking-widest"
                    placeholder="000000"
                    maxLength={6}
                    autoFocus
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl disabled:opacity-50 transition-colors"
              >
                {loading ? 'Signing in…' : 'Sign In'}
              </button>

              {/* Forgot password link */}
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => { setShowForgot(v => !v); setForgotSent(false); setForgotError(''); setForgotEmail(email); }}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium hover:underline"
                >
                  Forgot your password?
                </button>
              </div>

              {/* Forgot password inline panel */}
              {showForgot && (
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 space-y-3">
                  {forgotSent ? (
                    <div className="text-center space-y-2">
                      <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                        <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      </div>
                      <p className="text-sm font-semibold text-gray-800">Check your email</p>
                      <p className="text-xs text-gray-500">If an account exists for <strong>{forgotEmail}</strong>, a reset link has been sent. It expires in 15 minutes.</p>
                      <button
                        type="button"
                        onClick={() => { setShowForgot(false); setForgotSent(false); }}
                        className="text-xs text-blue-600 hover:underline font-medium"
                      >
                        Back to sign in
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={(e) => void handleForgotPassword(e)} className="space-y-3">
                      <p className="text-xs text-gray-600 font-medium">Enter your email and we'll send a reset link</p>
                      {forgotError && (
                        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{forgotError}</p>
                      )}
                      <input
                        type="email"
                        value={forgotEmail}
                        onChange={e => setForgotEmail(e.target.value)}
                        className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 focus:border-transparent bg-white"
                        placeholder="your@email.com"
                        required
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={forgotLoading}
                          className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors"
                        >
                          {forgotLoading ? 'Sending…' : 'Send Reset Link'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowForgot(false)}
                          className="px-3 py-2 bg-white border border-gray-200 text-gray-500 text-sm rounded-lg hover:bg-gray-50 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}

              {googleAvailable && (
              <>
              <div className="flex items-center gap-3">
                <div className="flex-1 border-t border-gray-200" />
                <span className="text-xs text-gray-400 font-medium">OR</span>
                <div className="flex-1 border-t border-gray-200" />
              </div>

              <button
                type="button"
                onClick={() => {
                  if (isDesktopApp()) { void desktopGoogleLogin(); return; }
                  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
                  if (!clientId || clientId === 'disabled') {
                    setError('Google sign-in is not configured. Please use email and password, or contact your administrator to enable Google OAuth.');
                    return;
                  }
                  handleGoogleLogin();
                }}
                className="flex items-center justify-center gap-3 w-full py-3 border-2 border-gray-200 rounded-xl font-semibold text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors text-sm"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Sign in with Google
              </button>
              </>
              )}
            </form>
          )}

          {/* ── PIN mode ───────────────────────────────────────────────────── */}
          {mode === 'pin' && (
            <div>

              {/* Step 1: Enter Business Code */}
              {pinStep === 'business' && (
                <form onSubmit={handleBusinessSubmit} className="space-y-5">
                  <div className="text-center">
                    <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center mx-auto mb-3">
                      <Building2 className="w-7 h-7 text-blue-600" />
                    </div>
                    <h3 className="font-bold text-gray-800">Enter Business Code</h3>
                    <p className="text-sm text-gray-500 mt-1">Owner can copy this from Settings → General</p>
                  </div>
                  <input
                    type="text"
                    value={businessIdInput}
                    onChange={(e) => { setBusinessIdInput(e.target.value.toUpperCase()); setError(''); }}
                    className="w-full px-4 py-3 border-2 rounded-xl text-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-center font-mono tracking-widest uppercase"
                    placeholder="e.g. PREMIE01"
                    autoFocus
                    maxLength={12}
                  />
                  {error && <p className="text-red-500 text-sm text-center">{error}</p>}
                  <button
                    type="submit"
                    disabled={!businessIdInput.trim() || staffLoading}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl disabled:opacity-40 transition-colors"
                  >
                    {staffLoading ? 'Searching…' : 'Continue'}
                  </button>
                </form>
              )}

              {/* Step 2: Staff grid (QuickBooks-style) */}
              {pinStep === 'staff' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-gray-800">Who are you?</h3>
                      {resolvedBusinessName && (
                        <p className="text-xs text-blue-600 font-medium">{resolvedBusinessName}</p>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        localStorage.removeItem('pos-business-id');
                        localStorage.removeItem('pos-business-name');
                        setSavedBusinessId('');
                        setResolvedBusinessName('');
                        setBusinessIdInput('');
                        setPinStep('business');
                      }}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
                    >
                      <Building2 className="w-3 h-3" />
                      Change Business
                    </button>
                  </div>

                  {staffLoading && (
                    <div className="py-8 flex flex-col items-center gap-2">
                      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      <p className="text-sm text-gray-400">Loading staff…</p>
                    </div>
                  )}

                  {!staffLoading && staffLoadError && (
                    <div className="py-6 text-center space-y-3" role="alert">
                      <p className="text-sm text-red-600">{staffLoadError}</p>
                      <button type="button" onClick={() => void loadStaff(savedBusinessId)} className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold">Retry</button>
                    </div>
                  )}

                  {!staffLoading && !staffLoadError && staff.length === 0 && (
                    <div className="py-8 text-center">
                      <p className="text-gray-500 text-sm">No staff with PIN found.</p>
                      <p className="text-gray-400 text-xs mt-1">Ask the owner to set up staff PINs in HR → Staff.</p>
                    </div>
                  )}

                  {!staffLoading && staff.length > 0 && (
                    <div className="grid grid-cols-3 gap-2">
                      {staff.map((member) => (
                        <button
                          key={member.id}
                          onClick={() => selectStaff(member)}
                          className="flex flex-col items-center gap-2 p-3 rounded-xl border-2 border-transparent hover:border-blue-300 hover:bg-blue-50 transition-all group"
                        >
                          <div
                            className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-sm ${
                              ROLE_COLORS[member.role] ?? 'bg-gray-500'
                            }`}
                          >
                            {initials(member.name)}
                          </div>
                          <div className="text-center">
                            <div className="text-xs font-semibold text-gray-700 leading-tight line-clamp-2">
                              {member.name.split(' ')[0]}
                            </div>
                            <div className="text-[10px] text-gray-400 capitalize">{member.role.toLowerCase()}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Step 3: PIN numpad */}
              {pinStep === 'pad' && selectedUser && (
                <div className="space-y-5">
                  {/* Back + user identity */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => { setPinStep('staff'); setPin(''); setPinError(''); }}
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500" aria-label="Previous">
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <div className="flex items-center gap-3 flex-1">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${
                          ROLE_COLORS[selectedUser.role] ?? 'bg-gray-500'
                        }`}
                      >
                        {initials(selectedUser.name)}
                      </div>
                      <div>
                        <div className="font-bold text-gray-800 text-sm">{selectedUser.name}</div>
                        <div className="text-xs text-gray-400 capitalize">{selectedUser.role.toLowerCase()}</div>
                      </div>
                    </div>
                  </div>

                  <div className="pin-lock"><LockKeyhole size={26} /></div>
                  <p className="pin-prompt">Enter your PIN</p>
                  <div key={pinShake} className="pin-dots" data-shake={pinShake > 0 && !!pinError} aria-label={`${pin.length} of up to 6 digits entered`}>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <span key={i} className={`pin-dot ${i < pin.length ? 'filled' : ''}`} />
                    ))}
                  </div>
                  <p className="pin-error" role="alert">{pinError || '\u00a0'}</p>

                  {/* Biometric login button */}
                  {biometricAvailable && (
                    <button
                      type="button"
                      disabled={biometricLoading || loading}
                      onClick={async () => {
                        if (!selectedUser) return;
                        setBiometricLoading(true);
                        setPinError('');
                        try {
                          // Challenge, fingerprint prompt and verification all go through the server, which
                          // knows which credentials this person registered (nothing is kept in localStorage).
                          await loginWithBiometric(savedBusinessId, selectedUser.id);
                        } catch (err) {
                          const msg = err instanceof Error ? err.message : 'Biometric failed';
                          // Dismissing the system prompt is not an error worth showing.
                          if (!/NotAllowedError|cancel|abort/i.test(msg)) setPinError(msg);
                        } finally {
                          setBiometricLoading(false);
                        }
                      }}
                      className="w-full flex items-center justify-center gap-2 py-3 border-2 border-blue-200 rounded-xl text-blue-600 font-semibold text-sm hover:bg-blue-50 disabled:opacity-50 transition-colors"
                    >
                      {biometricLoading
                        ? <><div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /> Verifying…</>
                        : <><Fingerprint className="w-5 h-5" /> Use Fingerprint / Face ID</>}
                    </button>
                  )}

                  {/* Keypad: 1-9, delete, 0, OK (Enter on a keyboard) */}
                  <div className="keypad">
                    {([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((d) => (
                      <button key={d} type="button" className="key" disabled={loading} onClick={() => handlePinPad(d)}>{d}</button>
                    ))}
                    <button type="button" className="key key-quiet" aria-label="Delete" disabled={loading} onClick={() => handlePinPad('del')}>⌫</button>
                    <button type="button" className="key" disabled={loading} onClick={() => handlePinPad(0)}>0</button>
                    <button type="button" className="key key-enter" disabled={loading} onClick={() => handlePinPad('enter')}>OK</button>
                  </div>

                  {loading && (
                    <div className="flex items-center justify-center gap-2 text-sm text-blue-600">
                      <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      Signing in…
                    </div>
                  )}
                </div>
              )}

            </div>
          )}

          <p className="text-center text-xs text-gray-500 mt-6">
            Want to earn by referring businesses?{' '}
            <a href="/affiliate" className="text-blue-600 dark:text-blue-400 font-medium hover:underline">Join our affiliate program →</a>
          </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
