// ============================================================
// Soulmate - 成语接龙游戏屏幕
// ============================================================
import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, Image,
  StyleSheet, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { useAgentSoul } from '../contexts/AgentSoulContext';
import { createIdiomChainState, playerIdiomTurn, aiIdiomTurn } from '../services/gameService';
import type { IdiomChainState } from '../types/game';

export default function GameIdiomChainScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { addMemoryToConversation, addSystemMessageTo } = useAgentSoul();
  const { aiName, aiAvatar, userName, userAvatar, conversationId } = route.params || {};

  const [gameState, setGameState] = useState<IdiomChainState>(createIdiomChainState);
  const [inputText, setInputText] = useState('');
  const [aiMsg, setAiMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [gameOver, setGameOver] = useState(false);
  const [gameResult, setGameResult] = useState('');
  const [errorCount, setErrorCount] = useState(0);
  const MAX_ERRORS = 3;

  const lastIdiom = gameState.history[gameState.history.length - 1];

  const handleConfirm = useCallback(() => {
    const word = inputText.trim();
    if (!word) return;

    const { state, error } = playerIdiomTurn(gameState, word);
    if (error) {
      setErrorMsg(error);
      setInputText(''); // ✅ 修复：接错清空输入，避免同词连点
      // ✅ 修复：累计错误次数，3次判负
      const newCount = errorCount + 1;
      setErrorCount(newCount);
      if (newCount >= MAX_ERRORS) {
        setGameOver(true);
        setGameResult(`😢 你输了！连续 ${MAX_ERRORS} 次接错`);
        setAiMsg('接龙结束，下次加油~');
        addMemoryToConversation(
          conversationId,
          `和${aiName || 'AI'}玩成语接龙，用户输了（${gameState.history.length}个成语后接错${MAX_ERRORS}次）`,
        );
        addSystemMessageTo(conversationId, `[游戏] 😢 成语接龙输了，连续接错 ${MAX_ERRORS} 次`);
        return;
      }
      return;
    }

    setErrorMsg('');
    setErrorCount(0); // 接对时清零
    setGameState(state);
    setInputText('');

    // AI 回合
    const { state: aiState, aiIdiom: aiWord, cannotContinue } = aiIdiomTurn(state);

    if (cannotContinue) {
      setGameState(aiState);
      setAiMsg('🤔 我接不出来了...');
      setGameOver(true);
      setGameResult(`🎉 你赢了！${aiName || 'AI'} 无法继续接龙`);
      addMemoryToConversation(
        conversationId,
        `和${aiName || 'AI'}玩成语接龙，用户赢了（${aiState.history.length}个成语）`,
      );
      addSystemMessageTo(conversationId, `[游戏] 🎉 成语接龙赢了！接了 ${aiState.history.length} 个成语`);
    } else {
      setGameState(aiState);
      setAiMsg(`${aiWord}`);
    }
  }, [inputText, gameState, errorCount]);

  const handleHint = useCallback(() => {
    setAiMsg(`提示：需要以"${gameState.currentStarter}"开头，比如可以试试常见成语哦~`);
  }, [gameState.currentStarter]);

  const handleReset = useCallback(() => {
    setGameState(createIdiomChainState());
    setInputText('');
    setAiMsg('');
    setErrorMsg('');
    setGameOver(false);
    setGameResult('');
    setErrorCount(0);
  }, []);

  const handleGiveUp = useCallback(() => {
    setGameOver(true);
    setGameResult('😢 你认输了');
    setAiMsg('下次再来挑战吧~');
    addMemoryToConversation(
      conversationId,
      `和${aiName || 'AI'}玩成语接龙，用户认输（${gameState.history.length}个成语）`,
    );
    addSystemMessageTo(conversationId, `[游戏] 🏳️ 成语接龙认输了（${gameState.history.length}个成语）`);
  }, [conversationId, gameState.history.length]);

  const playerHistory = gameState.history.filter(h => h.by === 'player');
  const aiHistory = gameState.history.filter(h => h.by === 'ai');

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* 顶部导航 */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: colors.primary }]}>← 返回</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>成语接龙</Text>
        <View style={styles.backBtn} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* AI 信息 */}
        <View style={styles.playerRow}>
          <View style={[styles.avatar, { backgroundColor: colors.primaryLight }]}>
            {aiAvatar ? (
              <Image source={{ uri: aiAvatar }} style={styles.avatarImg} />
            ) : (
              <Text style={styles.avatarText}>🤖</Text>
            )}
          </View>
          <Text style={[styles.playerName, { color: '#4A90D9' }]}>{aiName || 'AI'}</Text>
        </View>

        {/* 游戏区域 */}
        <View style={[styles.gameArea, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={styles.gameIcon}>📝</Text>

          {/* 当前状态 */}
          <View style={[styles.statusBox, { backgroundColor: colors.surface }]}>
            <Text style={[styles.statusLabel, { color: colors.textSecondary }]}>
              AI 出了：<Text style={[styles.idiomHighlight, { color: colors.primary }]}>{aiHistory[aiHistory.length - 1]?.word || lastIdiom?.word}</Text>
            </Text>
            <Text style={[styles.statusLabel, { color: colors.textSecondary }]}>
              需要接：<Text style={[styles.charHighlight, { color: colors.warning }]}>"{gameState.currentStarter}"</Text> 开头的成语
            </Text>
          </View>

          {/* AI 消息 */}
          {aiMsg ? (
            <View style={[styles.aiBubble, { backgroundColor: colors.surface }]}>
              <Text style={[styles.aiBubbleText, { color: colors.text }]}>💬 {aiMsg}</Text>
            </View>
          ) : null}

          {/* 错误提示 */}
          {errorMsg ? (
            <Text style={[styles.errorText, { color: colors.error }]}>{errorMsg}</Text>
          ) : null}
          {errorCount > 0 && !gameOver && (
            <Text style={[styles.errorText, { color: colors.warning }]}>
              接错 {errorCount}/{MAX_ERRORS} 次（满 {MAX_ERRORS} 次判负）
            </Text>
          )}

          {/* 游戏结果 */}
          {gameResult ? (
            <Text style={[styles.resultText, { color: colors.success }]}>{gameResult}</Text>
          ) : null}

          {/* 历史记录 */}
          <ScrollView style={styles.historyScroll} contentContainerStyle={styles.historyContent}>
            {gameState.history.map((entry, i) => (
              <View key={i} style={[styles.historyEntry, {
                backgroundColor: entry.by === 'ai'
                  ? (isDark ? '#1A3A5C20' : '#EBF5FF')
                  : (isDark ? '#1A3C1A20' : '#F0FFF4'),
                borderColor: entry.by === 'ai' ? colors.primaryLight : colors.success,
              }]}>
                <Text style={[styles.historyBy, { color: colors.textTertiary }]}>
                  {entry.by === 'ai' ? aiName || 'AI' : userName || '我'}
                </Text>
                <Text style={[styles.historyWord, { color: colors.text }]}>{entry.word}</Text>
              </View>
            ))}
          </ScrollView>

          {/* 输入区 */}
          {!gameOver && (
            <View style={[styles.inputRow, { backgroundColor: colors.surface, borderColor: colors.separator }]}>
              <TextInput
                style={[styles.textInput, { color: colors.text }]}
                value={inputText}
                onChangeText={setInputText}
                placeholder="输入四字成语"
                placeholderTextColor={colors.textTertiary}
                maxLength={4}
              />
            </View>
          )}

          {/* 按钮 */}
          <View style={styles.btnRow}>
            {!gameOver ? (
              <>
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: colors.primary }]}
                  onPress={handleConfirm}
                  activeOpacity={0.7}
                >
                  <Text style={styles.btnText}>确定</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: colors.warning }]}
                  onPress={handleHint}
                  activeOpacity={0.7}
                >
                  <Text style={styles.btnText}>提示</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: colors.error }]}
                  onPress={handleGiveUp}
                  activeOpacity={0.7}
                >
                  <Text style={styles.btnText}>认输</Text>
                </TouchableOpacity>
              </>
            ) : null}
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: colors.surfaceSecondary }]}
              onPress={handleReset}
              activeOpacity={0.7}
            >
              <Text style={[styles.btnText, { color: colors.text }]}>重新开始</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 用户信息 */}
        <View style={styles.playerRow}>
          <View style={[styles.avatar, { backgroundColor: colors.success }]}>
            {userAvatar ? (
              <Image source={{ uri: userAvatar }} style={styles.avatarImg} />
            ) : (
              <Text style={styles.avatarText}>😎</Text>
            )}
          </View>
          <Text style={[styles.playerName, { color: '#34C759' }]}>{userName || '我'}</Text>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 10,
  },
  backBtn: { padding: 4, minWidth: 60 },
  backText: { fontSize: 15 },
  title: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  playerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, gap: 8,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { fontSize: 20 },
  avatarImg: { width: 40, height: 40, borderRadius: 20 },
  playerName: { fontSize: 14, fontWeight: '500' },
  gameArea: {
    flex: 1, marginHorizontal: 16, borderRadius: 12,
    padding: 16, alignItems: 'center', gap: 10,
  },
  gameIcon: { fontSize: 40 },
  statusBox: {
    width: '100%', borderRadius: 10, padding: 12,
    alignItems: 'center', gap: 4,
  },
  statusLabel: { fontSize: 14 },
  idiomHighlight: { fontSize: 20, fontWeight: '700' },
  charHighlight: { fontSize: 18, fontWeight: '700' },
  aiBubble: {
    width: '100%', borderRadius: 10, padding: 12,
  },
  aiBubbleText: { fontSize: 15, lineHeight: 22 },
  errorText: { fontSize: 13, fontWeight: '500' },
  resultText: { fontSize: 16, fontWeight: '700', marginTop: 4 },
  historyScroll: { width: '100%', maxHeight: 180 },
  historyContent: { gap: 6, paddingBottom: 4 },
  historyEntry: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6,
  },
  historyBy: { fontSize: 11, minWidth: 30 },
  historyWord: { fontSize: 16, fontWeight: '600' },
  inputRow: {
    width: '80%', borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  textInput: { fontSize: 18, textAlign: 'center', paddingVertical: 2 },
  btnRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center' },
  btn: {
    paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 10, alignItems: 'center',
  },
  btnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
});
