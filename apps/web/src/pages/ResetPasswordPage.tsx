import { useState } from 'react';
import { Eye, EyeOff, CheckCircle, XCircle } from 'lucide-react';

function PasswordRule({ met, label }: { met: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-1.5 text-xs ${met ? 'text-green-600' : 'text-gray-400'}`}>
      {met ? <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" /> : <XCircle className="w-3.5 h-3.5 flex-shrink-0" />}
      {label}
    </div>
  );
}

export default function ResetPasswordPage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';

  const [password, setPassword]       = useState('');
  const [confirm, setConfirm]         = useState('');
  const [showPw, setShowPw]           = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading]         = useState(false);
  const [done, setDone]               = useState(false);
  const [error, setError]             = useState('');

  const rules = {
    length:  password.length >= 8,
    upper:   /[A-Z]/.test(password),
    number:  /\d/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
    match:   password.length > 0 && password === confirm,
  };
  const allMet = Object.values(rules).every(Boolean);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allMet) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await res.json() as { success?: boolean; message?: string };
      if (res.ok && data.success) {
        setDone(true);
      } else {
        setError(data.message ?? 'Reset failed. The link may have expired.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-blue-950 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 text-center">
          <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Invalid Link</h2>
          <p className="text-sm text-gray-500 mb-6">This password reset link is missing a token. Please request a new one.</p>
          <a href="/login" className="text-blue-600 text-sm font-semibold hover:underline">Back to sign in</a>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-blue-950 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Password Updated</h2>
          <p className="text-sm text-gray-500 mb-6">
            Your password has been reset successfully. You can now sign in with your new password.
          </p>
          <a
            href="/login"
            className="inline-block w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl text-center transition-colors"
          >
            Go to Sign In
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-blue-950 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center shadow-lg">
            <span className="text-white font-black text-sm">F</span>
          </div>
          <div>
            <div className="font-black text-gray-900 text-base leading-tight">Faida POS</div>
            <div className="text-xs text-gray-400">Set new password</div>
          </div>
        </div>

        <h2 className="text-lg font-bold text-gray-900 mb-1">Reset your password</h2>
        <p className="text-xs text-gray-500 mb-5">Choose a strong password. The link expires 15 minutes after it was sent.</p>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 flex items-start gap-2 text-sm text-red-700">
            <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {/* New password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 border rounded-xl text-sm pr-10 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Min. 8 characters"
                autoFocus
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Confirm password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full px-3 py-2.5 border rounded-xl text-sm pr-10 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Repeat password"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowConfirm((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Rules checklist */}
          {password.length > 0 && (
            <div className="grid grid-cols-2 gap-1 p-3 bg-gray-50 rounded-xl">
              <PasswordRule met={rules.length}  label="8+ characters" />
              <PasswordRule met={rules.upper}   label="Uppercase letter" />
              <PasswordRule met={rules.number}  label="Number" />
              <PasswordRule met={rules.special} label="Special character" />
              <PasswordRule met={rules.match}   label="Passwords match" />
            </div>
          )}

          <button
            type="submit"
            disabled={!allMet || loading}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors"
          >
            {loading ? 'Saving…' : 'Set New Password'}
          </button>

          <div className="text-center">
            <a href="/login" className="text-xs text-gray-400 hover:text-blue-600 hover:underline transition-colors">
              Back to sign in
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}
