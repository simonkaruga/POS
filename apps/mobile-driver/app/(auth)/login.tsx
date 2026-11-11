/**
 * Driver app login.
 *
 * Step flow:
 *   1. SERVER_URL — first-launch prompt for the API server URL
 *   2. AUTH_MODE  — choose PIN or email
 *   3. BUSINESS   — business short code (resolved to a real UUID, then remembered)
 *   4. STAFF      — pick your name from the staff grid
 *   5. PIN_PAD    — enter PIN
 *
 * PIN is the default because a PIN login issues a 12-hour token against the
 * 15 minutes an email login gets — a driver stays signed in for a whole shift
 * instead of being bounced to this screen mid-route. Email remains available
 * for owners and managers, who may have no PIN set.
 */

import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView,
  Platform, ScrollView, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useState, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import { SERVER_URL_KEY, DEFAULT_BASE_URL } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { syncPushToken } from '../../lib/push';
import { Colors } from '../../constants/theme';

const BUSINESS_ID_KEY = 'driver_business_id';
const BUSINESS_NM_KEY = 'driver_business_name';

type Screen = 'SERVER_URL' | 'AUTH_MODE' | 'BUSINESS' | 'STAFF' | 'PIN_PAD' | 'EMAIL';

interface StaffMember { id: string; name: string; role: string; }
interface LoginResponse {
  accessToken?: string;
  access_token?: string;
  user: { id: string; name: string; email: string; role: string; businessId: string; storeId?: string; };
}

/** Roles that have any business being in the Driver app. Owners and managers are
 *  kept so someone can check a route without a driver account. */
const DRIVER_ROLES = ['DRIVER', 'OWNER', 'MANAGER'];

