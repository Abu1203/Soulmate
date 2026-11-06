// ============================================================
// Soulmate - 毛玻璃弹窗 (GlassModal)
// ============================================================
import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

interface GlassModalProps {
  visible: boolean;
  icon?: string;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmColor?: string;
  busy?: boolean;
  actions?: Array<{ text: string; style?: 'default'|'cancel'|'destructive'; onPress: () => void }>;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function GlassModal({
  visible, icon = '💔', title, message,
  confirmText = '确认', cancelText = '取消',
  confirmColor, onConfirm, onCancel, busy = false, actions,
}: GlassModalProps) {
  const { colors } = useTheme();
  const defaultConfirm = confirmColor || colors.error;
  const buttons = actions || [{ text: cancelText, style: 'cancel' as const, onPress: onCancel }, { text: confirmText, style: 'destructive' as const, onPress: onConfirm }];

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => { if (!busy) onCancel(); }}>
      <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
        <View accessibilityViewIsModal style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.separator }]}>
          <Text style={styles.iconText}>{icon}</Text>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          <ScrollView style={{ flexShrink: 1, width: '100%' }} contentContainerStyle={{ flexGrow: 0 }}><Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text></ScrollView>
          <View style={[styles.buttons, buttons.length > 2 && { flexDirection: 'column' }]}>
            {buttons.map((button, index) => {
              const cancel = button.style === 'cancel';
              const color = button.style === 'destructive' ? defaultConfirm : colors.primary;
              return <TouchableOpacity key={index} accessibilityRole="button" disabled={busy}
                style={[styles.btn, buttons.length > 2 && { flex: 0, width: '100%' }, { borderWidth: cancel ? 1 : 0, borderColor: colors.separator, backgroundColor: cancel ? 'transparent' : color, opacity: busy ? 0.55 : 1 }]}
                onPress={button.onPress} activeOpacity={0.7}>
                {busy && index === buttons.length - 1 ? <ActivityIndicator size="small" color={colors.textInverse} /> : <Text style={[styles.btnText, { color: cancel ? colors.textSecondary : colors.textInverse }]}>{button.text}</Text>}
              </TouchableOpacity>;
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 32, backgroundColor: 'rgba(0,0,0,0.5)' },
  card: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, maxHeight: '90%', padding: 24, alignItems: 'center', width: '100%', maxWidth: 360, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 20 },
  iconText: { fontSize: 40, marginBottom: 12 },
  title: { fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  message: { fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  buttons: { flexDirection: 'row', gap: 12, width: '100%' },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  btnCancel: { borderWidth: 1, backgroundColor: 'transparent' },
  btnConfirm: {},
  btnText: { fontSize: 15, fontWeight: '600' },
});
