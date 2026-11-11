import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiPost } from '../lib/api';
import { useSessionStore } from '../stores/session';

const PRIMARY = '#6366F1';
const BG = '#F8FAFC';
const CARD = '#FFFFFF';
const TEXT = '#1E293B';
const SUBTLE = '#64748B';
const BORDER = '#E2E8F0';
const ERROR = '#EF4444';

/** Kenyan phone → canonical 2547XXXXXXXX (strip +, leading 0, spaces). */
function normalizePhone(local: string): string {
  let d = local.replace(/[^0-9]/g, '');
  if (d.startsWith('254')) return d;
  if (d.startsWith('0')) d = d.slice(1);
  return `254${d}`;
}

interface OtpResp {
  sent: boolean; customerId: string; isNew: boolean; otp?: string;
  expiresInSeconds: number; resendInSeconds: number;
}
interface VerifyResp { sessionToken: string; customerId: string; customerName: string; isNew: boolean }

/**
 * Phone-OTP login gate. Shown after the business is connected but before the
 * customer is authenticated. On success it stores the portal session token and
 * calls onDone().
 */
export default function LoginGate({ onDone }: { onDone: () => void }) {
  const businessId = useSessionStore((s) => s.businessId);
  const businessName = useSessionStore((s) => s.businessName);
  const setAuth = useSessionStore((s) => s.setAuth);

  const [step, setStep] = useState<'PHONE' | 'OTP'>('PHONE');
  const [phoneInput, setPhoneInput] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [isNew, setIsNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [devOtp, setDevOtp] = useState<string | null>(null);
  // The two clocks the customer needs: how long this code lives, and when they
  // may ask for another. Both come from the server so they match what it enforces.
  const [expiresIn, setExpiresIn] = useState(0);
  const [resendIn, setResendIn] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (step !== 'OTP') return;
    const t = setInterval(() => {
      setExpiresIn((v) => (v > 0 ? v - 1 : 0));
      setResendIn((v) => (v > 0 ? v - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [step]);

  const expired = started.current && expiresIn === 0;
  const countdown = `${Math.floor(expiresIn / 60)}:${String(expiresIn % 60).padStart(2, '0')}`;

  const phone = normalizePhone(phoneInput);

  async function requestOtp() {
    if (phoneInput.replace(/[^0-9]/g, '').length < 9) { setError('Enter a valid phone number.'); return; }
    setLoading(true); setError('');
    try {
      const resp = await apiPost<OtpResp>('/portal/auth/request-otp', { phone, businessId });
      setIsNew(resp.isNew);
      setDevOtp(resp.otp ?? null);
      setOtp('');
      setExpiresIn(resp.expiresInSeconds ?? 600);
      setResendIn(resp.resendInSeconds ?? 60);
      started.current = true;
      setStep('OTP');
    } catch (e: any) {
      setError(e?.message ?? 'Could not send code. Try again.');
    } finally {
      setLoading(false);
    }
  }

  async function verify() {
    if (expired) { setError('That code has expired. Ask for a new one.'); return; }
    if (otp.trim().length < 4) { setError('Enter the code we sent you.'); return; }
    if (isNew && !name.trim()) { setError('Please tell us your name.'); return; }
    setLoading(true); setError('');
    try {
      const resp = await apiPost<VerifyResp>('/portal/auth/verify-otp', {
        phone, otp: otp.trim(), businessId, ...(isNew ? { name: name.trim() } : {}),
      });
      await setAuth({
        token: resp.sessionToken,
        customerId: resp.customerId,
        customerName: resp.customerName,
        phone,
      });
      onDone();
    } catch (e: any) {
      setError(e?.message ?? 'Invalid or expired code.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView edges={['top']} style={s.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.centered} keyboardShouldPersistTaps="handled">
          <View style={s.logoWrap}>
            <View style={s.logoCircle}><Ionicons name="person-circle" size={40} color="#FFF" /></View>
            <Text style={s.appName}>{businessName || 'Faida Order'}</Text>
            <Text style={s.appSub}>{step === 'PHONE' ? 'Sign in to order & track' : 'Enter the code we texted you'}</Text>
          </View>

          {step === 'PHONE' ? (
            <View style={s.card}>
              <Text style={s.cardTitle}>Your phone number</Text>
              <Text style={s.cardSub}>We'll text you a one-time code to sign in or create your account.</Text>
              {error ? <Text style={s.error}>{error}</Text> : null}
              <View style={s.phoneRow}>
                <View style={s.prefix}><Text style={s.prefixText}>+254</Text></View>
                <TextInput
                  style={[s.input, { flex: 1 }]}
                  value={phoneInput}
                  onChangeText={(v) => { setPhoneInput(v); setError(''); }}
                  placeholder="7XX XXX XXX"
                  keyboardType="phone-pad"
                  maxLength={12}
                  placeholderTextColor={SUBTLE}
                  autoFocus
                />
              </View>
              <TouchableOpacity style={[s.btn, loading && { opacity: 0.7 }]} onPress={requestOtp} disabled={loading}>
                {loading ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="paper-plane" size={18} color="#FFF" /><Text style={s.btnText}>Send code</Text></>}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={s.card}>
              <View style={s.titleRow}>
                <Text style={s.cardTitle}>Verification code</Text>
                <Text style={[s.timer, expired ? s.timerDead : expiresIn <= 60 ? s.timerWarn : null]}>
                  {expired ? 'Expired' : `Expires in ${countdown}`}
                </Text>
              </View>
              <Text style={s.cardSub}>Sent to +{phone}.{devOtp ? `  (dev: ${devOtp})` : ''}</Text>
              {error ? <Text style={s.error}>{error}</Text> : null}
              <TextInput
                style={[s.input, s.codeInput, expired && s.inputDead]}
                value={otp}
                onChangeText={(v) => { setOtp(v.replace(/[^0-9]/g, '')); setError(''); }}
                placeholder="••••••"
                keyboardType="number-pad"
                maxLength={6}
                editable={!expired}
                placeholderTextColor={SUBTLE}
                autoFocus
              />
              {isNew ? (
                <>
                  <Text style={s.cardSub}>Welcome! What's your name?</Text>
                  <TextInput
                    style={s.input}
                    value={name}
                    onChangeText={(v) => { setName(v); setError(''); }}
                    placeholder="Your name"
                    placeholderTextColor={SUBTLE}
                  />
                </>
              ) : null}
              <TouchableOpacity
                style={[s.btn, (loading || expired) && { opacity: 0.7 }]}
                onPress={verify}
                disabled={loading || expired}
              >
                {loading ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="checkmark-circle" size={18} color="#FFF" /><Text style={s.btnText}>{isNew ? 'Create account' : 'Sign in'}</Text></>}
              </TouchableOpacity>
              <TouchableOpacity
                style={s.changeLink}
                onPress={requestOtp}
                disabled={loading || resendIn > 0}
              >
                <Ionicons name="refresh" size={13} color={resendIn > 0 ? SUBTLE : PRIMARY} />
                <Text style={[s.changeLinkText, resendIn === 0 && s.resendReady]}>
                  {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.changeLink} onPress={() => { setStep('PHONE'); setOtp(''); setError(''); started.current = false; }}>
                <Ionicons name="arrow-back" size={13} color={SUBTLE} />
                <Text style={s.changeLinkText}>Change number</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  centered: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 20 },
  logoWrap: { alignItems: 'center', gap: 8 },
  logoCircle: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: PRIMARY,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: PRIMARY, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  appName: { fontSize: 22, fontWeight: '800', color: TEXT, textAlign: 'center' },
  appSub: { fontSize: 13, color: SUBTLE, textAlign: 'center' },
  card: {
    width: '100%', backgroundColor: CARD, borderRadius: 16, padding: 20, gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 6, elevation: 2,
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: TEXT },
  cardSub: { fontSize: 13, color: SUBTLE, lineHeight: 19 },
  error: { fontSize: 13, color: ERROR },
  phoneRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  prefix: { borderWidth: 1, borderColor: BORDER, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, backgroundColor: BG },
  prefixText: { fontSize: 15, color: TEXT, fontWeight: '700' },
  input: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 12,
    backgroundColor: BG, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: TEXT,
  },
  codeInput: { textAlign: 'center', fontFamily: 'monospace', letterSpacing: 8, fontSize: 24, fontWeight: '700' },
  btn: {
    backgroundColor: PRIMARY, borderRadius: 12, paddingVertical: 14,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
  },
  btnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  changeLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  changeLinkText: { fontSize: 12, color: SUBTLE },
  resendReady: { color: PRIMARY, fontWeight: '700' },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  timer: { fontSize: 12, fontWeight: '700', color: SUBTLE },
  timerWarn: { color: '#D97706' },
  timerDead: { color: ERROR },
  inputDead: { opacity: 0.5 },
});
