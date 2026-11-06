// ============================================================
// Soulmate - 联网搜索开关组件（暗色主题适配）
// ============================================================
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../contexts/ThemeContext';

const SEARCH_TOGGLE_KEY = '@soulmate_search_enabled';

export default function SearchToggle() {
  const [enabled, setEnabled] = useState(true);
  const { isDark, colors } = useTheme();

  useEffect(() => {
    AsyncStorage.getItem(SEARCH_TOGGLE_KEY).then(v => {
      if (v !== null) setEnabled(v === 'true');
    });
  }, []);

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    AsyncStorage.setItem(SEARCH_TOGGLE_KEY, String(next));
  };

  const toggleBg = isDark ? 'rgba(255,255,255,0.08)' : '#F5F5F7';
  const toggleActiveBg = isDark ? 'rgba(255,255,255,0.12)' : '#EBF3FC';
  const labelColor = isDark ? '#C8C8C8' : '#1A1A1A';
  const statusColor = isDark ? '#888' : '#999';
  const switchOffBg = isDark ? 'rgba(255,255,255,0.15)' : '#D0D0D5';
  const switchDotBg = isDark ? 'rgba(255,255,255,0.5)' : '#FFF';

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.toggle, { backgroundColor: enabled ? toggleActiveBg : toggleBg }]}
        onPress={toggle}
        activeOpacity={0.7}>
        <Text style={styles.icon}>{enabled ? '🌐' : '🌍'}</Text>
        <View style={styles.info}>
          <Text style={[styles.label, { color: labelColor }]}>联网搜索</Text>
          <Text style={[styles.status, { color: statusColor }]}>
            {enabled ? '● 已开启' : '○ 已关闭'}
          </Text>
        </View>
        <View style={[styles.switch, { backgroundColor: enabled ? colors.primary : switchOffBg }]}>
          <View style={[styles.switchDot, { backgroundColor: switchDotBg }, enabled && styles.switchDotOn]} />
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginVertical: 10 },
  toggle: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 12,
    borderRadius: 10, backgroundColor: '#F5F5F7',
  },
  toggleActive: { backgroundColor: '#EBF3FC' },
  icon: { fontSize: 24, marginRight: 10 },
  info: { flex: 1 },
  label: { fontSize: 15, fontWeight: '500', color: '#1A1A1A' },
  status: { fontSize: 12, color: '#999', marginTop: 2 },
  switch: {
    width: 44, height: 26, borderRadius: 13,
    backgroundColor: '#D0D0D5',
    justifyContent: 'center', paddingHorizontal: 3,
  },
  switchOn: { backgroundColor: '#34C759' },
  switchDot: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#FFF',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15, shadowRadius: 1, elevation: 1,
  },
  switchDotOn: { alignSelf: 'flex-end' },
});