const ROLE_COLORS: Record<string, string> = {
  DRIVER: Colors.primary,
  OWNER: Colors.info,
  MANAGER: Colors.warning,
};

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'DEL'] as const;

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
  const router  = useRouter();
  const setAuth = useAuthStore(s => s.setAuth);

  const [screen,     setScreen]     = useState<Screen>('SERVER_URL');
  const [serverUrl,  setServerUrl]  = useState(DEFAULT_BASE_URL);
  const [urlInput,   setUrlInput]   = useState(DEFAULT_BASE_URL);
  const [urlTesting, setUrlTesting] = useState(false);
  const [urlError,   setUrlError]   = useState('');

  const [businessCode, setBusinessCode] = useState('');
  const [businessId,   setBusinessId]   = useState('');
  const [businessName, setBusinessName] = useState('');
  const [bizLoading,   setBizLoading]   = useState(false);
  const [bizError,     setBizError]     = useState('');

  const [staff,        setStaff]        = useState<StaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [showAllStaff, setShowAllStaff] = useState(false);
  const [selectedUser, setSelectedUser] = useState<StaffMember | null>(null);

  const [pin,        setPin]        = useState('');
  const [pinLoading, setPinLoading] = useState(false);

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);

  const loadStaff = useCallback(async (bizId: string, url?: string) => {
    const base = url ?? serverUrl;
    setStaffLoading(true);
    setStaff([]);
    try {
      const res = await fetch(`${base}/business/${bizId}/staff`);
      if (!res.ok) throw new Error('Staff not found');
      setStaff((await res.json()) as StaffMember[]);
    } catch {
      setScreen('BUSINESS');
      setBizError('Could not load staff. Check your business code.');
      await SecureStore.deleteItemAsync(BUSINESS_ID_KEY);
      await SecureStore.deleteItemAsync(BUSINESS_NM_KEY);
    } finally {
      setStaffLoading(false);
    }
  }, [serverUrl]);

  // Restore the stored server URL and business so a returning driver lands on the
  // staff grid — two taps from working.
  useEffect(() => {
    void (async () => {
      const stored = await SecureStore.getItemAsync(SERVER_URL_KEY);
      if (!stored) { setScreen('SERVER_URL'); return; }
      setServerUrl(stored);
      setUrlInput(stored);
      const savedBizId   = await SecureStore.getItemAsync(BUSINESS_ID_KEY);
      const savedBizName = await SecureStore.getItemAsync(BUSINESS_NM_KEY);
      if (savedBizId) {
        setBusinessId(savedBizId);
        setBusinessName(savedBizName ?? '');
        setScreen('STAFF');
        await loadStaff(savedBizId, stored);
      } else {
        setScreen('AUTH_MODE');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSaveUrl() {
    const url = urlInput.trim().replace(/\/$/, '');
    if (!url) { setUrlError('Please enter the server URL.'); return; }
    setUrlTesting(true);
    setUrlError('');
    try {
      const res = await fetch(`${url}/health`).catch(() => null);
      if (!res || res.status >= 500) throw new Error('Cannot reach server.');
    } catch (e) {
      setUrlError(friendlyError(e, 'Could not verify server — check URL.'));
    } finally { setUrlTesting(false); }
    await SecureStore.setItemAsync(SERVER_URL_KEY, url);
    setServerUrl(url);
    setScreen('AUTH_MODE');
  }

  async function handleBusinessCode() {
    const code = businessCode.trim().toUpperCase();
    if (!code) { setBizError('Enter your business code.'); return; }
    setBizLoading(true);
    setBizError('');
    try {
      const res = await fetch(`${serverUrl}/business/resolve/${encodeURIComponent(code)}`);
      if (!res.ok) throw new Error('Business code not found. Ask your manager for the code.');
      const biz = await res.json() as { id: string; name: string };
      setBusinessId(biz.id);
      setBusinessName(biz.name);
      await Promise.all([
        SecureStore.setItemAsync(BUSINESS_ID_KEY, biz.id),
        SecureStore.setItemAsync(BUSINESS_NM_KEY, biz.name),
      ]);
      setScreen('STAFF');
      await loadStaff(biz.id);
    } catch (e) {
      setBizError(friendlyError(e, 'Failed to find business.'));
    } finally {
      setBizLoading(false);
    }
  }

  function selectStaff(member: StaffMember) {
    setSelectedUser(member);
    setPin('');
    setScreen('PIN_PAD');
  }

  /** `userId` scopes the PIN check to this one account, so two staff sharing a PIN
   *  can never sign in as each other. */
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
    } catch (e) {
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

  async function handleEmailLogin() {
    if (!email.trim() || !password) {
      Alert.alert('Required', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${serverUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const data = await res.json() as LoginResponse;
      if (!res.ok) throw new Error((data as any).message ?? 'Invalid credentials');
      await finishLogin(data);
    } catch (e) {
      Alert.alert('Login Failed', friendlyError(e, 'Invalid email or password.'));
    } finally { setLoading(false); }
  }

  async function finishLogin(data: LoginResponse) {
    const token = data.accessToken ?? data.access_token ?? '';
    await SecureStore.setItemAsync('driver_token', token);
    setAuth(data.user, token);
    void syncPushToken(data.user.id); // register for delivery push (best-effort)
    router.replace('/(tabs)/deliveries');
  }

  // ── SERVER URL ────────────────────────────────────────────────────────────
  if (screen === 'SERVER_URL') {
    return (
      <SafeAreaView edges={['top']} style={s.safe}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
            <View style={s.logoArea}>
              <View style={s.logoCircle}><Ionicons name="server" size={36} color="#FFF" /></View>
              <Text style={s.appName}>Faida Driver</Text>
              <Text style={s.appTagline}>Server Setup</Text>
            </View>
            <View style={s.card}>
              <Text style={s.cardTitle}>API Server URL</Text>
              <Text style={s.cardSub}>Enter the Faida API server URL.{'\n'}Cloud users: leave as default.</Text>
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
                autoFocus
              />
              <Text style={s.hintText}>Default (cloud): https://faida-api.onrender.com/api/v1{'\n'}LAN server: http://192.168.x.x:3010/api/v1 (same Wi-Fi)</Text>
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

  // ── AUTH MODE ─────────────────────────────────────────────────────────────
  if (screen === 'AUTH_MODE') {
    return (
      <SafeAreaView edges={['top']} style={s.safe}>
        <ScrollView contentContainerStyle={s.container}>
          <View style={s.logoArea}>
            <View style={s.logoCircle}><Ionicons name="bicycle" size={40} color="#FFF" /></View>
            <Text style={s.appName}>Faida Driver</Text>
            <Text style={s.appTagline}>How would you like to sign in?</Text>
          </View>
          <View style={s.modeCard}>
            <TouchableOpacity style={s.modeBtn} onPress={() => setScreen('BUSINESS')}>
              <View style={s.modeIcon}><Ionicons name="keypad" size={26} color={Colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.modeBtnTitle}>Staff PIN Login</Text>
                <Text style={s.modeBtnSub}>Stay signed in for your whole shift</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
            <View style={s.modeDivider} />
            <TouchableOpacity style={s.modeBtn} onPress={() => setScreen('EMAIL')}>
              <View style={[s.modeIcon, { backgroundColor: Colors.info + '20' }]}><Ionicons name="mail" size={26} color={Colors.info} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.modeBtnTitle}>Email & Password</Text>
                <Text style={s.modeBtnSub}>For owner and manager accounts</Text>
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

  // ── BUSINESS CODE ─────────────────────────────────────────────────────────
  if (screen === 'BUSINESS') {
    return (
      <SafeAreaView edges={['top']} style={s.safe}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
            <TouchableOpacity style={s.backRow} onPress={() => setScreen('AUTH_MODE')}>
              <Ionicons name="arrow-back" size={20} color={Colors.text} />
              <Text style={s.backText}>Back</Text>
            </TouchableOpacity>
            <View style={s.logoArea}>
              <View style={[s.logoCircle, { backgroundColor: Colors.info }]}><Ionicons name="business" size={30} color="#FFF" /></View>
              <Text style={s.appName}>Business Code</Text>
              <Text style={s.appTagline}>Ask your manager — Settings → General</Text>
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

  // ── STAFF GRID ────────────────────────────────────────────────────────────
  if (screen === 'STAFF') {
    const relevant = staff.filter(m => DRIVER_ROLES.includes(m.role));
    const visible  = showAllStaff || relevant.length === 0 ? staff : relevant;

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

        {staffLoading ? (
          <View style={s.centered}><ActivityIndicator size="large" color={Colors.primary} /></View>
        ) : visible.length === 0 ? (
          <View style={s.centered}>
            <Text style={s.emptyText}>No staff with a PIN found.</Text>
            <Text style={s.emptySubText}>Ask the owner to set your PIN in Settings → Users.</Text>
            <TouchableOpacity style={[s.btn, { marginTop: 16, paddingHorizontal: 24 }]} onPress={() => setScreen('EMAIL')}>
              <Ionicons name="mail" size={18} color="#FFF" />
              <Text style={s.btnText}>Sign In with Email</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={visible}
            keyExtractor={item => item.id}
            numColumns={3}
            contentContainerStyle={{ padding: 16 }}
            ListFooterComponent={
              !showAllStaff && relevant.length > 0 && staff.length > relevant.length ? (
                <TouchableOpacity style={s.showAllRow} onPress={() => setShowAllStaff(true)}>
                  <Text style={s.showAllText}>Show all staff</Text>
                </TouchableOpacity>
              ) : null
            }
            renderItem={({ item }) => (
              <TouchableOpacity style={s.staffCard} onPress={() => selectStaff(item)}>
                <View style={[s.staffAvatar, { backgroundColor: (ROLE_COLORS[item.role] ?? Colors.primary) + '20' }]}>
                  <Text style={[s.staffInitials, { color: ROLE_COLORS[item.role] ?? Colors.primary }]}>{initials(item.name)}</Text>
                </View>
                <Text style={s.staffName} numberOfLines={1}>{item.name.split(' ')[0]}</Text>
                <Text style={s.staffRole}>{item.role.toLowerCase().replace('_', ' ')}</Text>
              </TouchableOpacity>
            )}
          />
        )}
      </SafeAreaView>
    );
  }

  // ── PIN PAD ───────────────────────────────────────────────────────────────
  if (screen === 'PIN_PAD' && selectedUser) {
    return (
      <SafeAreaView edges={['top']} style={s.safe}>
        <ScrollView contentContainerStyle={[s.container, { paddingVertical: 32 }]}>
          <TouchableOpacity style={s.backRow} onPress={() => { setPin(''); setScreen('STAFF'); }}>
            <Ionicons name="arrow-back" size={20} color={Colors.text} />
            <Text style={s.backText}>Back</Text>
          </TouchableOpacity>
          <View style={s.pinWho}>
            <View style={[s.staffAvatar, s.staffAvatarLg, { backgroundColor: (ROLE_COLORS[selectedUser.role] ?? Colors.primary) + '20' }]}>
              <Text style={[s.staffInitials, s.staffInitialsLg, { color: ROLE_COLORS[selectedUser.role] ?? Colors.primary }]}>
                {initials(selectedUser.name)}
              </Text>
            </View>
            <Text style={s.pinWhoText}>{selectedUser.name}</Text>
            <Text style={s.pinRoleText}>{selectedUser.role.toLowerCase().replace('_', ' ')}</Text>
          </View>

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

  // ── EMAIL LOGIN ───────────────────────────────────────────────────────────
  return (
    <SafeAreaView edges={['top']} style={s.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={s.backRow} onPress={() => setScreen(businessId ? 'STAFF' : 'AUTH_MODE')}>
            <Ionicons name="arrow-back" size={20} color={Colors.text} />
            <Text style={s.backText}>Back</Text>
          </TouchableOpacity>
          <View style={s.logoArea}>
            <View style={s.logoCircle}><Ionicons name="bicycle" size={40} color="#FFF" /></View>
            <Text style={s.appName}>Faida Driver</Text>
            <Text style={s.appTagline}>Delivery Management</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardTitle}>Driver Login</Text>
            <Text style={s.cardSub}>Sign in with your driver account credentials</Text>
            <View style={s.fieldGroup}>
              <Text style={s.label}>Email Address</Text>
              <View style={s.inputWrapper}>
                <Ionicons name="mail-outline" size={18} color={Colors.textSecondary} style={{ marginRight: 8 }} />
                <TextInput
                  style={s.inputFlex}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="driver@company.com"
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
            <TouchableOpacity style={[s.btn, loading && { opacity: 0.7 }]} onPress={handleEmailLogin} disabled={loading}>
              {loading
                ? <ActivityIndicator color="#FFF" />
                : <><Ionicons name="log-in-outline" size={20} color="#FFF" /><Text style={s.btnText}>Sign In</Text></>
              }
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={s.changeServerLink} onPress={() => setScreen('SERVER_URL')}>
            <Ionicons name="settings-outline" size={14} color={Colors.textSecondary} />
            <Text style={s.changeServerText}>Change server URL</Text>
          </TouchableOpacity>
          <Text style={s.footer}>Contact your manager if you need access</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  container: { flexGrow: 1, padding: 24, justifyContent: 'center', gap: 20 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  logoArea: { alignItems: 'center', gap: 8 },
  logoCircle: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  appName: { fontSize: 26, fontWeight: '800', color: Colors.text },
  appTagline: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' },
  card: {
    backgroundColor: Colors.card, borderRadius: 20, padding: 24, gap: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 6, elevation: 3,
  },
  cardTitle: { fontSize: 20, fontWeight: '700', color: Colors.text },
  cardSub: { fontSize: 13, color: Colors.textSecondary },
  errorText: { fontSize: 13, color: Colors.error },
  hintText: { fontSize: 12, color: Colors.textSecondary },
  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 12,
    backgroundColor: Colors.background, paddingHorizontal: 14,
    paddingVertical: 13, fontSize: 15, color: Colors.text,
  },
  codeInput: { fontSize: 22, fontWeight: '700', letterSpacing: 3, textAlign: 'center' },
  fieldGroup: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.text },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1,
    borderColor: Colors.border, borderRadius: 12,
    backgroundColor: Colors.background, paddingHorizontal: 12,
  },
  inputFlex: { flex: 1, paddingVertical: 13, fontSize: 15, color: Colors.text },
  btn: {
    backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 4,
  },
  btnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backText: { fontSize: 15, color: Colors.text },

  // Auth-mode picker
  modeCard: {
    backgroundColor: Colors.card, borderRadius: 20, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 6, elevation: 3,
  },
  modeBtn: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18 },
  modeIcon: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.primary + '20',
    justifyContent: 'center', alignItems: 'center',
  },
  modeBtnTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  modeBtnSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  modeDivider: { height: 1, backgroundColor: Colors.border },

  // Staff grid
  staffHeader: {
    flexDirection: 'row', alignItems: 'center', padding: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.card,
  },
  staffHeaderTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  staffHeaderSub: { fontSize: 13, color: Colors.textSecondary },
  emailLoginBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  emailLoginBtnText: { fontSize: 12, fontWeight: '600', color: Colors.primary },
  staffCard: { flex: 1 / 3, alignItems: 'center', padding: 8, gap: 6 },
  staffAvatar: { width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center' },
  staffAvatarLg: { width: 88, height: 88, borderRadius: 44 },
  staffInitials: { fontSize: 22, fontWeight: '800' },
  staffInitialsLg: { fontSize: 30 },
  staffName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  staffRole: { fontSize: 11, color: Colors.textSecondary, textTransform: 'capitalize' },
  showAllRow: { alignItems: 'center', paddingVertical: 16 },
  showAllText: { fontSize: 13, color: Colors.primary, fontWeight: '600' },
  emptyText: { fontSize: 16, fontWeight: '600', color: Colors.text },
  emptySubText: { fontSize: 13, color: Colors.textSecondary, marginTop: 4, textAlign: 'center' },

  // PIN pad
  pinWho: { alignItems: 'center', gap: 6 },
  pinWhoText: { fontSize: 20, fontWeight: '700', color: Colors.text },
  pinRoleText: { fontSize: 13, color: Colors.textSecondary, textTransform: 'capitalize' },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 12 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: Colors.border },
  dotFilled: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dotActive: { borderColor: Colors.primary },
  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  loadingText: { fontSize: 13, color: Colors.textSecondary },
  padGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 14 },
  padKey: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: Colors.card,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  padKeyDel: { backgroundColor: Colors.background },
  padKeyText: { fontSize: 28, fontWeight: '600', color: Colors.text },

  changeServerLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  changeServerText: { fontSize: 13, color: Colors.textSecondary },
  footer: { textAlign: 'center', fontSize: 13, color: Colors.textSecondary },
});
