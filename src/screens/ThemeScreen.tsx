// ============================================================
// Soulmate - 主题设置页面
// ============================================================
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DrawerActions } from '@react-navigation/native';
import { useAgentSoul } from '../contexts/AgentSoulContext';
import { useTheme } from '../contexts/ThemeContext';
import type { AgentSoulSettings } from '../types/agentsoul';
import type { CustomTheme } from '../contexts/ThemeContext';
import AgentSoulSlider from '../components/AgentSoulSlider';
import Toast from '../components/Toast';

const THEMES: { id: CustomTheme; name: string; icon: string; available: boolean }[] = [
  { id: 'default', name: '默认', icon: '🎨', available: true },
  { id: 'emotion', name: '情绪', icon: '🌑', available: true },
  { id: 'ocean',   name: '暂无', icon: '🌀', available: false },
  { id: 'moonlight', name: '暂无', icon: '🌙', available: false },
];

export default function ThemeScreen({ navigation, route }: any) {
  const { activeConversation: activePrivate, conversations, updateConversation } = useAgentSoul();
  const activeConversation = route.params?.convId ? conversations.find(c => c.id === route.params.convId) : activePrivate;
  const { customTheme, setCustomTheme, colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const DEFAULT_BG_OPACITY = 10;

  const [bgOpacity, setBgOpacity] = useState(DEFAULT_BG_OPACITY);
  const [selectedTheme, setSelectedTheme] = useState(customTheme);
  const savingRef = useRef(false);
  const loadedTargetRef = useRef<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const showToast = (msg: string) => { setToastMsg(msg); setToastVisible(true); };

  useEffect(() => {
    const load = () => {
      if (activeConversation) {
        setBgOpacity(activeConversation.settings?.backgroundOpacity ?? DEFAULT_BG_OPACITY);
      }
    };
    if (activeConversation && loadedTargetRef.current !== activeConversation.id) { load(); loadedTargetRef.current = activeConversation.id; }
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, activeConversation]);

  const doSave = async (overrides?: Partial<AgentSoulSettings>) => {
    if (!activeConversation || savingRef.current) return;
    savingRef.current = true;
    try {
      await updateConversation(activeConversation.id, {
        settings: {
          ...activeConversation.settings,
          backgroundOpacity: bgOpacity,
          ...overrides,
        },
      });
    } catch (e: any) { showToast(e.message || '保存失败'); throw e; }
    finally { savingRef.current = false; }
  };

  const handleSaveAndClose = async () => {
    try { await doSave(); } catch { return; }
    // ✅ 修复(问题7)：返回前强制关闭 Drawer，避免卡在侧边栏
    try { navigation.dispatch(DrawerActions.closeDrawer()); } catch {}
    navigation.goBack();
  };

  // --- 恢复默认 ---
  const handleReset = async () => {
    setBgOpacity(DEFAULT_BG_OPACITY);
    try { await doSave({ backgroundOpacity: DEFAULT_BG_OPACITY }); } catch { /* doSave displays the failure */ }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      <View style={[styles.nav, { borderBottomColor: colors.separator }]}>
        <TouchableOpacity onPress={() => {
          // ✅ 修复(问题7)：返回前强制关闭 Drawer
          try { navigation.dispatch(DrawerActions.closeDrawer()); } catch {}
          navigation.goBack();
        }} style={styles.navBtn}>
          <Text style={[styles.navBtnText, { color: colors.primary }]}>← 返回</Text>
        </TouchableOpacity>
        <Text style={[styles.navTitle, { color: colors.text }]}>主题</Text>
        <View style={styles.navBtn} />
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>

        {/* ========== 主题选择 ========== */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>主题选择</Text>
        <View style={styles.themeRow}>
          {THEMES.map((t) => {
            const isSelected = t.id === selectedTheme;
            return (
              <TouchableOpacity
                key={t.id}
                style={[
                  styles.themeCard,
                  { backgroundColor: colors.surfaceSecondary },
                  isSelected && styles.themeCardSelected,
                  !t.available && styles.themeCardDisabled,
                ]}
                onPress={() => { if (t.available) { setSelectedTheme(t.id); setCustomTheme(t.id); } }}
                activeOpacity={t.available ? 0.6 : 1}
                disabled={!t.available}>
                <Text style={styles.themeIcon}>{t.icon}</Text>
                <Text style={[styles.themeName, isSelected && styles.themeNameSelected, !t.available && styles.themeNameDisabled, { color: !t.available ? '#BBB' : (isSelected ? colors.primary : colors.text) }]}>
                  {t.name}
                </Text>
                {isSelected && <Text style={styles.checkmark}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ========== 对话背景透明度 ========== */}
        <View style={styles.divider} />
        <AgentSoulSlider
          label="对话背景透明度"
          value={bgOpacity / 100}
          onValueChange={(v) => setBgOpacity(Math.round(v * 100))}
          leftLabel="0% 隐藏"
          rightLabel="100% 全显"
          minimumValue={0}
          maximumValue={1}
        />
        <Text style={[styles.desc, { color: colors.textTertiary }]}>调节当前对话背景图的透明程度（{bgOpacity}%）</Text>

        {/* ========== 恢复默认 ========== */}
        <View style={styles.divider} />
        <TouchableOpacity style={[styles.resetBtn, { backgroundColor: colors.surfaceSecondary }]} onPress={handleReset} activeOpacity={0.7}>
          <Text style={[styles.resetText, { color: colors.textSecondary }]}>恢复默认</Text>
        </TouchableOpacity>

        {/* ========== 保存 ========== */}
        <TouchableOpacity style={styles.saveBtn} onPress={handleSaveAndClose} activeOpacity={0.7}>
          <Text style={styles.saveText}>保存设置</Text>
        </TouchableOpacity>

      </ScrollView>
      <Toast visible={toastVisible} message={toastMsg} type="info" onDismiss={() => setToastVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: '#E0E0E0',
  },
  navBtn: { width: 60 },
  navBtnText: { fontSize: 15, color: '#4A90D9' },
  navTitle: { fontSize: 17, fontWeight: '600' },
  body: { flex: 1 },
  bodyContent: { padding: 20, paddingBottom: 40 },
  sectionTitle: { fontSize: 15, fontWeight: '500', color: '#1A1A1A', marginBottom: 10 },

  // --- 主题选择 ---
  themeRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  themeCard: {
    flex: 1, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 6,
    borderRadius: 10, backgroundColor: '#F5F5F7', borderWidth: 2, borderColor: 'transparent',
  },
  themeCardSelected: { backgroundColor: '#EBF3FC', borderColor: '#4A90D9' },
  themeCardDisabled: { opacity: 0.45 },
  themeIcon: { fontSize: 22, marginBottom: 4 },
  themeName: { fontSize: 12, color: '#1A1A1A', fontWeight: '500' },
  themeNameSelected: { color: '#4A90D9', fontWeight: '600' },
  themeNameDisabled: { color: '#BBB' },
  checkmark: { position: 'absolute', top: 4, right: 6, fontSize: 12, color: '#4A90D9', fontWeight: '700' },

  // --- 通用 ---
  desc: { fontSize: 12, color: '#999', marginTop: -6, marginBottom: 8 },
  divider: { height: 0.5, backgroundColor: '#E0E0E0', marginVertical: 16 },
  resetBtn: { paddingVertical: 12, borderRadius: 10, backgroundColor: '#F0F0F5', alignItems: 'center', marginBottom: 16 },
  resetText: { fontSize: 15, color: '#666', fontWeight: '500' },
  saveBtn: { backgroundColor: '#4A90D9', paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  saveText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
});
