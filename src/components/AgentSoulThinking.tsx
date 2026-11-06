// ============================================================
// AgentSoul - 深度思考展示组件 v6（零崩溃：始终渲染，CSS 级隐藏）
// ============================================================
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet, LayoutAnimation,
} from 'react-native';

interface AgentSoulThinkingProps {
  content: string;
  duration: number;
  defaultCollapsed?: boolean;
  isStreaming?: boolean;
  mode?: 'soul' | 'file';
  thinkingMode?: 'auto' | 'manual' | 'off';
  /** 回复被截断/中断时保持展开（不自动收起） */
  keepExpanded?: boolean;
  kind?: 'character' | 'legacy_reasoning';
}

export default React.memo(function AgentSoulThinking({
  content,
  duration,
  defaultCollapsed = true,
  isStreaming = false,
  mode = 'soul',
  thinkingMode = 'auto',
  keepExpanded = false,
  kind,
}: AgentSoulThinkingProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const dotAnim = useRef(new Animated.Value(1)).current;
  const prevModeRef = useRef(thinkingMode);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  // ✅ v6 核心修复：off 模式不再 return null，改用 CSS 隐藏
  //    保持组件始终在树中 → 消除 FlatList item 高度突变 → 根除崩溃/跳动
  const isOff = thinkingMode === 'off';
  const hasContent = !!(content || isStreaming);

  // off ↔ 非off：仅 opacity 淡入淡出，不碰高度/布局
  useEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = thinkingMode;
    if (prev === thinkingMode) return;

    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }

    if (thinkingMode === 'off') {
      // 关掉动画，淡出
      Animated.timing(fadeAnim, { toValue: 0, duration: 100, useNativeDriver: true }).start();
    } else if (prev === 'off') {
      // 从 off 恢复：先同步折叠状态，再淡入
      fadeAnim.setValue(0);
      if (mountedRef.current) setCollapsed(thinkingMode !== 'auto');
      Animated.timing(fadeAnim, { toValue: 1, duration: 100, useNativeDriver: true }).start();
    } else {
      // auto ↔ manual 切换：只改折叠状态，用 LayoutAnimation 平滑过渡
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      if (mountedRef.current) setCollapsed(thinkingMode !== 'auto');
    }
  }, [thinkingMode]);

  // ✅ Bug13：用户手动展开 → 记录，流式结束不自动收起（声明提前，避免 TDZ 风险）
  const userExpandedRef = useRef(false);
  const toggleCollapse = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (mountedRef.current) setCollapsed(c => {
      const next = !c;
      // ✅ Bug13：用户手动展开 → 记录，流式结束不自动收起
      // ✅ 修复(写反)：next=true 表示"展开后"，此时才标记；原代码 !next 在"收起"时误标记
      userExpandedRef.current = !next;
      return next;
    });
  };

  // ✅ 自动展开模式（thinkingMode='auto'）：流式结束后思绪保持展开，不自动关闭
  //    由父组件传入（ChatScreen 根据 thinkingMode === 'auto' 设置）
  const keepExpandedAfterStream = thinkingMode === 'auto' && !isOff;

  // ✅ 修复(N6)：折叠状态同步——只在"流式刚结束"这一瞬把思绪收起，
  //    不再随 defaultCollapsed 的 false→true 常规过渡反复展开/收起（消除瞬跳）。
  //    关键：流式中保持展开让用户看到思考，结束后只收起一次，之后不再自动改动。
  // ✅ Bug13：用户手动展开过 → 流式结束不自动收起（手动状态优先，声明已在 toggleCollapse 上方）
  const wasStreamingRef = useRef(isStreaming);
  useEffect(() => {
    const justFinished = wasStreamingRef.current && !isStreaming;
    wasStreamingRef.current = isStreaming;
    if (isStreaming) {
      // 新一轮回复开始 → 重置手动标记，允许自动收起
      userExpandedRef.current = false;
    }
    if (justFinished && mountedRef.current) {
      // 流式结束 → 收起思绪（一次性，避免高度反复）；
      // 用户手动展开过、回复被截断、或 auto 模式（自动展开不关闭）则不收起
      if (!userExpandedRef.current && !keepExpanded && !keepExpandedAfterStream) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setCollapsed(true);
      }
    }
  }, [isStreaming, keepExpanded, keepExpandedAfterStream]);

  // 呼吸动画
  useEffect(() => {
    if (mode === 'soul' && isStreaming) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(dotAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
          Animated.timing(dotAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
  }, [mode, isStreaming]);

  // ✅ v6：即使 off 模式也渲染，但 CSS 隐藏（0 高度 + opacity:0 + overflow:hidden）
  //    这样组件始终占位 0 高度（off 时）或正常高度（非 off 时），不会触发 FlatList 布局重算
  if (isOff && !hasContent) {
    // off 且无内容：渲染一个 0 高度的占位容器
    return <View style={{ height: 0, overflow: 'hidden' }} />;
  }

  const isSoul = mode === 'soul';
  const source=kind==='character'?'角色旁白':kind==='legacy_reasoning'?'模型思考':'';
  const soulTitle=source?`☁️ 思绪 · ${source}`:'☁️ 思绪';
  const title = isStreaming
    ? (isSoul ? `${soulTitle}生成中…` : '⚙️ 正在处理...')
    : (isSoul ? soulTitle : `⚙️ 已深度思考（${duration}秒）`);
  const actionText = collapsed ? '展开 ▸' : '收起 ▾';

  const formattedContent = content;

  return (
    <Animated.View style={[
      styles.container,
      isSoul ? styles.containerSoul : styles.containerFile,
      { opacity: fadeAnim },
      // ✅ v6：off 模式用 CSS 压缩到 0 高度，避免布局跳变
      isOff && { maxHeight: 0, overflow: 'hidden', marginBottom: 0, paddingTop: 0, paddingBottom: 0 },
    ]}>
      {!isOff && (
        <TouchableOpacity onPress={toggleCollapse} activeOpacity={0.7} style={styles.header}>
          <View style={styles.headerLeft}>
            {isSoul && isStreaming && <Animated.Text style={[styles.breathDot, { opacity: dotAnim }]}>●</Animated.Text>}
            <Text style={[styles.title, isSoul ? styles.titleSoul : styles.titleFile]} numberOfLines={1}>{title}</Text>
          </View>
          <Text style={[styles.action, isSoul ? styles.actionSoul : styles.actionFile]}>{actionText}</Text>
        </TouchableOpacity>
      )}
      {!isOff && !collapsed && content ? (
        <View style={[styles.body, isSoul ? styles.bodySoul : styles.bodyFile]}>
          {!isSoul && <View style={styles.fileBar} />}
          {isSoul&&kind==='character'&&<Text style={[styles.content,styles.contentSoul,{fontSize:11}]}>角色内心描写</Text>}
          <Text style={[styles.content, isSoul ? styles.contentSoul : styles.contentFile]}>{formattedContent}</Text>
        </View>
      ) : null}
    </Animated.View>
  );
})

const styles = StyleSheet.create({
  container: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 6, maxWidth: 264 },
  containerSoul: { backgroundColor: 'transparent' },
  containerFile: { backgroundColor: '#F5F5F5', borderLeftWidth: 3, borderLeftColor: '#E0E0E0' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 24 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  breathDot: { fontSize: 8, marginRight: 6, color: '#B8A9C9' },
  title: { fontSize: 13, fontWeight: '500', flex: 1 },
  titleSoul: { color: '#B8A9C9' },
  titleFile: { color: '#888888' },
  action: { fontSize: 12, marginLeft: 6 },
  actionSoul: { color: '#C4B5D0' },
  actionFile: { color: '#4A90D9' },
  body: { marginTop: 6 },
  bodySoul: { borderTopWidth: 0.5, borderTopColor: '#E8E0F0' },
  bodyFile: { borderTopWidth: 0.5, borderTopColor: '#E0E0E0' },
  fileBar: { position: 'absolute', left: -17, top: 8, bottom: 8, width: 3, backgroundColor: '#D0D0D0', borderRadius: 2 },
  content: { fontSize: 13, lineHeight: 20, paddingTop: 6 },
  contentSoul: { color: '#9A8AA8' },
  contentFile: { color: '#888888' },
});
