import React from 'react';
import { Modal, View, Text, TouchableOpacity, KeyboardAvoidingView, Platform, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import AppDialogHost from './AppDialogHost';

interface ThemedSheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  closeText?: string;
  busy?: boolean;
  large?: boolean;
  action?: { text: string; onPress: () => void; disabled?: boolean };
  children: React.ReactNode;
}

export default function ThemedSheet({ visible, title, onClose, closeText = '完成', busy = false, large = false, action, children }: ThemedSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  const close = () => { if (!busy) onClose(); };
  return <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.overlay, { backgroundColor: colors.overlay, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      <View accessibilityViewIsModal style={[styles.card, large && styles.large, { backgroundColor: colors.surface, borderColor: colors.separator }]}>
        <View style={[styles.header, { borderBottomColor: colors.separator }]}>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          <TouchableOpacity disabled={busy} onPress={close} accessibilityLabel={closeText} style={styles.headerButton}>
            <Text style={{ color: busy ? colors.textTertiary : colors.textSecondary }}>{closeText}</Text>
          </TouchableOpacity>
          {action && <TouchableOpacity disabled={busy || action.disabled} onPress={action.onPress}
            style={[styles.saveButton, { backgroundColor: colors.primary, opacity: busy || action.disabled ? 0.5 : 1 }]}>
            {busy ? <ActivityIndicator size="small" color={colors.textInverse} /> : <Text style={{ color: colors.textInverse, fontWeight: '600' }}>{action.text}</Text>}
          </TouchableOpacity>}
        </View>
        <View style={[styles.body, large && styles.largeBody]}>{children}</View>
      </View>
    </KeyboardAvoidingView>
    {/* The active native sheet owns alerts, including confirmations over an editor. */}
    <AppDialogHost />
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 },
  card: { width: '100%', maxWidth: 560, maxHeight: '90%', borderRadius: 20, borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 16, elevation: 20 },
  large: { height: '90%' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, fontSize: 17, fontWeight: '600' },
  headerButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 4 },
  saveButton: { minHeight: 40, minWidth: 56, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  body: { flexShrink: 1, padding: 16 },
  largeBody: { flex: 1 },
});
