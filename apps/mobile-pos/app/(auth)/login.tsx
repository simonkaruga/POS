/**
 * Mobile POS — unified login screen.
 *
 * Step flow:
 *   1. SERVER_URL  — first-launch prompt to enter the API server URL
 *   2. AUTH_MODE   — choose "PIN Login" or "Email Login"
 *   3. BUSINESS    — enter business short-code (resolved to real UUID)
 *   4. STAFF       — pick staff member from the grid
 *   5. PIN_PAD     — enter PIN
 *
 * Email login replaces steps 3-5 with a single email+password form.
 */

import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView,
  KeyboardAvoidingView, Platform, FlatList, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useState, useEffect, useCallback, useRef } from 'react';
import * as SecureStore from 'expo-secure-store';
import { mobileApi } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { syncPushToken } from '../../lib/push';
import {
  isBiometricReady, getBiometricEnrolment, enableBiometric, signInWithBiometric,
  type BiometricEnrolment,
} from '../../lib/biometricLogin';
import { Colors } from '../../constants/theme';

const SERVER_URL_KEY  = 'pos_server_url';
const BUSINESS_ID_KEY = 'pos_business_id';
const BUSINESS_NM_KEY = 'pos_business_name';
const BIO_DECLINED_KEY = 'pos_biometric_declined';
const DEFAULT_URL     = 'https://faida-api.onrender.com/api/v1';

type Screen = 'SERVER_URL' | 'AUTH_MODE' | 'BUSINESS' | 'STAFF' | 'PIN_PAD' | 'EMAIL';

interface StaffMember { id: string; name: string; role: string; }
interface LoginResponse {
  accessToken?: string;
  access_token?: string;
  user: { id: string; name: string; email: string | null; role: string; businessId: string; storeId?: string; };
}

const ROLE_COLORS: Record<string, string> = {
  OWNER: Colors.indigo, MANAGER: Colors.warning,
  CASHIER: Colors.primary, WAITER: Colors.success,
};

const DIGITS = ['1','2','3','4','5','6','7','8','9','','0','DEL'] as const;

function initials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}

/** RN fetch fails with the opaque "Network request failed" — translate it. */
function friendlyError(e: unknown, fallback: string): string {
  const msg = (e as Error)?.message ?? '';
  if (msg.includes('Network request failed')) {
    return 'Could not reach the server. Make sure your phone is on the same Wi-Fi network as the server, and that the URL uses your computer’s LAN IP (e.g. http://192.168.1.50:3010/api/v1).';
  }
  return msg || fallback;
}

