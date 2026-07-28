import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect, Link } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { useTheme, radius } from '../../lib/theme';

export default function DebtsDashboard() {
  const router = Router();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState('balance'); // 'balance' | 'name'
  const [data, setData] = useState(null);
  const [currency, setCurrency] = useState('INR');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [dash, me] = await Promise.all([api.getDashboard(), api.getMe()]);
      setData(dash);
      setCurrency(me.profile?.currency || 'INR');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const allPeople = data?.people || [];
  const q = query.trim().toLowerCase();
  const visiblePeople = allPeople
    .filter((p) => !q || (p.name || '').toLowerCase().includes(q))
    .sort((a, b) => (sortMode === 'name' ? (a.name || '').localeCompare(b.name || '') : b.balance - a.balance));

  return (
    <View style={s.container}>
      <FlatList
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        data={visiblePeople}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
        ListHeaderComponent={
          <View>
            {error ? <Text style={s.error}>{error}</Text> : null}
            <View style={s.summary}>
              <Text style={s.summaryLabel}>Total outstanding</Text>
              <Text style={s.summaryAmount}>{formatMoney(data?.total_outstanding || 0, currency)}</Text>
              <View style={s.summaryRow}>
                <Text style={s.summaryMeta}>{data?.debtor_count || 0} owe you</Text>
                <Text style={s.summaryMeta}>·</Text>
                <Text style={s.summaryMeta}>{data?.people_count || 0} people</Text>
              </View>
              <View style={s.miniStats}>
                <View style={s.statBox}>
                  <Text style={s.statValue}>{formatMoney(data?.month_lent || 0, currency)}</Text>
                  <Text style={s.statLabel}>Lent this month</Text>
                </View>
                <View style={s.statDivider} />
                <View style={s.statBox}>
                  <Text style={s.statValue}>{formatMoney(data?.month_collected || 0, currency)}</Text>
                  <Text style={s.statLabel}>Collected</Text>
                </View>
              </View>
            </View>

            <View style={s.controls}>
              <View style={s.searchBar}>
                <MaterialIcons name="search" size={20} color={colors.muted} style={{ marginRight: 8 }} />
                <TextInput
                  style={s.searchInput}
                  placeholder="Search people..."
                  placeholderTextColor={colors.placeholder}
                  value={query}
                  onChangeText={setQuery}
                />
                {query ? (
                  <TouchableOpacity onPress={() => setQuery('')}>
                    <MaterialIcons name="close" size={18} color={colors.muted} />
                  </TouchableOpacity>
                ) : null}
              </View>

              <TouchableOpacity
                style={s.sortBtn}
                onPress={() => setSortMode((m) => (m === 'balance' ? 'name' : 'balance'))}
              >
                <MaterialIcons name="sort" size={18} color={colors.text} />
                <Text style={s.sortText}>{sortMode === 'balance' ? 'Amount' : 'Name'}</Text>
              </TouchableOpacity>
            </View>

            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>People ({visiblePeople.length})</Text>
              <Link href="/reminders" asChild>
                <TouchableOpacity style={s.remindersLink}>
                  <MaterialIcons name="history" size={16} color={colors.primary} />
                  <Text style={s.remindersLinkText}>Reminder logs</Text>
                </TouchableOpacity>
              </Link>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <MaterialIcons name="people-outline" size={48} color={colors.muted} />
            <Text style={s.emptyTitle}>{query ? 'No people match' : 'No people added yet'}</Text>
            <Text style={s.emptyBody}>
              {query ? 'Try a different search query' : 'Tap the button below to add someone who owes you money'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={s.card}
            activeOpacity={0.7}
            onPress={() => router.push(`/person/${item.id}`)}
          >
            <View style={s.avatar}>
              <Text style={s.avatarText}>{(item.name || '?')[0].toUpperCase()}</Text>
            </View>
            <View style={s.cardBody}>
              <Text style={s.personName} numberOfLines={1}>{item.name}</Text>
              {item.description ? (
                <Text style={s.personDesc} numberOfLines={1}>{item.description}</Text>
              ) : null}
            </View>
            <View style={s.cardRight}>
              <Text style={[s.balanceText, item.balance <= 0 && s.settled]}>
                {item.balance > 0 ? formatMoney(item.balance, currency) : 'Settled'}
              </Text>
              <MaterialIcons name="chevron-right" size={20} color={colors.muted} />
            </View>
          </TouchableOpacity>
        )}
      />

      <TouchableOpacity style={s.fab} activeOpacity={0.85} onPress={() => router.push('/person/new')}>
        <MaterialIcons name="person-add" size={24} color="#fff" />
        <Text style={s.fabText}>Add person</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
    summary: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: 20,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    summaryLabel: { fontSize: 13, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '600' },
    summaryAmount: { fontSize: 34, fontWeight: '800', color: colors.primary, marginVertical: 4 },
    summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    summaryMeta: { fontSize: 13, color: colors.muted },
    miniStats: {
      flexDirection: 'row',
      marginTop: 16,
      paddingTop: 16,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    statBox: { flex: 1 },
    statValue: { fontSize: 15, fontWeight: '700', color: colors.text },
    statLabel: { fontSize: 12, color: colors.muted, marginTop: 2 },
    statDivider: { width: 1, backgroundColor: colors.border, marginHorizontal: 12 },
    controls: { flexDirection: 'row', gap: 8, marginBottom: 16 },
    searchBar: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      height: 44,
      borderWidth: 1,
      borderColor: colors.border,
    },
    searchInput: { flex: 1, color: colors.text, fontSize: 14 },
    sortBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.card,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      height: 44,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sortText: { fontSize: 13, fontWeight: '600', color: colors.text },
    sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
    remindersLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    remindersLinkText: { fontSize: 13, color: colors.primary, fontWeight: '600' },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: radius.md,
      padding: 12,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    avatar: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: colors.primary + '22',
      justify: 'center',
      alignItems: 'center',
      marginRight: 12,
    },
    avatarText: { fontSize: 18, fontWeight: '700', color: colors.primary },
    cardBody: { flex: 1 },
    personName: { fontSize: 15, fontWeight: '700', color: colors.text },
    personDesc: { fontSize: 12, color: colors.muted, marginTop: 2 },
    cardRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    balanceText: { fontSize: 15, fontWeight: '700', color: colors.danger },
    settled: { color: colors.muted, fontWeight: '600' },
    empty: { alignItems: 'center', paddingVertical: 40 },
    emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 12 },
    emptyBody: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 4, paddingHorizontal: 20 },
    fab: {
      position: 'absolute',
      bottom: 24,
      right: 20,
      backgroundColor: colors.primary,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 20,
      paddingVertical: 14,
      borderRadius: radius.full,
      elevation: 5,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.25,
      shadowRadius: 5,
    },
    fabText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    error: { color: colors.danger, marginBottom: 12, fontSize: 13 },
  });
}
