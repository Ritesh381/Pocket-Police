import { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, FlatList, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme, radius } from '../lib/theme';
import { CURRENCIES, currencyLabel } from '../lib/currencies';

// Labeled currency selector. `value` is a 3-letter code; `onChange(code)`.
export default function CurrencyField({ label, value, onChange }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const [open, setOpen] = useState(false);

  return (
    <View style={{ marginBottom: 14 }}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <TouchableOpacity style={s.select} onPress={() => setOpen(true)} activeOpacity={0.7}>
        <Text style={s.selectText}>{currencyLabel(value)}</Text>
        <MaterialIcons name="arrow-drop-down" size={22} color={colors.muted} />
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={s.modalWrap}>
          <View style={s.sheet}>
            <View style={s.sheetHeader}>
              <Text style={s.sheetTitle}>Select currency</Text>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={8}>
                <MaterialIcons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={CURRENCIES}
              keyExtractor={(c) => c.code}
              renderItem={({ item }) => {
                const active = item.code === value;
                return (
                  <TouchableOpacity
                    style={s.row}
                    onPress={() => { onChange(item.code); setOpen(false); }}
                    activeOpacity={0.6}
                  >
                    <Text style={s.sym}>{item.symbol}</Text>
                    <Text style={s.name}>{item.name}</Text>
                    <Text style={s.code}>{item.code}</Text>
                    {active ? <MaterialIcons name="check" size={20} color={colors.primary} /> : null}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    label: { fontSize: 13, color: colors.muted, marginBottom: 6, fontWeight: '600' },
    select: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
      paddingHorizontal: 14, paddingVertical: 13,
    },
    selectText: { fontSize: 16, color: colors.text, fontWeight: '600' },
    modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
    sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%', paddingBottom: 20 },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
    sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
    sym: { fontSize: 18, width: 30, color: colors.text },
    name: { flex: 1, fontSize: 15, color: colors.text },
    code: { fontSize: 14, color: colors.muted, fontWeight: '600' },
  });
