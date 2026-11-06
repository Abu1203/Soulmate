// ============================================================
// Soulmate - 磨砂半透明消息气泡
// ============================================================
import React, { useState, useCallback } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../contexts/ThemeContext';
import AgentSoulThinking from './AgentSoulThinking';
import { stripBracketAnnotations } from '../services/replyParser';
import { selectedVersion } from '../services/storyEngine';
import { messageContent } from '../services/conversationContext';
import type { AgentSoulMessage } from '../types/agentsoul';

interface AgentSoulMessageBubbleProps {
  message: AgentSoulMessage;
  avatar?: string;
  userAvatar?: string;
  onRetry?: () => void;
  onSwitchVersion?: (dir: 1 | -1) => void;
  thinkingMode?: 'auto' | 'manual' | 'off';
  onLongPress?: (messageId: string) => void;
  bodyText?: string;
  pureTextMode?: boolean;
}

export default React.memo(function AgentSoulMessageBubble({ message, avatar, userAvatar, onRetry, onSwitchVersion, thinkingMode = 'auto', onLongPress, bodyText, pureTextMode = false }: AgentSoulMessageBubbleProps) {
  const isUser = message.role === 'user';
  const { isDark, customTheme, colors } = useTheme();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      // ✅ 修复：复制当前显示的版本内容（多版本切换时"所见即所复制"）
      const text=bodyText ?? messageContent(message);
      await Clipboard.setStringAsync(pureTextMode&&!isUser?stripBracketAnnotations(text):text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* 剪贴板不可用时静默 */ }
  }, [message, bodyText, pureTextMode, isUser]);

  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const metaColor = isDark ? '#888' : '#B8A9C9';

  // 情绪主题：白色半透明毛玻璃气泡
  const isEmotion = customTheme === 'emotion';
  const aiBg = isEmotion
    ? 'rgba(255,255,255,0.12)'
    : (isDark ? 'rgba(42,42,42,0.8)' : 'rgba(255,255,255,0.7)');
  const userBg = isEmotion
    ? 'rgba(255,255,255,0.10)'
    : (isDark ? 'rgba(26,26,26,0.8)' : 'rgba(74,144,217,0.7)');
  const textColor = isDark ? '#FFFFFF' : (isUser ? '#FFFFFF' : '#1A1A1A');

  // ✅ 多版本显示：versionIndex 默认最新（总版本数），切换时显示对应旧版本
  const totalVersions = (message.versions?.length || 0) + 1;
  const currentVersion = message.versionIndex ?? totalVersions;
  const displayContent = pureTextMode&&!isUser?stripBracketAnnotations(bodyText ?? messageContent(message)):bodyText ?? messageContent(message);
  const displayThinking = pureTextMode ? undefined : selectedVersion(message).thinking;

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAI]}>
      {!isUser && (
        <View style={styles.avatarContainer}>
          {avatar ? <Image source={{ uri: avatar }} style={styles.avatar} /> :
            <View style={[styles.avatar, styles.defaultAvatar]}><Text style={styles.avatarText}>AI</Text></View>}
        </View>
      )}
      <View style={[styles.bubbleWrapper, isUser ? styles.bubbleWrapperUser : styles.bubbleWrapperAI]}>
        {message.content?.startsWith('[TRANSFER]') ? (
          <View style={[styles.transferCard, { backgroundColor: isDark ? 'rgba(74,144,217,0.15)' : 'rgba(74,144,217,0.08)', borderColor: isDark ? 'rgba(74,144,217,0.3)' : 'rgba(74,144,217,0.2)' }]}>
            {(() => {
              const parts = message.content.split('|');
              const amount = parts[1] || '0';
              const name = parts[2] || '';
              const note = parts[3] || '';
              return (
                <>
                  <Text style={styles.transferIcon}>💰</Text>
                  <Text style={[styles.transferTitle, { color: colors.primary || '#4A90D9' }]}>你向{name}转账 ¥{amount}</Text>
                  {note ? <Text style={[styles.transferNote, { color: colors.textSecondary }]}>{note}</Text> : null}
                </>
              );
            })()}
          </View>
        ) : (
        <Pressable onLongPress={() => onLongPress?.(message.id)} delayLongPress={450} style={[styles.bubble, { backgroundColor: isUser ? userBg : aiBg }, isUser ? styles.bubbleUserRadius : styles.bubbleAIRadius]}>
          {message.isStreaming && !message.content ? (
            displayThinking?.content ? null : <Text style={[styles.text, { color: textColor }]}>...</Text>
          ) : (
            <Text style={[styles.text, { color: textColor }]}>{displayContent}</Text>
          )}
        </Pressable>
        )}
        {/* 时间 + 复制 */}
        {!message.isStreaming && message.content ? (
          <View style={[styles.metaRow, isUser ? styles.metaRowUser : styles.metaRowAI]}>
            {isUser ? (
              <>
                <TouchableOpacity onPress={handleCopy} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Text style={[styles.metaText, { color: metaColor }]}>{copied ? '已复制' : '复制'}</Text>
                </TouchableOpacity>
                <Text style={[styles.metaText, { color: metaColor }]}>{fmtTime(message.timestamp)}</Text>
              </>
            ) : (
              <>
                <Text style={[styles.metaText, { color: metaColor }]}>{fmtTime(message.timestamp)}</Text>
                <TouchableOpacity onPress={handleCopy} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Text style={[styles.metaText, { color: metaColor }]}>{copied ? '已复制' : '复制'}</Text>
                </TouchableOpacity>
                {onRetry && (
                  <TouchableOpacity onPress={onRetry} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    style={{
                      width: 24, height: 24, borderRadius: 12,
                      justifyContent: 'center', alignItems: 'center',
                      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                    }}>
                    <Text style={{ fontSize: 12, opacity: 0.5 }}>🔄</Text>
                  </TouchableOpacity>
                )}
                {/* ✅ 多版本切换 < 2/3 > */}
                {onSwitchVersion && totalVersions > 1 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 4 }}>
                    <TouchableOpacity onPress={() => onSwitchVersion(-1)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} disabled={currentVersion <= 1}>
                      <Text style={{ fontSize: 13, color: currentVersion <= 1 ? '#999' : metaColor }}>‹</Text>
                    </TouchableOpacity>
                    <Text style={[styles.metaText, { color: metaColor }]}>{currentVersion}/{totalVersions}</Text>
                    <TouchableOpacity onPress={() => onSwitchVersion(1)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} disabled={currentVersion >= totalVersions}>
                      <Text style={{ fontSize: 13, color: currentVersion >= totalVersions ? '#999' : metaColor }}>›</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}
          </View>
        ) : null}
        {displayThinking?.content && (
          <AgentSoulThinking content={displayThinking.content} duration={displayThinking.duration} kind={displayThinking.kind}
            defaultCollapsed={thinkingMode !== 'auto'} isStreaming={message.isStreaming} mode="soul" thinkingMode={thinkingMode}
            keepExpanded={!!message.error} />
        )}
        {message.error && <Text style={styles.error}>⚠️ {message.error}</Text>}
        {message.error && onRetry && (
          <TouchableOpacity onPress={onRetry} style={styles.retryBtn}><Text style={styles.retryText}>重试</Text></TouchableOpacity>)}
      </View>
      {isUser && (
        <View style={styles.avatarContainer}>
          {userAvatar ? <Image source={{ uri: userAvatar }} style={styles.avatar} /> :
            <View style={[styles.avatar, styles.userAvatar]}><Text style={styles.avatarText}>我</Text></View>}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginVertical: 6, paddingHorizontal: 12 },
  rowAI: { justifyContent: 'flex-start' },
  rowUser: { justifyContent: 'flex-end' },
  avatarContainer: { marginHorizontal: 4 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  defaultAvatar: { backgroundColor: '#4A90D9', justifyContent: 'center', alignItems: 'center' },
  userAvatar: { backgroundColor: '#34C759', justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#FFF', fontSize: 13, fontWeight: '600' },
  bubbleWrapper: { flexShrink: 1 },
  bubbleWrapperAI: { alignItems: 'flex-start' },
  bubbleWrapperUser: { alignItems: 'flex-end' },
  bubble: { minWidth: 100, maxWidth: 330, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16 },
  bubbleAIRadius: { borderTopLeftRadius: 4 },
  bubbleUserRadius: { borderTopRightRadius: 4 },
  text: { fontSize: 15, lineHeight: 24 },
  metaRow: { flexDirection: 'row', gap: 8, marginTop: 4, paddingHorizontal: 2 },
  metaRowAI: { alignSelf: 'flex-start' },
  metaRowUser: { alignSelf: 'flex-end' },
  metaText: { fontSize: 13, fontWeight: '400' },
  error: { fontSize: 12, color: '#E06060', marginTop: 4 },
  retryBtn: { marginTop: 6, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: '#E0606015', borderRadius: 6, alignSelf: 'flex-start' },
  retryText: { fontSize: 12, color: '#4A90D9', fontWeight: '600' },
  transferCard: { borderRadius: 12, borderWidth: 1, padding: 12, alignItems: 'center', marginBottom: 4 },
  transferIcon: { fontSize: 24, marginBottom: 4 },
  transferTitle: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  transferNote: { fontSize: 13, marginTop: 4 },
});
