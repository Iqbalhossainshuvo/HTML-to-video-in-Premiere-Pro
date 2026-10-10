/* Small iOS-style building blocks used by every screen. */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { evalMinor, isExpression } from '../core/calc';
import { formatMinor } from '../core/money';
import { avatarColor, initials } from './meta';
import { useTheme } from './theme';

type IconName = keyof typeof Ionicons.glyphMap;

export const tap = () => {
  if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
};

export function T({
  style,
  size = 17,
  weight,
  color,
  dim,
  numberOfLines,
  children,
  center,
}: {
  style?: StyleProp<TextStyle>;
  size?: number;
  weight?: TextStyle['fontWeight'];
  color?: string;
  dim?: 1 | 2;
  numberOfLines?: number;
  center?: boolean;
  children?: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        {
          fontSize: size,
          color: color || (dim === 1 ? t.text2 : dim === 2 ? t.text3 : t.text),
          fontWeight: weight,
          textAlign: center ? 'center' : undefined,
          letterSpacing: size >= 28 ? 0.35 : size >= 20 ? 0.38 : -0.2,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Scrollable page with an iOS large title. */
export function Page({
  title,
  subtitle,
  right,
  children,
  scroll = true,
  padBottom = 110,
  topInset = true,
}: {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  scroll?: boolean;
  padBottom?: number;
  /** false when a native header already sits above the page */
  topInset?: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const top = topInset ? insets.top + 6 : 8;
  const header = title ? (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        {subtitle ? (
          <T size={13} dim={1} weight="600" style={{ textTransform: 'uppercase', marginBottom: 2 }}>
            {subtitle}
          </T>
        ) : null}
        <T size={32} weight="800" numberOfLines={1}>
          {title}
        </T>
      </View>
      {right ? <View style={styles.headerRight}>{right}</View> : null}
    </View>
  ) : null;
  if (!scroll)
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: top }}>
        {header}
        {children}
      </View>
    );
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: top, paddingBottom: padBottom + insets.bottom }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {header}
      {children}
    </ScrollView>
  );
}

export function IconBtn({
  name,
  onPress,
  color,
  bg,
  size = 20,
  label,
}: {
  name: IconName;
  onPress: () => void;
  color?: string;
  bg?: string;
  size?: number;
  label?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [styles.iconBtn, { backgroundColor: bg ?? t.card, opacity: pressed ? 0.6 : 1 }]}
    >
      <Ionicons name={name} size={size} color={color || t.tint} />
    </Pressable>
  );
}

export function Avatar({ name, photo, size = 40 }: { name: string; photo?: string | null; size?: number }) {
  if (photo) return <Image source={{ uri: photo }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: avatarColor(name),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.38 }}>{initials(name)}</Text>
    </View>
  );
}

export function IconBadge({ name, color, size = 30 }: { name: IconName; color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        backgroundColor: color,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={name} size={size * 0.58} color="#fff" />
    </View>
  );
}

export function Card({ children, style, pad = 16 }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; pad?: number }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.card, padding: pad }, style]}>{children}</View>;
}

/** iOS inset grouped list section. */
export function Section({
  title,
  footer,
  action,
  children,
}: {
  title?: string;
  footer?: string;
  action?: { label: string; onPress: () => void };
  children: React.ReactNode;
}) {
  const t = useTheme();
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={{ marginBottom: 22 }}>
      {title || action ? (
        <View style={styles.sectionHead}>
          <T size={20} weight="700" style={{ flex: 1 }}>
            {title}
          </T>
          {action ? (
            <Pressable hitSlop={8} onPress={action.onPress}>
              <T size={15} color={t.tint}>
                {action.label}
              </T>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View style={[styles.group, { backgroundColor: t.card }]}>
        {items.map((c, i) => (
          <View key={i}>
            {c}
            {i < items.length - 1 ? <View style={[styles.sep, { backgroundColor: t.sep }]} /> : null}
          </View>
        ))}
      </View>
      {footer ? (
        <T size={13} dim={1} style={{ marginHorizontal: 32, marginTop: 6 }}>
          {footer}
        </T>
      ) : null}
    </View>
  );
}

export function Row({
  icon,
  left,
  title,
  subtitle,
  value,
  valueColor,
  valueSub,
  onPress,
  chevron,
  right,
  destructive,
}: {
  icon?: React.ReactNode;
  left?: React.ReactNode;
  title: string;
  subtitle?: string;
  value?: string;
  valueColor?: string;
  valueSub?: string;
  onPress?: () => void;
  chevron?: boolean;
  right?: React.ReactNode;
  destructive?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.fill : 'transparent' }]}
    >
      {icon || left ? <View style={{ marginRight: 12 }}>{icon || left}</View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <T size={16} numberOfLines={1} color={destructive ? t.red : undefined} weight={subtitle ? '500' : undefined}>
          {title}
        </T>
        {subtitle ? (
          <T size={13} dim={1} numberOfLines={1} style={{ marginTop: 2 }}>
            {subtitle}
          </T>
        ) : null}
      </View>
      {value !== undefined ? (
        <View style={{ alignItems: 'flex-end', marginLeft: 8, flexShrink: 0 }}>
          <T size={16} weight="600" color={valueColor} style={{ fontVariant: ['tabular-nums'] }}>
            {value}
          </T>
          {valueSub ? (
            <T size={12} dim={1} style={{ marginTop: 2 }}>
              {valueSub}
            </T>
          ) : null}
        </View>
      ) : null}
      {right}
      {chevron || (onPress && chevron !== false && !right) ? (
        <Ionicons name="chevron-forward" size={18} color={t.text3} style={{ marginLeft: 6 }} />
      ) : null}
    </Pressable>
  );
}

export function Button({
  title,
  onPress,
  kind = 'filled',
  color,
  icon,
  loading,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: 'filled' | 'tinted' | 'plain';
  color?: string;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const c = color || t.tint;
  const bg = kind === 'filled' ? c : kind === 'tinted' ? c + '22' : 'transparent';
  const fg = kind === 'filled' ? '#fff' : c;
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={19} color={fg} style={{ marginRight: 8 }} /> : null}
          <Text style={{ color: fg, fontSize: 17, fontWeight: '600' }}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Segmented<V extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View style={[styles.seg, { backgroundColor: t.fill }, style]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              tap();
              onChange(o.value);
            }}
            style={[styles.segItem, on && { backgroundColor: t.dark ? '#636366' : '#fff', ...styles.segOn }]}
          >
            <T size={13} weight={on ? '600' : '500'} numberOfLines={1}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A labelled text field inside a grouped section. */
export function Field({
  label,
  hint,
  right,
  ...input
}: TextInputProps & { label: string; hint?: string; right?: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.field}>
      <T size={13} dim={1} weight="500">
        {label}
      </T>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <TextInput
          placeholderTextColor={t.text3}
          {...input}
          style={[{ flex: 1, fontSize: 17, color: t.text, paddingVertical: 6 }, input.style]}
        />
        {right}
      </View>
      {hint ? (
        <T size={12} dim={1}>
          {hint}
        </T>
      ) : null}
    </View>
  );
}

