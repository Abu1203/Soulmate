// ============================================================
// Soulmate - 底部浮动毛玻璃 Toast
// ============================================================
import React, { useEffect, useRef, useCallback } from 'react';
import { Animated, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastProps {
  visible: boolean;
  message: string;
  type?: ToastType;
  duration?: number;
  onDismiss: () => void;
}

export default function Toast({ visible, message, type = 'info', duration = 2500, onDismiss }: ToastProps) {
  const { colors, isDark } = useTheme();
  const translateY = useRef(new Animated.Value(100)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const generationRef = useRef(0);
  const closingRef = useRef<Animated.CompositeAnimation | null>(null);

  // ✅ 修复(M1)：onDismiss 存 ref——调用方传内联函数时 hide 引用不再变化，
  //    effect 不会因父组件高频渲染而重跑，自动消失 timer 不再被无限重置
  const onDismissRef = useRef(onDismiss);
  useEffect(() => { onDismissRef.current = onDismiss; }, [onDismiss]);

  const hide = useCallback(() => {
    const generation = generationRef.current;
    closingRef.current?.stop();
    const closing = Animated.parallel([
      Animated.timing(translateY, { toValue: 100, duration: 250, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]);
    closingRef.current = closing;
    closing.start(({ finished }) => { if (finished && generationRef.current === generation) onDismissRef.current(); });
  }, [translateY, opacity]);

  useEffect(() => {
    generationRef.current++; closingRef.current?.stop();
    if (visible) {
      const anims = [
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }),
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ];
      Animated.parallel(anims).start();
      const timer = setTimeout(() => hide(), duration);
      return () => { generationRef.current++; clearTimeout(timer); anims.forEach(a => a.stop()); closingRef.current?.stop(); };
    } else {
      translateY.setValue(100);
      opacity.setValue(0);
    }
  }, [visible, message, type, duration, translateY, opacity, hide]);

  if (!visible) return null;

  const icons: Record<ToastType, string> = { error: '✕', success: '✓', warning: '⚠', info: 'ℹ' };
  const accentColors: Record<ToastType, string> = {
    error: colors.error, success: colors.success, warning: colors.warning, info: colors.info,
  };

  return (
    <Animated.View style={[styles.wrapper, { transform: [{ translateY }], opacity }]} pointerEvents="box-none">
      <TouchableOpacity onPress={hide} activeOpacity={0.9}>
        <Animated.View style={[styles.card, { backgroundColor: colors.toastBg }]}>
          <Text style={[styles.icon, { color: accentColors[type] }]}>{icons[type]}</Text>
          <Text style={[styles.message, { color: colors.text }]} numberOfLines={2}>{message}</Text>
        </Animated.View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'absolute', bottom: 100, left: 20, right: 20, zIndex: 9999, alignItems: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 10, maxWidth: 360 },
  icon: { fontSize: 16, fontWeight: '700', marginRight: 10 },
  message: { fontSize: 14, fontWeight: '500', flex: 1, lineHeight: 20 },
});
