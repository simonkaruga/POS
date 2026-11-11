import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '../../lib/api';
import { useSessionStore } from '../../stores/session';
import { Colors } from '../../constants/theme';
import { buildLabel } from '../../lib/buildInfo';
import UpdateCheck from '../../components/UpdateCheck';

interface Profile {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  loyaltyPoints: number;
}

export default function ProfileScreen() {
  const businessName = useSessionStore((s) => s.businessName);
  const logout = useSessionStore((s) => s.logout);
  const setCustomerName = useSessionStore((s) => s.setCustomerName);

  const { data, isLoading, refetch } = useQuery<Profile>({
    queryKey: ['my-profile'],
    queryFn: () => apiGet<Profile>('/portal/me'),
  });

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) { setName(data.name ?? ''); setEmail(data.email ?? ''); }
  }, [data]);

  async function save() {
    if (!name.trim()) { Alert.alert('Required', 'Please enter your name.'); return; }
    setSaving(true);
    try {
      await apiPatch('/portal/me', { name: name.trim(), email: email.trim() });
      setCustomerName(name.trim());
      await refetch();
      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  function confirmLogout() {
    Alert.alert('Log out', 'Sign out of your account on this device?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => { void logout(); } },
    ]);
  }

  function confirmDelete() {
    Alert.alert(
      'Delete my data',
      'This sends a data-deletion request to the business (KDPA). Your personal details will be removed once approved. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Request deletion',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiPost('/portal/me/delete', {});
              Alert.alert('Request sent', 'Your deletion request has been submitted.', [
                { text: 'OK', onPress: () => { void logout(); } },
              ]);
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Could not submit request.');
            }
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView edges={['top']} style={s.safe}>
      <View style={s.header}><Text style={s.headerTitle}>Account</Text></View>

      {isLoading ? (
        <View style={s.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={s.content}>
          {/* Identity card */}
          <View style={s.idCard}>
            <View style={s.avatar}><Ionicons name="person" size={30} color="#FFF" /></View>
            <Text style={s.idName}>{data?.name}</Text>
            {data?.phone ? <Text style={s.idPhone}>+{data.phone}</Text> : null}
            <View style={s.loyaltyPill}>
              <Ionicons name="star" size={14} color="#B45309" />
              <Text style={s.loyaltyText}>{data?.loyaltyPoints ?? 0} points</Text>
            </View>
            <Text style={s.bizText}>{businessName}</Text>
          </View>

          {/* Edit */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Profile</Text>
            <Text style={s.label}>Name</Text>
            <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={Colors.textSecondary} />
            <Text style={s.label}>Email (optional)</Text>
            <TextInput style={s.input} value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" placeholderTextColor={Colors.textSecondary} />
            <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.7 }]} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="checkmark" size={18} color="#FFF" /><Text style={s.saveText}>Save changes</Text></>}
            </TouchableOpacity>
          </View>

          {/* Actions */}
          <TouchableOpacity style={s.rowBtn} onPress={confirmLogout}>
            <Ionicons name="log-out-outline" size={20} color={Colors.text} />
            <Text style={s.rowText}>Log out</Text>
            <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>

          <TouchableOpacity style={s.rowBtn} onPress={confirmDelete}>
            <Ionicons name="trash-outline" size={20} color={Colors.error} />
            <Text style={[s.rowText, { color: Colors.error }]}>Delete my data (KDPA)</Text>
            <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
          <Text style={s.buildLine}>Faida Order v{buildLabel()}</Text>
          <UpdateCheck />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { backgroundColor: Colors.card, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerTitle: { fontSize: 20, fontWeight: '700', color: Colors.text },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  content: { padding: 16, gap: 14 },
  idCard: { backgroundColor: Colors.card, borderRadius: 16, padding: 20, alignItems: 'center', gap: 6 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  idName: { fontSize: 18, fontWeight: '800', color: Colors.text },
  idPhone: { fontSize: 13, color: Colors.textSecondary },
  loyaltyPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FEF3C7', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, marginTop: 4 },
  loyaltyText: { fontSize: 13, fontWeight: '700', color: '#92400E' },
  bizText: { fontSize: 12, color: Colors.textSecondary, marginTop: 4 },
  buildLine: { textAlign: 'center', fontSize: 11, color: Colors.textSecondary, marginTop: 8, marginBottom: 4 },
  card: { backgroundColor: Colors.card, borderRadius: 16, padding: 16, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  label: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  input: { borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: Colors.text, backgroundColor: Colors.background },
  saveBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 13, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 6 },
  saveText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  rowBtn: { backgroundColor: Colors.card, borderRadius: 12, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.text },
});
