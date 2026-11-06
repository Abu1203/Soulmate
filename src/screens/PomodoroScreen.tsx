// ============================================================
// Soulmate — 番茄钟页面
// ============================================================
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, Animated, Image, ImageBackground,
  StyleSheet, Vibration, Modal, AppState, AppStateStatus, } from 'react-native';
import { AppAlert } from '../services/appDialog';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../contexts/ThemeContext';
import AgentSoulSlider from '../components/AgentSoulSlider';
import { persistImageUri } from '../services/imageStore';

import { loadPomodoroSession, savePomodoroSession, remainingSeconds } from '../services/pomodoroSession';

const POMODORO_BG_KEY = '@soulmate_pomodoro_bg';

type PomodoroMode = 'focus' | 'shortBreak' | 'longBreak';

const MODES: { key: PomodoroMode; label: string; minutes: number; color: string }[] = [
  { key: 'focus', label: '专注', minutes: 25, color: '#4A90D9' },
  { key: 'shortBreak', label: '短休息', minutes: 5, color: '#34C759' },
  { key: 'longBreak', label: '长休息', minutes: 15, color: '#F5A623' },
];

const COMPANION_MESSAGES = [
  '专注的时候，我就在你身边',
  '慢慢来，不用着急',
  '你已经很棒了',
  '我一直都在这里',
  '专注每一刻',
  '累了就休息一下',
  '休息是为了走更远的路',
  '我陪着你呢',
];

