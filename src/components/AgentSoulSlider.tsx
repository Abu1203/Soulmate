// ============================================================
// AgentSoul - 温度/TopP 滑动条组件
// ============================================================
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

// react-native 自带 Slider 已废弃，回退到纯 View 实现
// 使用简单的 Touchable 模拟滑动条

interface AgentSoulSliderProps {
  label: string;
  value: number;       // 0.0 - 1.0
  onValueChange: (value: number) => void;
  leftLabel: string;
  rightLabel: string;
  minimumValue?: number;
  maximumValue?: number;
}

export default function AgentSoulSlider({
  label,
  value,
  onValueChange,
  leftLabel,
  rightLabel,
  minimumValue = 0,
  maximumValue = 1,
}: AgentSoulSliderProps) {
  const { colors } = useTheme();
  const segments = useMemo(() => Array.from({ length: 11 }).map((_, i) => (
    <TouchableOpacity
      key={i}
      style={styles.segmentHit}
      activeOpacity={0.01}
      onPress={() => {
        const newVal = minimumValue + (i / 10) * (maximumValue - minimumValue);
        onValueChange(Math.round(newVal * 100) / 100);
      }}
    />
  )), [minimumValue, maximumValue, onValueChange]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
        <Text style={styles.value}>{value.toFixed(1)}</Text>
      </View>
      <View style={styles.track}>
        <View pointerEvents="none" style={[styles.fill, { width: `${((value - minimumValue) / (maximumValue - minimumValue)) * 100}%` }]} />
        <View pointerEvents="none" style={[styles.thumb, { left: `${((value - minimumValue) / (maximumValue - minimumValue)) * 100}%` }]} />
        {segments}
      </View>
      <View style={styles.labels}>
        <Text style={[styles.sideLabel, { color: colors.textSecondary }]}>{leftLabel}</Text>
        <Text style={[styles.sideLabel, { color: colors.textSecondary }]}>{rightLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  label: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1A1A1A',
  },
  value: {
    fontSize: 15,
    fontWeight: '600',
    color: '#4A90D9',
  },
  track: {
    height: 28,
    backgroundColor: '#E8E8ED',
    borderRadius: 14,
    position: 'relative',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#4A90D9',
    borderRadius: 14,
    opacity: 0.3,
  },
  thumb: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#4A90D9',
    top: 4,
    marginLeft: -10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentHit: {
    flex: 1,
    height: '100%',
  },
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sideLabel: {
    fontSize: 11,
    color: '#999',
  },
});
