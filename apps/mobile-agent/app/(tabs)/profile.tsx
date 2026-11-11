/**
 * Profile — agent identity, this-month performance, server URL, logout.
 */
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { useState, useEffect } from 'react';
import { agentApi, formatKES, SERVER_URL_KEY } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { buildLabel } from '../../lib/buildInfo';
import UpdateCheck from '../../components/UpdateCheck';
import { Colors } from '../../constants/theme';

interface AgentStats {
  ordersThisMonth: number;
  valueThisMonthCents: number;
  commissionEarnedCents: number;
  commissionTargetCents: number;
}

export default function ProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const businessId = user?.businessId ?? '';
  const agentId = user?.id ?? '';
  const now = new Date();
  const [serverUrl, setServerUrl] = useState('');

  useEffect(() => {
    void SecureStore.getItemAsync(SERVER_URL_KEY).then((u) => setServerUrl(u ?? 'default cloud'));
  }, []);

  const { data } = useQuery<AgentStats>({
    queryKey: ['agent-stats-profile', agentId, businessId],
    queryFn: () => agentApi.get<AgentStats>(`/field-sales/agent-stats?agentId=${agentId}&businessId=${businessId}&month=${now.getMonth() + 1}&year=${now.getFullYear()}`),
    enabled: !!agentId && !!businessId,
  });

  function logout() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => { clearAuth(); router.replace('/(auth)/login'); } },
    ]);
  }

  function changeServer() {
    Alert.alert('Change Server', 'This signs you out so you can enter a new server URL. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Continue', onPress: async () => { await SecureStore.deleteItemAsync(SERVER_URL_KEY); clearAuth(); router.replace('/(auth)/login'); } },
    ]);
  }

  return (
    <View style={st.safe}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View style={st.profileCard}>
          <View style={st.avatar}><Text style={st.avatarText}>{user?.name?.charAt(0).toUpperCase() ?? 'A'}</Text></View>
          <Text style={st.name}>{user?.name ?? 'Agent'}</Text>
          <Text style={st.email}>{user?.email ?? ''}</Text>
          <View style={st.roleTag}><Text style={st.roleText}>Sales Agent</Text></View>
        </View>

        <Text style={st.sectionTitle}>This Month</Text>
        <View style={st.statGrid}>
          <View style={st.statBox}>
            <Text style={st.statValue}>{data?.ordersThisMonth ?? '—'}</Text>
            <Text style={st.statLabel}>Orders</Text>
          </View>
          <View style={st.statBox}>
            <Text style={st.statValue}>{data ? formatKES(data.valueThisMonthCents).replace('KES ', '') : '—'}</Text>
            <Text style={st.statLabel}>Sales (KES)</Text>
          </View>
          <View style={st.statBox}>
            <Text style={st.statValue}>{data ? formatKES(data.commissionEarnedCents).replace('KES ', '') : '—'}</Text>
            <Text style={st.statLabel}>Commission</Text>
          </View>
        </View>

        <Text style={st.sectionTitle}>Settings</Text>
        <View style={st.menu}>
          <TouchableOpacity style={st.menuRow} onPress={changeServer}>
            <Ionicons name="server-outline" size={20} color={Colors.text} />
            <View style={{ flex: 1 }}>
              <Text style={st.menuLabel}>Server</Text>
              <Text style={st.menuValue} numberOfLines={1}>{serverUrl}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={st.logoutBtn} onPress={logout}>
          <Ionicons name="log-out-outline" size={20} color={Colors.error} />
          <Text style={st.logoutText}>Sign Out</Text>
        </TouchableOpacity>

        <Text style={st.version}>Faida Agent v{buildLabel()}</Text>
        <UpdateCheck />
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  profileCard: { alignItems: 'center', backgroundColor: Colors.card, borderRadius: 16, padding: 24, marginBottom: 16 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  avatarText: { fontSize: 30, fontWeight: '800', color: '#FFF' },
  name: { fontSize: 20, fontWeight: '800', color: Colors.text },
  email: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  roleTag: { marginTop: 10, backgroundColor: Colors.background, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, borderWidth: 1, borderColor: Colors.border },
  roleText: { fontSize: 12, fontWeight: '700', color: Colors.primary },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  statGrid: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statBox: { flex: 1, backgroundColor: Colors.card, borderRadius: 12, padding: 14, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '800', color: Colors.text },
  statLabel: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  menu: { backgroundColor: Colors.card, borderRadius: 12, marginBottom: 16, overflow: 'hidden' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  menuLabel: { fontSize: 15, fontWeight: '600', color: Colors.text },
  menuValue: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.card, borderRadius: 12, paddingVertical: 15, borderWidth: 1, borderColor: Colors.error + '40' },
  logoutText: { fontSize: 15, fontWeight: '700', color: Colors.error },
  version: { textAlign: 'center', fontSize: 12, color: Colors.textSecondary, marginTop: 20 },
});
