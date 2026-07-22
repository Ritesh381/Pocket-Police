import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme, radius } from '../lib/theme';
import { COUNTRIES, parseE164, flagFor } from '../lib/countries';

// Phone input with a country-code picker (defaults to +91).
// `value` is the stored E.164 string; `onChange` receives E.164 (or '' when empty).
export default function PhoneField({ label, value, onChange, placeholder, error }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const parsed = parseE164(value);
  const [dial, setDial] = useState(parsed.dial);
  const [num, setNum] = useState(parsed.number);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const emit = (d, n) => {
    const digits = String(n).replace(/[^\d]/g, '');
    onChange(digits ? `${d}${digits}` : '');
  };

  const onPick = (c) => {
    setDial(c.dial);
    setOpen(false);
    setQ('');
    emit(c.dial, num);
  };

  const onNum = (t) => {
    const digits = t.replace(/[^\d]/g, '');
    setNum(digits);
    emit(dial, digits);
  };

  const filtered = q
    ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || c.dial.includes(q))
    : COUNTRIES;

  return (
    <View style={{ marginBottom: 14 }}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <View style={[s.row, error && { borderColor: colors.danger }]}>
        <TouchableOpacity style={s.codeBtn} onPress={() => setOpen(true)} activeOpacity={0.7}>
          <Text style={s.codeText}>{flagFor(dial)} {dial}</Text>
          <MaterialIcons name="arrow-drop-down" size={20} color={colors.muted} />
        </TouchableOpacity>
        <TextInput
          style={s.input}
          value={num}
          onChangeText={onNum}
          placeholder={placeholder || 'Phone number'}
          placeholderTextColor={colors.muted}
          keyboardType="phone-pad"
        />
      </View>
      {error ? <Text style={s.errText}>{error}</Text> : null}

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={s.modalWrap}>
          <View style={s.sheet}>
            <View style={s.sheetHeader}>
              <Text style={s.sheetTitle}>Select country</Text>
              <TouchableOpacity onPress={() => { setOpen(false); setQ(''); }} hitSlop={8}>
                <MaterialIcons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View style={s.search}>
              <MaterialIcons name="search" size={20} color={colors.muted} />
              <TextInput
                style={s.searchInput}
                value={q}
                onChangeText={setQ}
                placeholder="Search country or code"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
              />
            </View>
            <FlatList
              data={filtered}
              keyExtractor={(c) => c.code + c.dial}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity style={s.countryRow} onPress={() => onPick(item)} activeOpacity={0.6}>
                  <Text style={s.countryFlag}>{item.flag}</Text>
                  <Text style={s.countryName}>{item.name}</Text>
                  <Text style={s.countryDial}>{item.dial}</Text>
                </TouchableOpacity>
              )}
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
    row: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    },
    codeBtn: {
      flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12,
      borderRightWidth: 1, borderRightColor: colors.border,
    },
    codeText: { fontSize: 16, color: colors.text, fontWeight: '600' },
    input: { flex: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: colors.text },
    errText: { fontSize: 12, color: colors.danger, marginTop: 4 },
    modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
    sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%', paddingBottom: 20 },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
    sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
    search: {
      flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8,
      backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, height: 44,
    },
    searchInput: { flex: 1, fontSize: 15, color: colors.text },
    countryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
    countryFlag: { fontSize: 22 },
    countryName: { flex: 1, fontSize: 15, color: colors.text },
    countryDial: { fontSize: 15, color: colors.muted, fontWeight: '600' },
  });
