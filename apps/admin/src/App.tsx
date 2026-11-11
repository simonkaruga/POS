import { useState, useEffect, useRef } from 'react';
import { getAdminToken, getAdminEmail, clearAdminToken, adminApi } from './lib/api';
import { DialogProvider } from './components/Dialog';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import BusinessesPage from './pages/BusinessesPage';
import LicenseKeysPage from './pages/LicenseKeysPage';
import SupportPage from './pages/SupportPage';
import ReferralsPage from './pages/ReferralsPage';
import AffiliatesPage from './pages/AffiliatesPage';
import UsersPage from './pages/UsersPage';
import AnalyticsPage from './pages/AnalyticsPage';
import WebhooksPage from './pages/WebhooksPage';
import PlatformSettingsPage from './pages/PlatformSettingsPage';
import HelpPage from './pages/HelpPage';
import { C } from './generated/tokens';

type Page = 'dashboard' | 'businesses' | 'users' | 'license-keys' | 'support' | 'referrals' | 'affiliates' | 'analytics' | 'webhooks' | 'platform-settings' | 'help';


// Simple SVG icon components (no external dep required)
function Icon({ d, size = 16, color }: { d: string; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color ?? 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

// Icon paths
const Icons = {
  dashboard: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10',
  businesses: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  license: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z',
  support: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  bolt: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
};

// Icon paths
const MoreIcons = {
  referral:  'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  users:     'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  analytics: 'M18 20V10 M12 20V4 M6 20v-6',
  webhooks:  'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  settings:  'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  help:      'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z',
};

const NAV: Array<{ id: Page; label: string; icon: string; color: string; group?: string }> = [
  { id: 'dashboard',         label: 'Dashboard',        icon: Icons.dashboard,     color: C.accent },
  { id: 'businesses',        label: 'Businesses',       icon: Icons.businesses,    color: C.purple },
  { id: 'users',             label: 'Users',            icon: MoreIcons.users,     color: C.accentText },
  { id: 'analytics',         label: 'Analytics',        icon: MoreIcons.analytics, color: C.green },
  { id: 'license-keys',      label: 'License Keys',     icon: Icons.license,       color: C.success },
  { id: 'referrals',         label: 'Referrals',        icon: MoreIcons.referral,  color: C.purple },
  { id: 'affiliates',        label: 'Affiliates',       icon: MoreIcons.referral,  color: C.purple },
  { id: 'webhooks',          label: 'Webhooks',         icon: MoreIcons.webhooks,  color: C.amber },
  { id: 'support',           label: 'Support Tools',    icon: Icons.support,       color: C.warning },
  { id: 'platform-settings', label: 'Platform Settings',icon: MoreIcons.settings,  color: C.purple },
  { id: 'help',              label: 'Guide',            icon: MoreIcons.help,      color: C.accentText },
];

export default function App() {
  const [isAuth, setIsAuth] = useState(() => !!getAdminToken());
  const [page,   setPage]   = useState<Page>('dashboard');
  const [health, setHealth] = useState<any>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [alertOpen, setAlertOpen]   = useState(false);
  const [alertSeen, setAlertSeen]   = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);
  const alertRef = useRef<HTMLDivElement>(null);

  // Poll health + alerts every 30s
  useEffect(() => {
    if (!isAuth) return;
    const fetchAll = () => {
      adminApi.getHealth().then(setHealth).catch(() => null);
      adminApi.getAlertFeed().then((a: any[]) => setAlerts(a ?? [])).catch(() => null);
    };
    fetchAll();
    const id = setInterval(fetchAll, 30_000);
    return () => clearInterval(id);
  }, [isAuth]);

  // Close alert dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (alertRef.current && !alertRef.current.contains(e.target as Node)) setAlertOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!isAuth) return <LoginPage onLogin={() => setIsAuth(true)} />;

  const logout = () => { clearAdminToken(); setIsAuth(false); };

  // Derive system status from live health data
  const emailQ   = health?.queueDepths?.email    ?? 0;
  const webhookQ = health?.queueDepths?.webhooks ?? 0;
  const etimsQ   = health?.queueDepths?.etims    ?? 0;
  const failRate = health?.etimsFailureRate       ?? 0;
  const isIncident  = failRate > 20 || emailQ > 50 || webhookQ > 50 || etimsQ > 50;
  const isDegraded  = !isIncident && (failRate > 0 || emailQ > 10 || webhookQ > 10 || etimsQ > 10);
  const sysStatus   = isIncident ? 'INCIDENT' : isDegraded ? 'DEGRADED' : 'OPERATIONAL';
  const sysColor    = isIncident ? C.red  : isDegraded ? C.amber  : C.green;

  const unseenAlerts = alerts.length - alertSeen;
  const criticalAlerts = alerts.filter(a => a.severity === 'critical').length;

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  const navigate = (id: Page) => {
    setPage(id);
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  return (
    <DialogProvider>
    <div style={{ display: 'flex', minHeight: '100vh', background: C.bg, position: 'relative' }}>

      {/* ── Mobile overlay backdrop ───────────────────────────────────────── */}
      {sidebarOpen && isMobile && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 40,
            background: `${C.overlay}99`, backdropFilter: 'blur(2px)',
          }}
        />
      )}

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <aside style={{
        width: '240px',
        background: C.sidebar,
        flexShrink: 0,
        display: sidebarOpen ? 'flex' : 'none',
        flexDirection: 'column',
        borderRight: `1px solid ${C.sidebarBorder}`,
        position: window.innerWidth < 768 ? 'fixed' : 'relative',
        top: 0, left: 0, bottom: 0,
        zIndex: 50,
      }}>

        {/* Brand */}
        <div style={{ padding: '1.5rem 1.25rem 1.25rem', borderBottom: `1px solid ${C.sidebarBorder}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.5rem' }}>
            <div style={{
              width: '36px', height: '36px',
              background: `linear-gradient(135deg, ${C.blue} 0%, ${C.accentDark} 100%)`,
              borderRadius: '10px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 4px 12px ${C.blue}59`,
              flexShrink: 0,
            }}>
              <Icon d={Icons.bolt} size={18} color="#fff" />
            </div>
            <div>
              <div style={{ fontSize: '0.9375rem', fontWeight: 800, color: C.text, letterSpacing: '-0.01em' }}>Faida</div>
              <div style={{ fontSize: '0.6875rem', color: C.textMuted, marginTop: '1px' }}>Super Admin Console</div>
            </div>
          </div>
          {/* Status dot — live */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '0.75rem' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: sysColor, boxShadow: `0 0 6px ${sysColor}` }} />
            <span style={{ fontSize: '0.6875rem', color: C.textMuted }}>
              {sysStatus === 'OPERATIONAL' ? 'System operational' : sysStatus === 'DEGRADED' ? 'System degraded' : 'Active incident'}
            </span>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '0.75rem 0.625rem' }}>
          <div style={{ fontSize: '0.625rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '0 0.625rem', marginBottom: '0.5rem' }}>
            Navigation
          </div>
          {NAV.map(item => {
            const active = page === item.id;
            return (
              <button
                key={item.id}
                onClick={() => navigate(item.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.625rem',
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.625rem 0.75rem',
                  marginBottom: '2px',
                  background: active ? `${C.blue}1f` : 'transparent',
                  color: active ? C.accentText : C.textSecondary,
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: active ? 600 : 400,
                  transition: 'all 0.12s ease',
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    (e.currentTarget as HTMLButtonElement).style.background = `${C.text}0a`;
                    (e.currentTarget as HTMLButtonElement).style.color = C.text;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                    (e.currentTarget as HTMLButtonElement).style.color = C.textSecondary;
                  }
                }}
              >
                <div style={{
                  width: '30px', height: '30px',
                  borderRadius: '8px',
                  background: active ? `${C.blue}33` : `${C.text}0d`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  color: active ? item.color : C.textMuted,
                  transition: 'all 0.12s ease',
                }}>
                  <Icon d={item.icon} size={14} />
                </div>
                {item.label}
                {active && (
                  <div style={{
                    marginLeft: 'auto',
                    width: '6px', height: '6px',
                    borderRadius: '50%',
                    background: C.accent,
                    flexShrink: 0,
                  }} />
                )}
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        <div style={{ padding: '0.75rem 0.625rem', borderTop: `1px solid ${C.sidebarBorder}` }}>
          {/* Admin identity */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.5rem 0.75rem', marginBottom: '4px',
          }}>
            <div style={{
              width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
              background: `linear-gradient(135deg, ${C.blue}, ${C.purple})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.6875rem', color: '#fff', fontWeight: 800,
            }}>
              {getAdminEmail().charAt(0).toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.6875rem', color: C.textSecondary, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {getAdminEmail()}
              </div>
              <div style={{ fontSize: '0.5625rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Super Admin</div>
            </div>
          </div>
          <button
            onClick={logout}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.625rem',
              width: '100%',
              padding: '0.5rem 0.75rem',
              background: 'transparent',
              color: C.red,
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: 500,
              transition: 'all 0.12s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = `${C.red}1a`;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            }}
          >
            <div style={{
              width: '28px', height: '28px',
              borderRadius: '8px',
              background: `${C.red}1a`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Icon d={Icons.logout} size={13} color={C.red} />
            </div>
            Sign Out
          </button>
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, overflow: 'auto', background: C.bg }}>
        {/* Top bar */}
        <div style={{
          padding: '1rem 2rem',
          borderBottom: `1px solid ${C.sidebarBorder}`,
          background: C.sidebar,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div>
            <h1 style={{ fontSize: '1.125rem', fontWeight: 700, color: C.text, lineHeight: 1 }}>
              {NAV.find(n => n.id === page)?.label}
            </h1>
            <div style={{ fontSize: '0.75rem', color: C.textMuted, marginTop: '2px' }}>
              Faida POS Platform Administration
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>

            {/* Sidebar toggle */}
            <button
              onClick={() => setSidebarOpen(o => !o)}
              aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
              title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
              style={{
                background: `${C.text}0d`,
                border: `1px solid ${C.sidebarBorder}`,
                borderRadius: '10px', width: '36px', height: '36px',
                cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', transition: 'all 0.15s', flexShrink: 0,
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>

            {/* Alert bell */}
            <div ref={alertRef} style={{ position: 'relative' }}>
              <button
                onClick={() => { setAlertOpen(o => !o); setAlertSeen(alerts.length); }}
                aria-label={unseenAlerts > 0 ? `Alerts, ${unseenAlerts} new` : 'Alerts'}
                style={{
                  position: 'relative', background: unseenAlerts > 0 ? `${C.red}1a` : `${C.text}0d`,
                  border: `1px solid ${unseenAlerts > 0 ? `${C.red}4c` : C.sidebarBorder}`,
                  borderRadius: '10px', width: '36px', height: '36px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s',
                }}
              >
                <Icon d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0" size={15} color={unseenAlerts > 0 ? C.red : C.textMuted} />
                {unseenAlerts > 0 && (
                  <span style={{
                    position: 'absolute', top: '4px', right: '4px',
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: criticalAlerts > 0 ? C.red : C.amber,
                    boxShadow: `0 0 5px ${criticalAlerts > 0 ? C.red : C.amber}`,
                  }} />
                )}
              </button>

              {alertOpen && (
                <div style={{
                  position: 'absolute', top: '44px', right: 0, width: '340px',
                  background: C.sidebar, border: `1px solid ${C.sidebarBorder}`,
                  borderRadius: '14px', boxShadow: `0 12px 40px ${C.overlay}33`,
                  zIndex: 100, overflow: 'hidden',
                }}>
                  <div style={{ padding: '0.875rem 1rem', borderBottom: `1px solid ${C.sidebarBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 700, color: C.text, fontSize: '0.875rem' }}>Platform Alerts</span>
                    <span style={{ fontSize: '0.6875rem', color: C.textMuted }}>{alerts.length} total</span>
                  </div>
                  <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
                    {alerts.length === 0 ? (
                      <div style={{ padding: '2rem', textAlign: 'center', color: C.textMuted, fontSize: '0.875rem' }}>No alerts — all clear</div>
                    ) : alerts.map((a, i) => {
                      const severityColor = a.severity === 'critical' ? C.red : a.severity === 'warning' ? C.amber : C.cyan;
                      return (
                        <div key={i} style={{
                          padding: '0.75rem 1rem', borderBottom: `1px solid ${C.sidebarBorder}`,
                          borderLeft: `3px solid ${severityColor}`,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: C.text, lineHeight: 1.3 }}>{a.title}</span>
                            <span style={{ fontSize: '0.625rem', fontWeight: 700, color: severityColor, background: `${severityColor}18`, padding: '1px 6px', borderRadius: 6, flexShrink: 0 }}>
                              {String(a.severity).toUpperCase()}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.75rem', color: C.textMuted, marginTop: '3px', lineHeight: 1.4 }}>{a.body}</div>
                          {a.businessName && (
                            <button
                              onClick={() => { setPage('businesses'); setAlertOpen(false); }}
                              style={{ fontSize: '0.6875rem', color: C.blue, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', marginTop: '2px' }}
                            >
                              → {a.businessName}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div style={{
              padding: '0.375rem 0.75rem',
              background: `${C.green}1a`, border: `1px solid ${C.green}33`,
              borderRadius: '20px', fontSize: '0.75rem', color: C.green, fontWeight: 600,
            }}>
              LIVE
            </div>
          </div>
        </div>

        <div style={{ padding: '2rem' }} className="fade-in">
          {page === 'dashboard'          && <DashboardPage />}
          {page === 'businesses'         && <BusinessesPage />}
          {page === 'users'              && <UsersPage />}
          {page === 'analytics'          && <AnalyticsPage />}
          {page === 'license-keys'       && <LicenseKeysPage />}
          {page === 'referrals'          && <ReferralsPage />}
          {page === 'affiliates'         && <AffiliatesPage />}
          {page === 'webhooks'           && <WebhooksPage />}
          {page === 'support'            && <SupportPage />}
          {page === 'platform-settings'  && <PlatformSettingsPage />}
          {page === 'help'               && <HelpPage />}
        </div>
      </main>
    </div>
    </DialogProvider>
  );
}
