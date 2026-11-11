import { useState } from 'react';
import { adminApi, setAdminToken } from '../lib/api';
import { C } from '../generated/tokens';
import { Zap, Eye, EyeOff } from 'lucide-react';

interface Props { onLogin: () => void }

export default function LoginPage({ onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { token } = await adminApi.login(email, password);
      setAdminToken(token, email);
      onLogin();
    } catch (err: any) {
      setError(err.message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.75rem 1rem',
    background: C.input,
    border: `1px solid ${C.cardBorder}`,
    borderRadius: '10px',
    color: C.text,
    fontSize: '0.9375rem',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  };

  return (
    <div style={{
      display: 'flex', minHeight: '100vh',
      background: `radial-gradient(ellipse at 30% 20%, ${C.blue}1a 0%, transparent 60%), ${C.surface}`,
      alignItems: 'center', justifyContent: 'center', padding: '1rem',
    }}>
      <div className="fade-in" style={{
        background: C.card,
        border: `1px solid ${C.cardBorder}`,
        borderRadius: '20px',
        width: '100%', maxWidth: '420px',
        overflow: 'hidden',
        boxShadow: `0 40px 80px -20px ${C.overlay}33`,
      }}>
        {/* Header */}
        <div style={{ padding: '2.5rem 2.5rem 2rem', textAlign: 'center', borderBottom: `1px solid ${C.cardBorder}` }}>
          <div style={{
            width: '64px', height: '64px',
            background: `linear-gradient(135deg, ${C.blue} 0%, ${C.accentDark} 100%)`,
            borderRadius: '18px',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: '1.25rem',
            boxShadow: `0 8px 28px ${C.blue}73`,
            fontSize: '2rem',
          }}><Zap size={28} color="#fff" aria-hidden /></div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: C.text, letterSpacing: '-0.02em' }}>
            Faida Admin
          </h1>
          <p style={{ color: C.textMuted, fontSize: '0.8125rem', marginTop: '4px' }}>
            Platform administration portal
          </p>
        </div>

        {/* Form */}
        <div style={{ padding: '2rem 2.5rem 2.5rem' }}>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: C.textSecondary, marginBottom: '6px' }}>
                Email address
              </label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)} required
                autoFocus placeholder="admin@faidapos.co.ke"
                style={inputStyle}
                onFocus={e => { e.target.style.borderColor = C.blue; }}
                onBlur={e => { e.target.style.borderColor = C.cardBorder; }}
              />
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: C.textSecondary, marginBottom: '6px' }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password} onChange={e => setPassword(e.target.value)} required
                  placeholder="••••••••"
                  style={{ ...inputStyle, paddingRight: '2.75rem' }}
                  onFocus={e => { e.target.style.borderColor = C.blue; }}
                  onBlur={e => { e.target.style.borderColor = C.cardBorder; }}
                />
                <button
                  type="button" onClick={() => setShowPw(v => !v)} tabIndex={-1}
                  style={{
                    position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: '16px',
                  }}
                >
                  {showPw ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                </button>
              </div>
            </div>

            {error && (
              <div style={{
                background: `${C.red}1a`, border: `1px solid ${C.red}40`,
                borderRadius: '8px', padding: '0.75rem 1rem',
                color: C.red, fontSize: '0.875rem', marginBottom: '1rem',
              }}>
                {error}
              </div>
            )}

            <button
              type="submit" disabled={loading}
              style={{
                width: '100%', padding: '0.875rem',
                background: loading ? `${C.blue}99` : `linear-gradient(135deg, ${C.blue} 0%, ${C.accentDark} 100%)`,
                color: '#fff', border: 'none', borderRadius: '10px',
                fontSize: '0.9375rem', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
                boxShadow: loading ? 'none' : `0 4px 16px ${C.blue}59`,
                transition: 'all 0.15s',
                letterSpacing: '0.01em',
              }}
              onMouseEnter={e => { if (!loading) (e.currentTarget).style.transform = 'translateY(-1px)'; }}
              onMouseLeave={e => { (e.currentTarget).style.transform = 'translateY(0)'; }}
            >
              {loading ? 'Signing in…' : 'Sign In to Console'}
            </button>
          </form>

          <div style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.6875rem', color: C.textMuted }}>
            Faida POS v1.01 · Secured admin console
          </div>
        </div>
      </div>
    </div>
  );
}
