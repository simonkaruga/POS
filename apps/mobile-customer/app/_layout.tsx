import { Stack, useRouter } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePushNotifications } from '@pos/mobile-push';
import { routeForTap } from '../lib/push';
import { StatusBar, setStatusBarStyle } from 'expo-status-bar';
import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView,
  Platform, ScrollView, Alert,
} from 'react-native';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { SERVER_URL_KEY, DEFAULT_BASE_URL } from '../lib/api';
import { useSessionStore } from '../stores/session';
import LoginGate from '../components/LoginGate';

const queryClient = new QueryClient();

type SetupScreen = 'LOADING' | 'SERVER_URL' | 'BUSINESS_CODE' | 'DONE';

const PRIMARY = '#6366F1';
const BG      = '#F8FAFC';
const CARD    = '#FFFFFF';
const TEXT    = '#1E293B';
const SUBTLE  = '#64748B';
const BORDER  = '#E2E8F0';
const ERROR   = '#EF4444';

/** First-launch setup wizard for the customer app.
 *  1. Server URL — which Faida API to connect to
 *  2. Business Code — which business / restaurant's menu to show
 *  After that, the normal tab layout takes over. */
function SetupWizard({ onDone }: { onDone: () => void }) {
  const [screen,     setScreen]     = useState<SetupScreen>('LOADING');
  const [urlInput,   setUrlInput]   = useState(DEFAULT_BASE_URL);
  const [urlTesting, setUrlTesting] = useState(false);
  const [urlError,   setUrlError]   = useState('');
  const [serverUrl,  setServerUrl]  = useState(DEFAULT_BASE_URL);

  const [bizCode,    setBizCode]    = useState('');
  const [bizLoading, setBizLoading] = useState(false);
  const [bizError,   setBizError]   = useState('');

  const setBusinessId   = useSessionStore(s => s.setBusinessId);
  const setBusinessName = useSessionStore(s => s.setBusinessName);
  const persist         = useSessionStore(s => s.persist);

  useEffect(() => {
    void (async () => {
      const storedUrl = await AsyncStorage.getItem(SERVER_URL_KEY).catch(() => null);
      const storedBiz = await AsyncStorage.getItem('customer_biz_id').catch(() => null);
      const storedBizName = await AsyncStorage.getItem('customer_biz_name').catch(() => null);

      if (storedUrl && storedBiz) {
        // Already configured — restore and proceed
        setServerUrl(storedUrl);
        setUrlInput(storedUrl);
        setBusinessId(storedBiz);
        setBusinessName(storedBizName ?? '');
        await persist();
        onDone();
        return;
      }

      if (storedUrl) {
        setServerUrl(storedUrl);
        setUrlInput(storedUrl);
        setScreen('BUSINESS_CODE');
      } else {
        setScreen('SERVER_URL');
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
    } catch (e: any) {
      setUrlError(e.message ?? 'Could not verify server.');
    } finally {
      setUrlTesting(false);
    }
    await AsyncStorage.setItem(SERVER_URL_KEY, url);
    setServerUrl(url);
    setScreen('BUSINESS_CODE');
  }

  async function handleBusinessCode() {
    const code = bizCode.trim().toUpperCase();
    if (!code) { setBizError('Enter your business code.'); return; }
    setBizLoading(true);
    setBizError('');
    try {
      const res = await fetch(`${serverUrl}/business/resolve/${encodeURIComponent(code)}`);
      if (!res.ok) throw new Error('Business code not found. Contact the business owner for the code.');
      const biz = await res.json() as { id: string; name: string };
      setBusinessId(biz.id);
      setBusinessName(biz.name);
      await Promise.all([
        AsyncStorage.setItem('customer_biz_id', biz.id),
        AsyncStorage.setItem('customer_biz_name', biz.name),
        persist(),
      ]);
      onDone();
    } catch (e: any) {
      const msg = (e?.message ?? '').includes('Network request failed')
        ? 'Could not reach the server. Make sure this phone is on the same Wi-Fi network as the server and the URL uses its LAN IP.'
        : (e.message ?? 'Failed to find business.');
      setBizError(msg);
    } finally {
      setBizLoading(false);
    }
  }

  if (screen === 'LOADING') {
    return (
      <View style={[ss.safe, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  if (screen === 'SERVER_URL') {
    return (
      <SafeAreaView edges={['top']} style={ss.safe}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={ss.centered} keyboardShouldPersistTaps="handled">
            <View style={ss.logoWrap}>
              <View style={ss.logoCircle}><Ionicons name="server" size={34} color="#FFF" /></View>
              <Text style={ss.appName}>Faida Order</Text>
              <Text style={ss.appSub}>Server Setup</Text>
            </View>
            <View style={ss.card}>
              <Text style={ss.cardTitle}>API Server URL</Text>
              <Text style={ss.cardSub}>Enter the Faida API URL for your business.{'\n'}Cloud users: leave as default.</Text>
              {urlError ? <Text style={ss.error}>{urlError}</Text> : null}
              <TextInput
                style={ss.input}
                value={urlInput}
                onChangeText={v => { setUrlInput(v); setUrlError(''); }}
                placeholder="https://faida-api.onrender.com/api/v1"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholderTextColor={SUBTLE}
                autoFocus
              />
              <Text style={ss.hint}>Default (cloud): https://faida-api.onrender.com/api/v1{'\n'}LAN server: http://192.168.x.x:3010/api/v1 (same Wi-Fi)</Text>
              <TouchableOpacity style={[ss.btn, urlTesting && { opacity: 0.7 }]} onPress={handleSaveUrl} disabled={urlTesting}>
                {urlTesting
                  ? <ActivityIndicator color="#FFF" />
                  : <><Ionicons name="arrow-forward-circle" size={20} color="#FFF" /><Text style={ss.btnText}>Save & Continue</Text></>
                }
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // BUSINESS_CODE
  return (
    <SafeAreaView edges={['top']} style={ss.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={ss.centered} keyboardShouldPersistTaps="handled">
          <View style={ss.logoWrap}>
            <View style={ss.logoCircle}><Ionicons name="storefront" size={34} color="#FFF" /></View>
            <Text style={ss.appName}>Faida Order</Text>
            <Text style={ss.appSub}>Enter your business code</Text>
          </View>
          <View style={ss.card}>
            <Text style={ss.cardTitle}>Business Code</Text>
            <Text style={ss.cardSub}>Ask the business owner for the short code.{'\n'}Found in Settings → General in the POS.</Text>
            {bizError ? <Text style={ss.error}>{bizError}</Text> : null}
            <TextInput
              style={[ss.input, ss.codeInput]}
              value={bizCode}
              onChangeText={v => { setBizCode(v.toUpperCase()); setBizError(''); }}
              placeholder="e.g. PREMIE01"
              autoCapitalize="characters"
              autoCorrect={false}
              placeholderTextColor={SUBTLE}
              returnKeyType="go"
              onSubmitEditing={handleBusinessCode}
              autoFocus
            />
            <TouchableOpacity style={[ss.btn, bizLoading && { opacity: 0.7 }]} onPress={handleBusinessCode} disabled={bizLoading}>
              {bizLoading
                ? <ActivityIndicator color="#FFF" />
                : <><Ionicons name="storefront" size={20} color="#FFF" /><Text style={ss.btnText}>Connect to Business</Text></>
              }
            </TouchableOpacity>
            <TouchableOpacity style={ss.changeLink} onPress={() => setScreen('SERVER_URL')}>
              <Ionicons name="settings-outline" size={13} color={SUBTLE} />
              <Text style={ss.changeLinkText}>Change server URL</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const ss = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: BG },
  centered:   { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 20 },
  logoWrap:   { alignItems: 'center', gap: 8 },
  logoCircle: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: PRIMARY,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: PRIMARY, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  appName:    { fontSize: 24, fontWeight: '800', color: TEXT },
  appSub:     { fontSize: 13, color: SUBTLE, textAlign: 'center' },
  card:       {
    width: '100%', backgroundColor: CARD, borderRadius: 16, padding: 20, gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 6, elevation: 2,
  },
  cardTitle:  { fontSize: 18, fontWeight: '700', color: TEXT },
  cardSub:    { fontSize: 13, color: SUBTLE, lineHeight: 19 },
  error:      { fontSize: 13, color: ERROR },
  hint:       { fontSize: 12, color: SUBTLE },
  input: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 12,
    backgroundColor: BG, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: TEXT,
  },
  codeInput:  { textAlign: 'center', fontFamily: 'monospace', letterSpacing: 4, fontSize: 22, fontWeight: '700' },
  btn: {
    backgroundColor: PRIMARY, borderRadius: 12, paddingVertical: 14,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
  },
  btnText:    { color: '#FFF', fontSize: 16, fontWeight: '700' },
  changeLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  changeLinkText: { fontSize: 12, color: SUBTLE },
});

/** Routes the customer to the relevant screen when they tap a push notification. */
function PushHandler() {
  const router = useRouter();
  usePushNotifications({
    onTap: (data) => {
      const route = routeForTap(data);
      if (route) router.push(route as never);
    },
  });
  return null;
}

function Gate() {
  const [setupDone, setSetupDone] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const token = useSessionStore((s) => s.token);
  const restore = useSessionStore((s) => s.restore);

  // Load any persisted session token before deciding login vs. ready.
  useEffect(() => {
    restore().finally(() => setAuthChecked(true));
  }, [restore]);

  if (!setupDone) return <SetupWizard onDone={() => setSetupDone(true)} />;
  if (!authChecked) {
    return (
      <View style={[ss.safe, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }
  if (!token) return <LoginGate onDone={() => { /* token now in store → re-render to tabs */ }} />;

  return (
    <>
      <PushHandler />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}

/**
 * Re-assert the status bar icon colour after the first frame.
 *
 * `<StatusBar style="dark" />` alone is not enough on Android here: it applies during
 * the very first render, while the splash screen is still being torn down and the RN
 * root view attached, and that teardown resets the window's light-status-bar flag —
 * leaving white icons on this app's light background. The driver app escapes this only
 * by accident: it returns null until its fonts load, so its StatusBar mounts after the
 * teardown has finished.
 */
function useStickyStatusBar(style: 'dark' | 'light' = 'dark') {
  useEffect(() => {
    const apply = () => setStatusBarStyle(style);
    apply();
    const timers = [setTimeout(apply, 100), setTimeout(apply, 600)];
    return () => timers.forEach(clearTimeout);
  }, [style]);
}

export default function RootLayout() {
  useStickyStatusBar();

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        {/* dark icons — the app uses light backgrounds, keeps battery/clock legible */}
        <StatusBar style="dark" />
        <Gate />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