export default function LoginScreen() {
  const router   = useRouter();
  const setAuth  = useAuthStore(s => s.setAuth);

  const [screen,       setScreen]       = useState<Screen>('SERVER_URL');
  const [serverUrl,    setServerUrl]    = useState(DEFAULT_URL);
  const [urlInput,     setUrlInput]     = useState(DEFAULT_URL);
  const [urlTesting,   setUrlTesting]   = useState(false);
  const [urlError,     setUrlError]     = useState('');

  const [businessCode, setBusinessCode] = useState('');
  const [businessId,   setBusinessId]   = useState('');
  const [businessName, setBusinessName] = useState('');
  const [bizLoading,   setBizLoading]   = useState(false);
  const [bizError,     setBizError]     = useState('');

  const [staff,        setStaff]        = useState<StaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState<StaffMember | null>(null);

  const [pin,          setPin]          = useState('');
  const [pinLoading,   setPinLoading]   = useState(false);

  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [showPw,       setShowPw]       = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);

  // ── Fingerprint sign-in (only offered once someone has turned it on for this phone) ──
  const [bioUser,    setBioUser]    = useState<BiometricEnrolment | null>(null);
  const [bioLoading, setBioLoading] = useState(false);
  const autoPrompted = useRef(false);

  /** Shared tail of every sign-in: remember the session, then open the app. */
  function finishLogin(data: LoginResponse) {
    const token = data.accessToken ?? data.access_token ?? '';
    return SecureStore.setItemAsync('pos_token', token).then(() => {
      setAuth(data.user, token);
      void syncPushToken(data.user.id);
      // A kitchen account has one screen, so it signs straight in to the tickets.
      router.replace(data.user.role === 'KITCHEN' ? ('/manage-kitchen' as any) : '/(tabs)/pos');
    });
  }

  /** After a PIN / password sign-in, offer to switch fingerprint sign-in on (once; "Not now" is remembered). */
  async function offerBiometric(user: { id: string; name: string }) {
    try {
      if (!(await isBiometricReady())) return;
      const existing = await getBiometricEnrolment();
      if (existing?.userId === user.id) return;
      if (await SecureStore.getItemAsync(BIO_DECLINED_KEY)) return;
      Alert.alert(
        'Sign in with fingerprint?',
        'Next time, use your fingerprint or face instead of typing your PIN or password. You can turn this off in Settings.',
        [
          { text: 'Not now', style: 'cancel', onPress: () => { void SecureStore.setItemAsync(BIO_DECLINED_KEY, '1'); } },
          {
            text: 'Turn on',
            onPress: () => {
              enableBiometric(user).catch((e: any) => Alert.alert('Fingerprint sign-in', e?.message ?? 'Could not turn it on.'));
            },
          },
        ],
      );
    } catch { /* never block a sign-in on this */ }
  }

  const handleBiometric = useCallback(async () => {
    setBioLoading(true);
    try {
      const base = (await SecureStore.getItemAsync(SERVER_URL_KEY)) ?? serverUrl;
      const data = await signInWithBiometric(base);
      if (data) await finishLogin(data);
    } catch (e: any) {
      Alert.alert('Fingerprint sign-in', friendlyError(e, 'Could not sign in.'));
      setBioUser(await getBiometricEnrolment());
    } finally {
      setBioLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl]);

  useEffect(() => {
    void (async () => {
      if (!(await isBiometricReady())) return;
      const who = await getBiometricEnrolment();
      setBioUser(who);
      if (who && !autoPrompted.current) {
        autoPrompted.current = true;
        void handleBiometric();
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const biometricButton = bioUser ? (
    <TouchableOpacity
      style={[s.bioBtn, bioLoading && { opacity: 0.7 }]}
      onPress={() => void handleBiometric()}
      disabled={bioLoading}
      accessibilityRole="button"
      accessibilityLabel={`Sign in as ${bioUser.name} with fingerprint`}
    >
      {bioLoading
        ? <ActivityIndicator color={Colors.primary} />
        : <Ionicons name="finger-print" size={26} color={Colors.primary} />}
      <View style={{ flex: 1 }}>
        <Text style={s.bioTitle}>Sign in with fingerprint</Text>
        <Text style={s.bioSub}>as {bioUser.name}</Text>
      </View>
    </TouchableOpacity>
  ) : null;

  // ── On mount: restore stored server URL and business info ──────────────────
  useEffect(() => {
    void (async () => {
      const stored = await SecureStore.getItemAsync(SERVER_URL_KEY);
      if (stored) {
        setServerUrl(stored);
        setUrlInput(stored);
        // Try to restore saved business
        const savedBizId   = await SecureStore.getItemAsync(BUSINESS_ID_KEY);
        const savedBizName = await SecureStore.getItemAsync(BUSINESS_NM_KEY);
        if (savedBizId) {
          setBusinessId(savedBizId);
          setBusinessName(savedBizName ?? '');
          // Jump straight to staff selection
          setScreen('STAFF');
          await loadStaff(savedBizId, stored);
        } else {
          setScreen('AUTH_MODE');
        }
      } else {
        setScreen('SERVER_URL');
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Server URL step ────────────────────────────────────────────────────────
  async function handleSaveUrl() {
    const url = urlInput.trim().replace(/\/$/, '');
    if (!url) { setUrlError('Please enter the server URL.'); return; }
    setUrlTesting(true);
    setUrlError('');
    try {
      const res = await fetch(`${url}/health`, { method: 'GET' }).catch(() => null);
      // Accept 200, 404, 401 — all mean the server is reachable
      if (!res || (res.status >= 500 && res.status !== 503)) {
        throw new Error('Cannot reach server. Check URL and internet connection.');
      }
    } catch (e: any) {
      // Non-critical test — let user proceed anyway
      setUrlError(e.message ?? 'Could not verify server.');
    } finally {
      setUrlTesting(false);
    }
    await SecureStore.setItemAsync(SERVER_URL_KEY, url);
    setServerUrl(url);
    setScreen('AUTH_MODE');
  }

  // ── Business code step ────────────────────────────────────────────────────
  async function handleBusinessCode() {
    const code = businessCode.trim().toUpperCase();
    if (!code) { setBizError('Enter your business code.'); return; }
    setBizLoading(true);
    setBizError('');
    try {
      const res = await fetch(`${serverUrl}/business/resolve/${encodeURIComponent(code)}`);
      if (!res.ok) throw new Error('Business code not found. Ask your owner for the code.');
      const biz = await res.json() as { id: string; name: string };
      setBusinessId(biz.id);
      setBusinessName(biz.name);
      await Promise.all([
        SecureStore.setItemAsync(BUSINESS_ID_KEY, biz.id),
        SecureStore.setItemAsync(BUSINESS_NM_KEY, biz.name),
      ]);
      setScreen('STAFF');
      await loadStaff(biz.id);
    } catch (e: any) {
      setBizError(friendlyError(e, 'Failed to find business.'));
    } finally {
      setBizLoading(false);
    }
  }

  // ── Staff list ─────────────────────────────────────────────────────────────
  const loadStaff = useCallback(async (bizId: string, url?: string) => {
    const base = url ?? serverUrl;
    setStaffLoading(true);
    setStaff([]);
    try {
      const res = await fetch(`${base}/business/${bizId}/staff`);
      if (!res.ok) throw new Error('Staff not found');
      setStaff((await res.json()) as StaffMember[]);
    } catch {
      // If staff fails, go back to business step
      setScreen('BUSINESS');
      setBizError('Could not load staff. Check your business code.');
      await SecureStore.deleteItemAsync(BUSINESS_ID_KEY);
      await SecureStore.deleteItemAsync(BUSINESS_NM_KEY);
    } finally {
      setStaffLoading(false);
    }
  }, [serverUrl]);

  function selectStaff(member: StaffMember) {
    setSelectedUser(member);
    setPin('');
    setScreen('PIN_PAD');
  }

  // ── PIN pad ────────────────────────────────────────────────────────────────
  async function submitPin(pinValue: string) {
    if (!businessId) return;
    setPinLoading(true);
    try {
      const res = await fetch(`${serverUrl}/auth/login/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinValue, businessId, userId: selectedUser?.id }),
      });
      const data = await res.json() as LoginResponse;
      if (!res.ok) throw new Error((data as any).message ?? 'Invalid PIN');
      await finishLogin(data);
      void offerBiometric(data.user);
    } catch (e: any) {
      Alert.alert('Login Failed', friendlyError(e, 'Incorrect PIN. Please try again.'));
      setPin('');
    } finally {
      setPinLoading(false);
    }
  }

  function handleDigit(digit: typeof DIGITS[number]) {
    if (digit === 'DEL') { setPin(p => p.slice(0, -1)); return; }
    if (!digit) return;
    if (pin.length >= 6) return;
    const next = pin + digit;
    setPin(next);
    if (next.length >= 4) void submitPin(next);
  }

  // ── Email login ────────────────────────────────────────────────────────────
  async function handleEmailLogin() {
    if (!email.trim() || !password) {
      Alert.alert('Required', 'Please enter your email and password.');
      return;
    }
    setEmailLoading(true);
    try {
      const res = await fetch(`${serverUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const data = await res.json() as LoginResponse;
      if (!res.ok) throw new Error((data as any).message ?? 'Invalid credentials');
      await finishLogin(data);
      void offerBiometric(data.user);
    } catch (e: any) {
      Alert.alert('Login Failed', friendlyError(e, 'Invalid email or password.'));
    } finally {
      setEmailLoading(false);
    }
  }

  // ── Google OAuth (system browser → deep link back) ────────────────────────
  function handleGoogleLogin() {
    const url = `${serverUrl}/auth/google/mobile?scheme=faida-pos`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'Could not open browser for Google sign-in. Check your server URL.');
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  // ── SERVER URL step ──────────────────────────────────────────────────────
  if (screen === 'SERVER_URL') {
    return (
      <SafeAreaView edges={['top']} style={s.safe}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={s.centered} keyboardShouldPersistTaps="handled">
            <View style={s.logoArea}>
              <View style={s.logoCircle}><Ionicons name="server" size={32} color="#FFF" /></View>
              <Text style={s.appName}>Faida POS</Text>
              <Text style={s.appSub}>Server Setup</Text>
            </View>
            <View style={s.card}>
              <Text style={s.cardTitle}>API Server URL</Text>
              <Text style={s.cardSub}>Enter the URL of your Faida API server.{'\n'}For cloud users: leave as default.</Text>
              {urlError ? <Text style={s.errorText}>{urlError}</Text> : null}
              <TextInput
                style={s.input}
                value={urlInput}
                onChangeText={v => { setUrlInput(v); setUrlError(''); }}
                placeholder="https://faida-api.onrender.com/api/v1"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholderTextColor={Colors.textSecondary}
              />
              <Text style={s.hintText}>Cloud (default): https://faida-api.onrender.com/api/v1{'\n'}LAN server: http://192.168.x.x:3010/api/v1</Text>
              <TouchableOpacity style={[s.btn, urlTesting && { opacity: 0.7 }]} onPress={handleSaveUrl} disabled={urlTesting}>
                {urlTesting
                  ? <ActivityIndicator color="#FFF" />
                  : <><Ionicons name="arrow-forward-circle" size={20} color="#FFF" /><Text style={s.btnText}>Save & Continue</Text></>
                }
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── AUTH MODE step ────────────────────────────────────────────────────────
  if (screen === 'AUTH_MODE') {
    return (
      <SafeAreaView edges={['top']} style={s.safe}>
        <ScrollView contentContainerStyle={s.centered}>
          <View style={s.logoArea}>
            <View style={s.logoCircle}><Ionicons name="bag" size={36} color="#FFF" /></View>
            <Text style={s.appName}>Faida POS</Text>
            <Text style={s.appSub}>How would you like to sign in?</Text>
          </View>
          {biometricButton}
          <View style={s.authModeCard}>
            <TouchableOpacity style={s.modeBtn} onPress={() => setScreen('BUSINESS')}>
              <View style={s.modeIcon}><Ionicons name="keypad" size={26} color={Colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.modeBtnTitle}>Staff PIN Login</Text>
                <Text style={s.modeBtnSub}>For cashiers, waiters & kitchen staff using a PIN</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
            <View style={s.modeDivider} />
            <TouchableOpacity style={s.modeBtn} onPress={() => setScreen('EMAIL')}>
              <View style={[s.modeIcon, { backgroundColor: Colors.success + '20' }]}><Ionicons name="mail" size={26} color={Colors.success} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.modeBtnTitle}>Email & Password</Text>
                <Text style={s.modeBtnSub}>For owner and manager accounts</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
            <View style={s.modeDivider} />
            <TouchableOpacity style={s.modeBtn} onPress={handleGoogleLogin}>
              <View style={[s.modeIcon, { backgroundColor: '#EA433520' }]}><Ionicons name="logo-google" size={24} color="#EA4335" /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.modeBtnTitle}>Sign in with Google</Text>
                <Text style={s.modeBtnSub}>Opens browser for Google authentication</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={s.changeServerLink} onPress={() => setScreen('SERVER_URL')}>
            <Ionicons name="settings-outline" size={14} color={Colors.textSecondary} />
            <Text style={s.changeServerText}>Change server URL</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── BUSINESS CODE step ────────────────────────────────────────────────────
  if (screen === 'BUSINESS') {
    return (
      <SafeAreaView edges={['top']} style={s.safe}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={s.centered} keyboardShouldPersistTaps="handled">
            <TouchableOpacity style={s.backRow} onPress={() => setScreen('AUTH_MODE')}>
              <Ionicons name="arrow-back" size={20} color={Colors.text} />
              <Text style={s.backText}>Back</Text>
            </TouchableOpacity>
            <View style={s.logoArea}>
              <View style={[s.logoCircle, { backgroundColor: Colors.indigo }]}><Ionicons name="business" size={30} color="#FFF" /></View>
              <Text style={s.appName}>Business Code</Text>
              <Text style={s.appSub}>Enter the code from Settings → General</Text>
            </View>
            <View style={s.card}>
              {bizError ? <Text style={s.errorText}>{bizError}</Text> : null}
              <TextInput
                style={[s.input, s.codeInput]}
                value={businessCode}
                onChangeText={v => { setBusinessCode(v.toUpperCase()); setBizError(''); }}
                placeholder="e.g. PREMIE01"
                autoCapitalize="characters"
                autoCorrect={false}
                placeholderTextColor={Colors.textSecondary}
                returnKeyType="go"
                onSubmitEditing={handleBusinessCode}
                autoFocus
              />
              <TouchableOpacity style={[s.btn, bizLoading && { opacity: 0.7 }]} onPress={handleBusinessCode} disabled={bizLoading}>
                {bizLoading
                  ? <ActivityIndicator color="#FFF" />
                  : <><Ionicons name="arrow-forward-circle" size={20} color="#FFF" /><Text style={s.btnText}>Continue</Text></>
                }
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── STAFF GRID step ───────────────────────────────────────────────────────
  if (screen === 'STAFF') {
    return (
      <SafeAreaView edges={['top']} style={s.safe}>
        <View style={s.staffHeader}>
          <TouchableOpacity onPress={() => {
            void SecureStore.deleteItemAsync(BUSINESS_ID_KEY);
            void SecureStore.deleteItemAsync(BUSINESS_NM_KEY);
            setBusinessId(''); setBusinessName(''); setScreen('BUSINESS');
          }} accessibilityRole="button" accessibilityLabel="Back" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="arrow-back" size={22} color={Colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={s.staffHeaderTitle}>Who are you?</Text>
            {businessName ? <Text style={s.staffHeaderSub}>{businessName}</Text> : null}
          </View>
          <TouchableOpacity style={s.emailLoginBtn} onPress={() => setScreen('EMAIL')}>
            <Ionicons name="mail-outline" size={14} color={Colors.primary} />
            <Text style={s.emailLoginBtnText}>Email</Text>
          </TouchableOpacity>
        </View>

        {biometricButton}
        {staffLoading ? (
          <View style={s.centered}><ActivityIndicator size="large" color={Colors.primary} /></View>
        ) : staff.length === 0 ? (
          <View style={s.centered}>
            <Text style={s.emptyText}>No staff with PIN found.</Text>
            <Text style={s.emptySubText}>Ask the owner to set PINs in Settings → Staff.</Text>
            <TouchableOpacity style={[s.btn, { marginTop: 16, paddingHorizontal: 24 }]} onPress={() => setScreen('EMAIL')}>
              <Ionicons name="mail" size={18} color="#FFF" />
              <Text style={s.btnText}>Sign In with Email</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={staff}
            keyExtractor={item => item.id}
            numColumns={3}
            contentContainerStyle={{ padding: 16 }}
            renderItem={({ item }) => (
              <TouchableOpacity style={s.staffCard} onPress={() => selectStaff(item)}>
                <View style={[s.staffAvatar, { backgroundColor: (ROLE_COLORS[item.role] ?? Colors.primary) + '20' }]}>
                  <Text style={[s.staffInitials, { color: ROLE_COLORS[item.role] ?? Colors.primary }]}>{initials(item.name)}</Text>
                </View>
                <Text style={s.staffName} numberOfLines={1}>{item.name.split(' ')[0]}</Text>
                <Text style={s.staffRole}>{item.role.toLowerCase()}</Text>
              </TouchableOpacity>
            )}
          />
        )}
      </SafeAreaView>
    );
  }

  // ── PIN PAD step ──────────────────────────────────────────────────────────
  if (screen === 'PIN_PAD' && selectedUser) {
    return (
      <SafeAreaView edges={['top']} style={s.safe}>
        <ScrollView contentContainerStyle={[s.centered, { paddingVertical: 32 }]}>
          <TouchableOpacity style={s.backRow} onPress={() => { setPin(''); setScreen('STAFF'); }}>
            <Ionicons name="arrow-back" size={20} color={Colors.text} />
            <Text style={s.backText}>Back</Text>
          </TouchableOpacity>
          <View style={[s.staffAvatar, s.staffAvatarLg, { backgroundColor: (ROLE_COLORS[selectedUser.role] ?? Colors.primary) + '20' }]}>
            <Text style={[s.staffInitials, s.staffInitialsLg, { color: ROLE_COLORS[selectedUser.role] ?? Colors.primary }]}>{initials(selectedUser.name)}</Text>
          </View>
          <Text style={s.pinWhoText}>{selectedUser.name}</Text>
          <Text style={s.pinRoleText}>{selectedUser.role.toLowerCase()}</Text>

          <View style={s.dotsRow}>
            {Array.from({ length: 6 }).map((_, i) => (
              <View key={i} style={[s.dot, i < pin.length && s.dotFilled, i === pin.length && s.dotActive]} />
            ))}
          </View>

          {pinLoading && (
            <View style={s.loadingRow}>
              <ActivityIndicator color={Colors.primary} />
              <Text style={s.loadingText}>Verifying…</Text>
            </View>
          )}

          <View style={s.padGrid}>
            {DIGITS.map((digit, index) => (
              <TouchableOpacity
                key={index}
                style={[s.padKey, !digit && { opacity: 0 }, digit === 'DEL' && s.padKeyDel]}
                onPress={() => handleDigit(digit)}
                disabled={!digit || pinLoading}
                activeOpacity={0.7}
              >
                {digit === 'DEL'
                  ? <Ionicons name="backspace-outline" size={24} color={Colors.error} />
                  : <Text style={s.padKeyText}>{digit}</Text>
                }
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── EMAIL LOGIN step ──────────────────────────────────────────────────────
  return (
    <SafeAreaView edges={['top']} style={s.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.centered} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={s.backRow} onPress={() => setScreen('AUTH_MODE')}>
            <Ionicons name="arrow-back" size={20} color={Colors.text} />
            <Text style={s.backText}>Back</Text>
          </TouchableOpacity>
          <View style={s.logoArea}>
            <View style={[s.logoCircle, { backgroundColor: Colors.success }]}><Ionicons name="mail" size={30} color="#FFF" /></View>
            <Text style={s.appName}>Sign In</Text>
            <Text style={s.appSub}>Owner &amp; manager accounts</Text>
          </View>
          <View style={s.card}>
            <View style={s.fieldGroup}>
              <Text style={s.label}>Email</Text>
              <View style={s.inputWrapper}>
                <Ionicons name="mail-outline" size={18} color={Colors.textSecondary} style={{ marginRight: 8 }} />
                <TextInput
                  style={s.inputFlex}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="owner@business.co.ke"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholderTextColor={Colors.textSecondary}
                />
              </View>
            </View>
            <View style={s.fieldGroup}>
              <Text style={s.label}>Password</Text>
              <View style={s.inputWrapper}>
                <Ionicons name="lock-closed-outline" size={18} color={Colors.textSecondary} style={{ marginRight: 8 }} />
                <TextInput
                  style={[s.inputFlex, { flex: 1 }]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  secureTextEntry={!showPw}
                  placeholderTextColor={Colors.textSecondary}
                />
                <TouchableOpacity onPress={() => setShowPw(v => !v)} style={{ padding: 4 }} accessibilityRole="button" accessibilityLabel={showPw ? 'Hide password' : 'Show password'} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                  <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={18} color={Colors.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>
            <TouchableOpacity style={[s.btn, emailLoading && { opacity: 0.7 }]} onPress={handleEmailLogin} disabled={emailLoading}>
              {emailLoading
                ? <ActivityIndicator color="#FFF" />
                : <><Ionicons name="log-in-outline" size={20} color="#FFF" /><Text style={s.btnText}>Sign In</Text></>
              }
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={s.changeServerLink} onPress={() => setScreen('SERVER_URL')}>
            <Ionicons name="settings-outline" size={14} color={Colors.textSecondary} />
            <Text style={s.changeServerText}>Change server URL</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  bioBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 16, marginBottom: 14,
    padding: 16, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.primary, backgroundColor: Colors.primary + '12',
  },
  bioTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  bioSub:   { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  safe:      { flex: 1, backgroundColor: Colors.background },
  centered:  { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 20 },
  backRow:   { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginBottom: 4 },
  backText:  { fontSize: 15, color: Colors.text, fontWeight: '600' },

  logoArea:  { alignItems: 'center', gap: 6 },
  logoCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  appName: { fontSize: 24, fontWeight: '800', color: Colors.text },
  appSub:  { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' },

  card: {
    width: '100%', backgroundColor: Colors.card, borderRadius: 16,
    padding: 20, gap: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 6, elevation: 2,
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  cardSub:   { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  errorText: { fontSize: 13, color: Colors.error, marginBottom: 2 },
  hintText:  { fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },

  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 12,
    backgroundColor: Colors.background,
    paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 15, color: Colors.text,
  },
  codeInput: { textAlign: 'center', fontFamily: 'monospace', letterSpacing: 4, fontSize: 20, fontWeight: '700' },

  btn: {
    backgroundColor: Colors.primary, borderRadius: 12,
    paddingVertical: 14, flexDirection: 'row',
    justifyContent: 'center', alignItems: 'center', gap: 8,
  },
  btnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },

  // Auth mode picker
  authModeCard: {
    width: '100%', backgroundColor: Colors.card, borderRadius: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 6, elevation: 2,
    overflow: 'hidden',
  },
  modeBtn: { flexDirection: 'row', alignItems: 'center', padding: 18, gap: 14 },
  modeIcon: {
    width: 48, height: 48, borderRadius: 12,
    backgroundColor: Colors.primary + '20',
    justifyContent: 'center', alignItems: 'center',
  },
  modeBtnTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  modeBtnSub:   { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  modeDivider:  { height: 1, backgroundColor: Colors.border, marginHorizontal: 16 },

  changeServerLink: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  changeServerText: { fontSize: 13, color: Colors.textSecondary },

  // Staff grid
  staffHeader: {
    flexDirection: 'row', alignItems: 'center',
    padding: 16, backgroundColor: Colors.card,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  staffHeaderTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  staffHeaderSub:   { fontSize: 12, color: Colors.primary, marginTop: 1 },
  emailLoginBtn:    { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 8 },
  emailLoginBtnText:{ fontSize: 13, color: Colors.primary, fontWeight: '600' },

  staffCard: {
    flex: 1, margin: 6, alignItems: 'center', padding: 12,
    backgroundColor: Colors.card, borderRadius: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  staffAvatar: {
    width: 52, height: 52, borderRadius: 26,
    justifyContent: 'center', alignItems: 'center', marginBottom: 6,
    backgroundColor: Colors.primary + '20',
  },
  staffAvatarLg: { width: 80, height: 80, borderRadius: 40, marginBottom: 8 },
  staffInitials: { fontSize: 18, fontWeight: '800', color: Colors.primary },
  staffInitialsLg: { fontSize: 28 },
  staffName: { fontSize: 12, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  staffRole: { fontSize: 10, color: Colors.textSecondary, textTransform: 'capitalize' },

  emptyText:    { fontSize: 15, fontWeight: '600', color: Colors.text, textAlign: 'center' },
  emptySubText: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginTop: 6 },

  // PIN pad
  pinWhoText:  { fontSize: 20, fontWeight: '700', color: Colors.text, marginTop: 8 },
  pinRoleText: { fontSize: 13, color: Colors.textSecondary, textTransform: 'capitalize', marginBottom: 8 },
  dotsRow:     { flexDirection: 'row', gap: 14, marginVertical: 8 },
  dot:         { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: Colors.border, backgroundColor: 'transparent' },
  dotFilled:   { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dotActive:   { borderColor: Colors.primary },
  loadingRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  loadingText: { fontSize: 13, color: Colors.textSecondary },
  padGrid:     { flexDirection: 'row', flexWrap: 'wrap', width: 264, gap: 12, justifyContent: 'center', marginTop: 8 },
  padKey:      { width: 76, height: 76, borderRadius: 38, backgroundColor: Colors.card, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  padKeyDel:   { backgroundColor: Colors.error + '15' },
  padKeyText:  { fontSize: 24, fontWeight: '600', color: Colors.text },

  // Email form
  fieldGroup:   { gap: 6 },
  label:        { fontSize: 13, fontWeight: '600', color: Colors.text },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: Colors.border, borderRadius: 12, backgroundColor: Colors.background, paddingHorizontal: 12 },
  inputFlex:    { flex: 1, paddingVertical: 13, fontSize: 15, color: Colors.text },
});
