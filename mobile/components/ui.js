import {
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useTheme, radius } from '../lib/theme';

export function Button({ title, onPress, variant = 'primary', loading, disabled, style }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
      style={[
        s.btn,
        isPrimary && { backgroundColor: colors.primary },
        isDanger && { backgroundColor: colors.danger },
        variant === 'ghost' && { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
        (disabled || loading) && { opacity: 0.6 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'ghost' ? colors.text : '#fff'} />
      ) : (
        <Text style={[s.btnText, variant === 'ghost' && { color: colors.text }]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

export function Field({ label, style, multiline, ...props }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  return (
    <View style={{ marginBottom: 14 }}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.muted}
        multiline={multiline}
        style={[s.input, multiline && { minHeight: 90, textAlignVertical: 'top' }, style]}
        {...props}
      />
    </View>
  );
}

export function Card({ children, style }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  return <View style={[s.card, style]}>{children}</View>;
}

export function Screen({ children }) {
  const { colors } = useTheme();
  return <View style={{ flex: 1, backgroundColor: colors.bg }}>{children}</View>;
}

const makeStyles = (colors) =>
  StyleSheet.create({
    btn: {
      height: 50,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 16,
    },
    btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    label: { fontSize: 13, color: colors.muted, marginBottom: 6, fontWeight: '600' },
    input: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
      color: colors.text,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.md,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
  });
