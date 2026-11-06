// ============================================================
// Soulmate — 键盘联动共享 Hook（单聊/群聊统一）
// 策略：windowSoftInputMode=adjustResize（系统压缩布局），
//   输入栏不做手动 transform（避免与系统叠加导致过冲），
//   本 hook 只负责：检测键盘高度 + 键盘弹起时强制滚底（保证最新对话可见）。
//   配合 KeyboardAvoidingView behavior="height" 让输入框随键盘上移。
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export interface KeyboardSyncOptions {
  /** 是否在底部（才自动滚底） */
  isNearBottomRef: React.MutableRefObject<boolean>;
  /** 用户是否正在拖拽（拖拽时不打扰） */
  userDraggingRef: React.MutableRefObject<boolean>;
  /** 滚到底部的函数 */
  scrollToEnd: (animated?: boolean) => void;
}

export interface KeyboardSync {
  /** 键盘是否可见 */
  keyboardVisible: boolean;
  /** 键盘当前高度（无键盘时为 0） */
  keyboardHeight: number;
}

export function useKeyboardSync(opts: KeyboardSyncOptions): KeyboardSync {
  const { isNearBottomRef, userDraggingRef, scrollToEnd } = opts;

  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const scrollToEndRef = useRef(scrollToEnd);
  scrollToEndRef.current = scrollToEnd;

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const timers: ReturnType<typeof setTimeout>[] = [];
    const clearTimers = () => { timers.forEach(clearTimeout); timers.length = 0; };
    const showSub = Keyboard.addListener(showEvent as any, (e: any) => {
      clearTimers();
      const h = e?.endCoordinates?.height || 0;
      setKeyboardHeight(h);
      setKeyboardVisible(true);
      // ✅ 键盘弹起 → 强制滚底（三段式），保证最新对话钉在键盘上方可见
      if (isNearBottomRef.current && !userDraggingRef.current) {
        scrollToEndRef.current(false);
        for (const delay of [120, 320]) timers.push(setTimeout(() => { if (mountedRef.current && isNearBottomRef.current && !userDraggingRef.current) scrollToEndRef.current(false); }, delay));
      }
    });

    const hideSub = Keyboard.addListener(hideEvent as any, () => {
      clearTimers();
      setKeyboardHeight(0);
      setKeyboardVisible(false);
    });

    return () => { clearTimers(); showSub.remove(); hideSub.remove(); };
  }, []);

  return { keyboardVisible, keyboardHeight };
}
