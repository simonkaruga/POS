import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Modal,
  ScrollView,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { mobileApi } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { useActiveStore } from '../lib/useActiveStore';
import { Colors } from '../constants/theme';

interface BizUser {
  id: string;
  name: string;
  email: string | null;
  role: string;
}

/**
 * Roles that can be assigned from the phone.
 *
 * Matches the web Staff & HR list except for OWNER, which is deliberately
 * left out — minting a second full-admin account is a privilege escalation
 * that belongs on the web app, behind a bigger screen and a deliberate visit.
 *
 * DRIVER and SALES_AGENT sign in to the *other* apps rather than this one, so
 * the hint below the picker says which app each role actually gets, and a
 * manager does not sit waiting for a driver to appear on a till.
 */
const ASSIGNABLE_ROLES = [
  'MANAGER', 'CASHIER', 'WAITER', 'ACCOUNTANT', 'KITCHEN', 'DRIVER', 'SALES_AGENT',
];

const ROLE_HINT: Record<string, string> = {
  MANAGER: 'Full access on this app, except billing.',
  CASHIER: 'Sells on this app. Sees only their own sales.',
  WAITER: 'Takes table orders on this app.',
  KITCHEN: 'Kitchen display only — no till access.',
  ACCOUNTANT: 'Reports and expenses. No stock or staff.',
  DRIVER: 'Signs in to the Faida Driver app, not this one.',
  SALES_AGENT: 'Signs in to the Faida Agent app, not this one.',
};

/** Shown on the chip so a long role name still fits on a phone. */
const ROLE_LABEL: Record<string, string> = {
  SALES_AGENT: 'AGENT',
};

const ROLE_COLOR: Record<string, string> = {
  OWNER: Colors.indigo,
  MANAGER: Colors.warning,
  CASHIER: Colors.primary,
  WAITER: Colors.success,
  ACCOUNTANT: '#8B5CF6',
  KITCHEN: '#0EA5E9',
  DRIVER: '#F97316',
  SALES_AGENT: '#0D9488',
};