/**
 * Amount box that accepts sums: "1200+350" shows "= 1,550" and the value is
 * the result. `onValue` gets minor units (or null when empty / invalid).
 */
export function AmountField({
  label,
  text,
  onText,
  currency,
  hint,
  autoFocus,
  big,
  right,
}: {
  label: string;
  text: string;
  onText: (s: string) => void;
  currency?: string;
  hint?: string;
  autoFocus?: boolean;
  big?: boolean;
  right?: React.ReactNode;
}) {
  const t = useTheme();
  const [focus, setFocus] = useState(false);
  const v = evalMinor(text);
  const expr = isExpression(text);
  return (
    <View style={styles.field}>
      <T size={13} dim={1} weight="500">
        {label}
      </T>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <TextInput
          value={text}
          onChangeText={onText}
          autoFocus={autoFocus}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
          placeholder="0"
          placeholderTextColor={t.text3}
          style={{
            flex: 1,
            fontSize: big ? 30 : 20,
            fontWeight: big ? '700' : '600',
            color: t.text,
            paddingVertical: 6,
            fontVariant: ['tabular-nums'],
          }}
        />
        {currency ? (
          <T size={15} dim={1} weight="600" style={{ marginLeft: 6 }}>
            {currency}
          </T>
        ) : null}
        {right}
      </View>
      {expr ? (
        <T size={14} weight="600" color={v === null ? t.red : t.green}>
          {v === null ? 'হিসাব ঠিক নেই' : `= ${formatMinor(v)}`}
        </T>
      ) : hint ? (
        <T size={12} dim={1}>
          {hint}
        </T>
      ) : focus ? (
        <T size={12} dim={2}>
          যোগ-বিয়োগ লিখতে পারেন, যেমন 1200+350
        </T>
      ) : null}
    </View>
  );
}

export function Empty({ icon, title, text }: { icon: IconName; title: string; text?: string }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 32 }}>
      <Ionicons name={icon} size={46} color={t.text3} />
      <T size={18} weight="600" style={{ marginTop: 12 }} center>
        {title}
      </T>
      {text ? (
        <T size={14} dim={1} center style={{ marginTop: 6 }}>
          {text}
        </T>
      ) : null}
    </View>
  );
}

export function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (s: string) => void; placeholder: string }) {
  const t = useTheme();
  return (
    <View style={[styles.search, { backgroundColor: t.fill }]}>
      <Ionicons name="search" size={17} color={t.text2} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.text2}
        style={{ flex: 1, fontSize: 17, color: t.text, marginLeft: 6, paddingVertical: 0 }}
        clearButtonMode="while-editing"
      />
      {value && Platform.OS !== 'ios' ? (
        <Pressable onPress={() => onChange('')} hitSlop={8}>
          <Ionicons name="close-circle" size={17} color={t.text2} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function Fab({ onPress, icon = 'add' }: { onPress: () => void; icon?: IconName }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.fab,
        { backgroundColor: t.tint, bottom: insets.bottom + 72, transform: [{ scale: pressed ? 0.94 : 1 }] },
      ]}
    >
      <Ionicons name={icon} size={30} color="#fff" />
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 20, paddingBottom: 14, paddingTop: 4 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 12, paddingBottom: 4 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 18, marginHorizontal: 16 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginBottom: 8 },
  group: { borderRadius: 14, marginHorizontal: 16, overflow: 'hidden' },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11, minHeight: 50 },
  button: {
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    paddingHorizontal: 18,
  },
  seg: { flexDirection: 'row', borderRadius: 9, padding: 2 },
  segItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 7, borderRadius: 7 },
  segOn: {
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  field: { paddingHorizontal: 16, paddingVertical: 10, gap: 2 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 11,
    paddingHorizontal: 9,
    height: 38,
    marginHorizontal: 16,
    marginBottom: 14,
  },
  fab: {
    position: 'absolute',
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
});
