import { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { formatMoney, formatDate } from '../lib/format';
import { useTheme, radius } from '../lib/theme';

const CHANNEL_ICON = { email: 'email', sms: 'sms', whatsapp: 'whatsapp' };

export default function ReminderHistory() {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { logs } = await api.getReminderLogs();
      setLogs(logs || []);
    } catch (e) {
      // leave empty on error
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const statusColor = (st) => (st === 'sent' ? colors.owed : st === 'failed' ? colors.danger : colors.muted);

  if (loading) {
    return <View style={s.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16 }}
      data={logs}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      renderItem={({ item }) => {
        const icon = CHANNEL_ICON[item.channel] || 'notifications';
        const IconLib = item.channel === 'whatsapp' ? MaterialCommunityIcons : MaterialIcons;
        return (
          <View style={s.row}>
            <View style={s.iconWrap}>
              <IconLib name={icon} size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{item.people?.name || 'Unknown'}</Text>
              <Text style={s.meta}>
                {item.channel} · {formatDate(item.sent_at)}
              </Text>
              {item.error ? <Text style={s.err} numberOfLines={1}>{item.error}</Text> : null}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.amount}>{formatMoney(item.amount_owed)}</Text>
              <Text style={[s.status, { color: statusColor(item.status) }]}>{item.status}</Text>
            </View>
          </View>
        );
      }}
      ListEmptyComponent={
        <View style={s.empty}>
          <MaterialIcons name="history" size={52} color={colors.muted} />
          <Text style={s.emptyText}>No reminders sent yet.</Text>
        </View>
      }
    />
  );
}

const makeStyles = (colors) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10,
  },
  iconWrap: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.avatarBg,
    alignItems: 'center', justifyContent: 'center',
  },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2, textTransform: 'capitalize' },
  err: { fontSize: 11, color: colors.danger, marginTop: 2 },
  amount: { fontSize: 15, fontWeight: '700', color: colors.text },
  status: { fontSize: 12, fontWeight: '700', marginTop: 2, textTransform: 'capitalize' },
  empty: { alignItems: 'center', paddingVertical: 80 },
  emptyText: { fontSize: 14, color: colors.muted, marginTop: 12 },
});