export default function ManageUsersScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const { businessId } = useActiveStore();

  const [editing, setEditing] = useState<BizUser | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('CASHIER');
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');

  const { data, isLoading, refetch, isRefetching } = useQuery<BizUser[]>({
    queryKey: ['manage-users', businessId],
    queryFn: () => mobileApi.get<BizUser[]>(`/business/${businessId}/users`),
    enabled: !!businessId,
    staleTime: 30_000,
  });

  function openCreate() {
    setEditing(null);
    setName(''); setEmail(''); setRole('CASHIER'); setPin(''); setPassword('');
    setShowForm(true);
  }
  function openEdit(u: BizUser) {
    setEditing(u);
    setName(u.name); setEmail(u.email ?? ''); setRole(u.role); setPin(''); setPassword('');
    setShowForm(true);
  }

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { name: name.trim(), role };
      if (email.trim()) body.email = email.trim();
      if (pin.trim()) body.pin = pin.trim();
      if (password.trim()) body.password = password.trim();
      return editing
        ? mobileApi.patch(`/business/${businessId}/users/${editing.id}`, body)
        : mobileApi.post(`/business/${businessId}/users`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['manage-users'] });
      setShowForm(false);
    },
    onError: (err: any) => Alert.alert('Error', err.message ?? 'Could not save user.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => mobileApi.delete(`/business/${businessId}/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['manage-users'] }),
    onError: (err: any) => Alert.alert('Error', err.message ?? 'Could not delete user.'),
  });

  function handleSave() {
    if (!name.trim()) { Alert.alert('Required', 'Name is required.'); return; }
    if (!editing && !pin.trim() && !password.trim()) {
      Alert.alert('Required', 'Set a PIN or password for the new user.');
      return;
    }
    save.mutate();
  }
  function confirmDelete(u: BizUser) {
    Alert.alert('Delete user', `Remove ${u.name}? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(u.id) },
    ]);
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Back" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Staff</Text>
        <TouchableOpacity onPress={openCreate} style={styles.iconBtn}>
          <Ionicons name="person-add" size={22} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(u) => u.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} colors={[Colors.primary]} />}
          renderItem={({ item: u }) => {
            const isOwner = u.role === 'OWNER';
            const isSelf = u.id === me?.id;
            return (
              <TouchableOpacity style={styles.card} activeOpacity={0.8} onPress={() => !isOwner && openEdit(u)} disabled={isOwner}>
                <View style={[styles.avatar, { backgroundColor: (ROLE_COLOR[u.role] ?? Colors.primary) + '20' }]}>
                  <Text style={[styles.avatarText, { color: ROLE_COLOR[u.role] ?? Colors.primary }]}>{u.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.info}>
                  <Text style={styles.name}>{u.name}{isSelf ? ' (you)' : ''}</Text>
                  {u.email ? <Text style={styles.sub}>{u.email}</Text> : null}
                </View>
                <View style={[styles.roleBadge, { backgroundColor: (ROLE_COLOR[u.role] ?? Colors.primary) + '18' }]}>
                  <Text style={[styles.roleText, { color: ROLE_COLOR[u.role] ?? Colors.primary }]}>{u.role}</Text>
                </View>
                {!isOwner && !isSelf && (
                  <TouchableOpacity onPress={() => confirmDelete(u)} style={{ paddingLeft: 4 }} accessibilityRole="button" accessibilityLabel="Delete" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                    <Ionicons name="trash-outline" size={18} color={Colors.error} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={<View style={styles.center}><Text style={styles.emptyText}>No staff yet</Text></View>}
        />
      )}

      <Modal visible={showForm} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowForm(false)}>
        <SafeAreaView edges={['top']} style={styles.safe}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{editing ? 'Edit Staff' : 'New Staff'}</Text>
            <TouchableOpacity onPress={() => setShowForm(false)} accessibilityRole="button" accessibilityLabel="Close" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}><Ionicons name="close" size={24} color={Colors.text} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
            <Field label="Name *">
              <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor={Colors.textSecondary} />
            </Field>
            <Field label="Email">
              <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="email@example.com" autoCapitalize="none" keyboardType="email-address" placeholderTextColor={Colors.textSecondary} />
            </Field>
            <Text style={styles.label}>Role</Text>
            <View style={styles.roleRow}>
              {ASSIGNABLE_ROLES.map((r) => (
                <TouchableOpacity key={r} style={[styles.roleChip, role === r && styles.roleChipActive]} onPress={() => setRole(r)}>
                  <Text style={[styles.roleChipText, role === r && { color: '#FFFFFF' }]}>{ROLE_LABEL[r] ?? r}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {ROLE_HINT[role] ? <Text style={styles.roleHint}>{ROLE_HINT[role]}</Text> : null}
            <Field label={editing ? 'New PIN (leave blank to keep)' : 'PIN (4 digits)'}>
              <TextInput style={styles.input} value={pin} onChangeText={(v) => setPin(v.replace(/[^0-9]/g, '').slice(0, 6))} keyboardType="numeric" placeholder="0000" placeholderTextColor={Colors.textSecondary} />
            </Field>
            <Field label={editing ? 'New password (leave blank to keep)' : 'Password (optional)'}>
              <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••" placeholderTextColor={Colors.textSecondary} />
            </Field>
            <TouchableOpacity style={[styles.saveBtn, save.isPending && { opacity: 0.7 }]} onPress={handleSave} disabled={save.isPending}>
              {save.isPending ? <ActivityIndicator color="#FFFFFF" /> : (
                <><Ionicons name="checkmark" size={20} color="#FFFFFF" /><Text style={styles.saveBtnText}>{editing ? 'Save Changes' : 'Create Staff'}</Text></>
              )}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.card,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  iconBtn: { padding: 4, minWidth: 34 },
  headerTitle: { fontSize: 17, fontWeight: '800', color: Colors.text },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingTop: 60 },
  emptyText: { color: Colors.textSecondary, fontSize: 14 },
  list: { padding: 12, gap: 10, paddingBottom: 24 },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  avatar: { width: 42, height: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 17, fontWeight: '800' },
  info: { flex: 1 },
  name: { fontSize: 14, fontWeight: '700', color: Colors.text },
  sub: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  roleText: { fontSize: 11, fontWeight: '700' },
  formContent: { padding: 16, gap: 14, paddingBottom: 48 },
  fieldGroup: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.text },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    color: Colors.text,
    backgroundColor: Colors.card,
  },
  roleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  roleChip: { borderWidth: 1, borderColor: Colors.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  roleChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  roleChipText: { fontSize: 12, fontWeight: '600', color: Colors.text },
  roleHint: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17, marginTop: 8 },
  saveBtn: {
    marginTop: 8,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  saveBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