export default function PomodoroScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { colors, isDark, customTheme } = useTheme();
  const isEmotion = customTheme === 'emotion';
  const { aiName, aiAvatar } = route.params || {};

  const [sessionReady, setSessionReady] = useState(false);
  const [mode, setMode] = useState<PomodoroMode>('focus');
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [companionMsg] = useState(() => COMPANION_MESSAGES[Math.floor(Math.random() * COMPANION_MESSAGES.length)]);

  // ✅ 自定义背景
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [bgOpacity, setBgOpacity] = useState(30);
  const [showBgModal, setShowBgModal] = useState(false);
  const [tempBgOpacity, setTempBgOpacity] = useState(30);

  useEffect(() => {
    AsyncStorage.getItem(POMODORO_BG_KEY).then(v => {
      if (v) {
        const d = JSON.parse(v);
        if (d.bgImage) setBgImage(d.bgImage);
        if (Number.isFinite(d.bgOpacity) && d.bgOpacity >= 0 && d.bgOpacity <= 100) setBgOpacity(d.bgOpacity);
      }
    }).catch(() => {});
  }, []);

  const saveBg = async (img: string | null, opacity: number) => {
    try {
      await AsyncStorage.setItem(POMODORO_BG_KEY, JSON.stringify({ bgImage: img, bgOpacity: opacity }));
      setBgImage(img); setBgOpacity(opacity);
    } catch (e) { AppAlert.alert('背景未保存', e instanceof Error ? e.message : '请重试'); }
  };

  const pickBg = async () => {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!r.canceled && r.assets.length > 0) {
        // ✅ 修复(背景丢失)：持久化到应用目录 + 立即落盘（用户点遮罩关弹窗也会保存）
        const persisted = await persistImageUri(r.assets[0].uri, 'pomodoro_bg');
        await saveBg(persisted, bgOpacity);
        setTempBgOpacity(bgOpacity);
      }
    } catch (e) { AppAlert.alert('背景加载失败', e instanceof Error ? e.message : '请重试'); }
  };

  const totalSeconds = MODES.find(m => m.key === mode)!.minutes * 60;
  const activeColor = MODES.find(m => m.key === mode)!.color;
  const progress = totalSeconds > 0 ? (totalSeconds - secondsLeft) / totalSeconds : 0;

  // Refs
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const secondsRef = useRef(secondsLeft);
  secondsRef.current = secondsLeft;
  const isRunningRef = useRef(isRunning);
  isRunningRef.current = isRunning;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const deadlineRef = useRef<number | null>(null);
  const reportSave = () => AppAlert.alert('计时未保存', '请检查设备存储空间；离开页面后可能无法恢复。');

  // AI 头像旋转动画
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  const startSpin = useCallback(() => {
    spinAnim.setValue(0);
    spinLoopRef.current = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 8000,
        useNativeDriver: true,
      }),
    );
    spinLoopRef.current.start();
  }, [spinAnim]);

  const stopSpin = useCallback(() => {
    if (spinLoopRef.current) { spinLoopRef.current.stop(); spinLoopRef.current = null; }
  }, []);

  // 进度环动画
  const progressAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  // Persist an absolute deadline; native background throttling cannot double-count elapsed time.
  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (deadlineRef.current === null) deadlineRef.current = Date.now() + secondsRef.current * 1000;
    void savePomodoroSession({ mode: modeRef.current, remaining: secondsRef.current, deadline: deadlineRef.current }).catch(reportSave);
    const tick = () => {
      if (!mountedRef.current || deadlineRef.current === null) return;
      const left = remainingSeconds({ mode: modeRef.current, remaining: secondsRef.current, deadline: deadlineRef.current });
      secondsRef.current = left; setSecondsLeft(left);
      if (left === 0) {
        if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null;
        deadlineRef.current = null; isRunningRef.current = false; setIsRunning(false); stopSpin();
        void savePomodoroSession({ mode: modeRef.current, remaining: 0, deadline: null }).catch(reportSave);
        Vibration.vibrate([0,300,100,300]); setShowComplete(true);
      }
    };
    timerRef.current = setInterval(tick,1000); setIsRunning(true); isRunningRef.current = true; startSpin(); tick();
  }, [startSpin, stopSpin]);
  const pauseTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null;
    const remaining = remainingSeconds({ mode: modeRef.current, remaining: secondsRef.current, deadline: deadlineRef.current });
    deadlineRef.current = null; secondsRef.current = remaining; setSecondsLeft(remaining); setIsRunning(false); isRunningRef.current = false; stopSpin();
    void savePomodoroSession({ mode: modeRef.current, remaining, deadline: null }).catch(reportSave);
  }, [stopSpin]);
  const resetTimer = useCallback((newMode?: PomodoroMode) => {
    if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null;
    setIsRunning(false); isRunningRef.current = false; stopSpin(); deadlineRef.current = null;
    const m = newMode || modeRef.current, remaining = MODES.find(x => x.key === m)!.minutes * 60;
    secondsRef.current = remaining; setSecondsLeft(remaining); progressAnim.setValue(0);
    void savePomodoroSession({ mode: m, remaining, deadline: null }).catch(reportSave);
  }, [stopSpin, progressAnim]);
  useEffect(() => {
    let alive = true;
    loadPomodoroSession().then(session => {
      if (!alive || !session) return;
      modeRef.current = session.mode; setMode(session.mode); const left = remainingSeconds(session);
      secondsRef.current = left; setSecondsLeft(left); deadlineRef.current = session.deadline;
      if (session.deadline !== null) startTimer();
    }).catch(reportSave).finally(() => { if (alive) setSessionReady(true); });
    return () => { alive = false; };
  }, [startTimer]);

  const switchMode = useCallback((newMode: PomodoroMode) => {
    setMode(newMode);
    modeRef.current = newMode;
    resetTimer(newMode);
  }, [resetTimer]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && isRunningRef.current && deadlineRef.current !== null) {
        const left = remainingSeconds({ mode: modeRef.current, remaining: secondsRef.current, deadline: deadlineRef.current });
        secondsRef.current = left; setSecondsLeft(left); if (!left) startTimer();
      }
    });
    return () => sub.remove();
  }, [startTimer]);

  // 退出确认
  const handleBack = useCallback(() => {
    if (isRunning) {
      setShowExitConfirm(true);
    } else {
      navigation.goBack();
    }
  }, [isRunning, navigation]);

  // 清理
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      stopSpin();
    };
  }, [stopSpin]);

  // 格式化时间
  const min = Math.floor(secondsLeft / 60);
  const sec = secondsLeft % 60;
  const timeDisplay = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

  // 进度环旋转角度
  const rightHalfRotate = progressAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['0deg', '180deg', '180deg'],
  });
  const leftHalfRotate = progressAnim.interpolate({
    inputRange: [0, 0.5, 0.5001, 1],
    outputRange: ['0deg', '0deg', '0deg', '180deg'],
  });
  // 右半圆的 opacity：进度超过 50% 时让左半圆可见
  const leftHalfOpacity = progressAnim.interpolate({
    inputRange: [0, 0.5, 0.5001, 1],
    outputRange: [0, 0, 1, 1],
  });

  const spinInterpolate = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const CIRCLE_SIZE = 260;
  const RING_WIDTH = 6;

  // 主题颜色
  const bg = isEmotion ? '#0A0A0A' : colors.background;
  const navColor = isEmotion ? '#FFFFFF' : colors.text;
  const textColor = isEmotion ? '#FFFFFF' : colors.text;
  const subColor = isEmotion ? '#AAAAAA' : colors.textSecondary;
  const ringBg = isEmotion ? 'rgba(255,255,255,0.08)' : 'rgba(74,144,217,0.12)';
  const circleBg = isEmotion ? 'rgba(42,42,42,0.6)' : colors.surfaceSecondary;

  const inner = (
    <>
      {/* 导航栏 */}
      <View style={[styles.nav, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={handleBack}>
          <Text style={[styles.navBack, { color: activeColor }]}>← 返回</Text>
        </TouchableOpacity>
        <Text style={[styles.navTitle, { color: navColor }]}>🍅 番茄钟</Text>
        <TouchableOpacity onPress={() => { setTempBgOpacity(bgOpacity); setShowBgModal(true); }}>
          <Text style={{ fontSize: 18, color: navColor }}>🖼</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        {/* 三档切换 */}
        <View style={styles.modeRow}>
          {MODES.map(m => {
            const active = mode === m.key;
            return (
              <TouchableOpacity
                key={m.key}
                disabled={!sessionReady} onPress={() => switchMode(m.key)}
                style={[styles.modeBtn, {
                  backgroundColor: active ? m.color : (isEmotion ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'),
                }]}
                activeOpacity={0.7}>
                <Text style={[styles.modeLabel, { color: active ? '#FFF' : subColor }]}>{m.label}</Text>
                <Text style={[styles.modeTime, { color: active ? 'rgba(255,255,255,0.75)' : subColor }]}>{m.minutes}分</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 大圆圈 + 进度环 */}
        <View style={{ width: CIRCLE_SIZE + RING_WIDTH * 2, height: CIRCLE_SIZE + RING_WIDTH * 2 }}>
          {/* 背景环 */}
          <View style={[styles.ringBg, {
            width: CIRCLE_SIZE + RING_WIDTH * 2, height: CIRCLE_SIZE + RING_WIDTH * 2,
            borderRadius: (CIRCLE_SIZE + RING_WIDTH * 2) / 2,
            borderColor: ringBg, borderWidth: RING_WIDTH,
          }]} />
          {/* 右半进度 — 0% ~ 50% */}
          <View style={[styles.halfClip, {
            width: (CIRCLE_SIZE + RING_WIDTH * 2) / 2,
            height: CIRCLE_SIZE + RING_WIDTH * 2,
            left: (CIRCLE_SIZE + RING_WIDTH * 2) / 2, top: 0,
          }]}>
            <Animated.View style={[styles.progressFullCircle, {
              width: CIRCLE_SIZE + RING_WIDTH * 2,
              height: CIRCLE_SIZE + RING_WIDTH * 2,
              borderRadius: (CIRCLE_SIZE + RING_WIDTH * 2) / 2,
              left: -(CIRCLE_SIZE + RING_WIDTH * 2) / 2, top: 0,
              borderColor: activeColor, borderWidth: RING_WIDTH,
              transform: [{ rotate: rightHalfRotate }],
            }]} />
          </View>
          {/* 左半进度 — 50% ~ 100% */}
          <Animated.View style={[styles.halfClip, {
            width: (CIRCLE_SIZE + RING_WIDTH * 2) / 2,
            height: CIRCLE_SIZE + RING_WIDTH * 2,
            left: 0, top: 0,
            opacity: leftHalfOpacity,
          }]}>
            <Animated.View style={[styles.progressFullCircle, {
              width: CIRCLE_SIZE + RING_WIDTH * 2,
              height: CIRCLE_SIZE + RING_WIDTH * 2,
              borderRadius: (CIRCLE_SIZE + RING_WIDTH * 2) / 2,
              left: 0, top: 0,
              borderColor: activeColor, borderWidth: RING_WIDTH,
              transform: [{ rotate: leftHalfRotate }],
            }]} />
          </Animated.View>
          {/* 内圆 — 内容区 */}
          <View style={[styles.circleInner, {
            width: CIRCLE_SIZE, height: CIRCLE_SIZE, borderRadius: CIRCLE_SIZE / 2,
            top: RING_WIDTH, left: RING_WIDTH,
            backgroundColor: circleBg,
          }]}>
            {/* 倒计时 */}
            <Text style={[styles.timerText, { color: textColor }]}>{timeDisplay}</Text>
            {/* AI 头像 */}
            <Animated.View style={[styles.avatarWrap, { transform: [{ rotate: spinInterpolate }] }]}>
              <View style={[styles.avatarRing, { borderColor: activeColor }]}>
                {aiAvatar ? (
                  <Image source={{ uri: aiAvatar }} style={styles.avatarImg} />
                ) : (
                  <Text style={styles.avatarPlaceholder}>🤖</Text>
                )}
              </View>
            </Animated.View>
          </View>
        </View>

        {/* 底部文字 */}
        <Text style={[styles.companionLine, { color: subColor }]}>—— 正在陪伴你 ——</Text>
        <Text style={[styles.companionMsg, { color: subColor }]}>{companionMsg}</Text>

        {/* 控制按钮 */}
        <View style={styles.controlRow}>
          {secondsLeft === 0 ? (
            <TouchableOpacity
              onPress={() => { setShowComplete(false); resetTimer(); }}
              style={[styles.ctrlBtn, { backgroundColor: activeColor }]}
              activeOpacity={0.7}>
              <Text style={styles.ctrlBtnText}>🔄 重置</Text>
            </TouchableOpacity>
          ) : isRunning ? (
            <TouchableOpacity
              onPress={pauseTimer}
              style={[styles.ctrlBtn, { backgroundColor: isEmotion ? 'rgba(255,255,255,0.08)' : 'rgba(74,144,217,0.1)' }]}
              activeOpacity={0.7}>
              <Text style={[styles.ctrlBtnText, { color: activeColor }]}>⏸ 暂停</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              disabled={!sessionReady} onPress={startTimer}
              style={[styles.ctrlBtn, { backgroundColor: activeColor }]}
              activeOpacity={0.7}>
              <Text style={styles.ctrlBtnText}>▶ 继续</Text>
            </TouchableOpacity>
          )}
          {secondsLeft < totalSeconds && secondsLeft > 0 && (
            <TouchableOpacity
              onPress={() => resetTimer()}
              style={[styles.ctrlBtn, { backgroundColor: isEmotion ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }]}
              activeOpacity={0.7}>
              <Text style={[styles.ctrlBtnText, { color: subColor }]}>🔄 重置</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* 完成弹窗 */}
      <Modal visible={showComplete} transparent animationType="fade" onRequestClose={() => setShowComplete(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: isEmotion ? '#1A1A1A' : '#FFF' }]}>
            <Text style={styles.modalEmoji}>🎉</Text>
            <Text style={[styles.modalTitle, { color: textColor }]}>专注完成！</Text>
            <Text style={[styles.modalSub, { color: subColor }]}>
              {mode === 'focus' ? '太棒了，休息一下吧' : '休息结束，继续加油！'}
            </Text>
            <TouchableOpacity
              onPress={() => { setShowComplete(false); resetTimer(); }}
              style={[styles.modalBtn, { backgroundColor: activeColor }]}
              activeOpacity={0.7}>
              <Text style={styles.modalBtnText}>好的</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      {/* 退出确认弹窗 */}
      <Modal visible={showExitConfirm} transparent animationType="fade" onRequestClose={() => setShowExitConfirm(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: isEmotion ? '#1A1A1A' : '#FFF' }]}>
            <Text style={styles.modalEmoji}>⏱</Text>
            <Text style={[styles.modalTitle, { color: textColor }]}>番茄钟正在运行</Text>
            <Text style={[styles.modalSub, { color: subColor }]}>确定要退出吗？计时会保存，下次进入按剩余时间恢复；离开页面时不会发送到时通知。</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                onPress={() => setShowExitConfirm(false)}
                style={[styles.modalBtn, { backgroundColor: isEmotion ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}
                activeOpacity={0.7}>
                <Text style={[styles.modalBtnText, { color: subColor }]}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setShowExitConfirm(false); navigation.goBack(); }}
                style={[styles.modalBtn, { backgroundColor: activeColor }]}
                activeOpacity={0.7}>
                <Text style={styles.modalBtnText}>退出</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
    );

  return (
    <>
    {bgImage ? (
      <ImageBackground source={{ uri: bgImage }} style={styles.container} imageStyle={{ opacity: bgOpacity / 100 }}>
        <View style={[styles.container, { backgroundColor: 'transparent' }]}>
          {inner}
        </View>
      </ImageBackground>
    ) : (
      <View style={[styles.container, { backgroundColor: bg }]}>
        {inner}
      </View>
    )}

    {/* 背景设置弹窗 */}
    <Modal visible={showBgModal} transparent animationType="fade" onRequestClose={() => setShowBgModal(false)}>
      <View style={styles.modalOverlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowBgModal(false)} />
        <View style={[styles.modalCard, { backgroundColor: isEmotion ? '#1A1A1A' : '#FFF' }]}>
          <Text style={[styles.modalTitle, { color: textColor }]}>背景设置</Text>
          <Text style={[styles.modalSub, { color: subColor }]}>自定义番茄钟背景</Text>
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
            <TouchableOpacity style={[styles.modalBtn, { backgroundColor: activeColor }]} onPress={pickBg}>
              <Text style={styles.modalBtnText}>📷 选择图片</Text>
            </TouchableOpacity>
            {bgImage && (
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: isEmotion ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}
                onPress={() => { setBgImage(null); saveBg(null, bgOpacity); }}>
                <Text style={[styles.modalBtnText, { color: subColor }]}>移除</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={[styles.sliderLabel, { color: subColor }]}>透明度</Text>
          <AgentSoulSlider label="" leftLabel="透明" rightLabel="浓" value={tempBgOpacity} onValueChange={setTempBgOpacity} minimumValue={5} maximumValue={80} />
          <TouchableOpacity
            style={{ backgroundColor: activeColor, paddingVertical: 12, borderRadius: 10, alignItems: 'center', paddingHorizontal: 40, alignSelf: 'center', marginTop: 16 }}
            onPress={() => { saveBg(bgImage, tempBgOpacity); setShowBgModal(false); }}>
            <Text style={{ color: '#FFF', fontWeight: '600', fontSize: 15 }}>确定</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
    </>
  );
}

const CIRCLE_SIZE = 260;
const RING_WIDTH = 6;

const styles = StyleSheet.create({
  container: { flex: 1 },
  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  navBack: { fontSize: 15 },
  navTitle: { fontSize: 18, fontWeight: '600' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 16 },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  modeBtn: {
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 18, alignItems: 'center',
    minWidth: 72,
  },
  modeLabel: { fontSize: 14, fontWeight: '600' },
  modeTime: { fontSize: 11, marginTop: 1 },
  ringBg: {
    position: 'absolute',
  },
  halfClip: {
    position: 'absolute',
    overflow: 'hidden',
  },
  progressFullCircle: {
    position: 'absolute',
    borderWidth: RING_WIDTH,
    borderColor: 'transparent',
  },
  circleInner: {
    position: 'absolute',
    alignItems: 'center', justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 6,
  },
  timerText: {
    fontSize: 64, fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginBottom: 14,
  },
  avatarWrap: {
    width: 56, height: 56,
  },
  avatarRing: {
    width: 56, height: 56, borderRadius: 28,
    borderWidth: 2,
    justifyContent: 'center', alignItems: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: 52, height: 52, borderRadius: 26 },
  avatarPlaceholder: { fontSize: 28 },
  companionLine: { fontSize: 12 },
  companionMsg: { fontSize: 14, textAlign: 'center' },
  controlRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  ctrlBtn: {
    paddingHorizontal: 28, paddingVertical: 12,
    borderRadius: 24,
  },
  ctrlBtnText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  modalOverlay: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalCard: {
    borderRadius: 20, padding: 32,
    alignItems: 'center', width: 280,
  },
  modalEmoji: { fontSize: 48, marginBottom: 12 },
  modalTitle: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  modalSub: { fontSize: 15, marginBottom: 24 },
  modalBtn: {
    paddingHorizontal: 40, paddingVertical: 12,
    borderRadius: 24,
  },
  modalBtnText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  sliderLabel: { fontSize: 13, marginBottom: 6, marginTop: 4 },
});
