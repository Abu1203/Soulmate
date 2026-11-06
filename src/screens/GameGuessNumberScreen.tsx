// ============================================================
// Soulmate - 猜数字游戏屏幕
// ============================================================
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, Image,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { useAgentSoul } from '../contexts/AgentSoulContext';
import { createGuessNumberState, makeGuess } from '../services/gameService';
import type { GuessNumberState } from '../types/game';

export default function GameGuessNumberScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { addMemoryToConversation, addSystemMessageTo } = useAgentSoul();
  const { aiName, aiAvatar, userName, userAvatar, conversationId } = route.params || {};

  const [gameState, setGameState] = useState<GuessNumberState>(createGuessNumberState);
  const [inputText, setInputText] = useState('');
  const [aiHint, setAiHint] = useState('我想了一个 1-100 的数字，猜猜看？');
  const [gameOver, setGameOver] = useState(false);
  const submittingRef = useRef(false);
  const [shake, setShake] = useState(false);

  const handleGuess = useCallback(() => {
    if (gameOver) return; // ✅ 防御：gameOver 时忽略输入
    if (submittingRef.current) return; // ✅ 修复：双击防重
    submittingRef.current = true;
    setTimeout(() => { submittingRef.current = false; }, 50);
    const num = parseInt(inputText, 10);
    if (isNaN(num) || num < 1 || num > 100) {
      setAiHint('请输入 1-100 之间的数字哦~');
      return;
    }

    const { state, hint } = makeGuess(gameState, num);
    setGameState(state);

    if (hint === 'correct') {
      setAiHint(`🎉 恭喜你猜对了！数字就是 ${state.secret}，你一共猜了 ${state.tries} 次！`);
      setGameOver(true);
      addMemoryToConversation(
        conversationId,
        `和${aiName || 'AI'}玩猜数字，赢了（${state.tries}次猜中${state.secret}）`,
      );
      addSystemMessageTo(conversationId, `[游戏] 🎉 猜数字赢了！答案是 ${state.secret}，用了 ${state.tries} 次`);
    } else if (hint === 'bigger') {
      setAiHint(`小了，再大一点。（第 ${state.tries} 次）`);
    } else {
      setAiHint(`大了，再小一点。（第 ${state.tries} 次）`);
    }

    if (state.tries >= state.maxTries && hint !== 'correct') {
      setAiHint(`😢 很遗憾，${state.maxTries} 次机会用完了！答案是 ${state.secret}`);
      setGameOver(true);
      addMemoryToConversation(
        conversationId,
        `和${aiName || 'AI'}玩猜数字，输了（答案是${state.secret}）`,
      );
      addSystemMessageTo(conversationId, `[游戏] 😢 猜数字输了，答案是 ${state.secret}`);
    }

    setInputText('');
  }, [inputText, gameState]);

  const handleReset = useCallback(() => {
    setGameState(createGuessNumberState());
    setAiHint('我想了一个 1-100 的数字，猜猜看？');
    setGameOver(false);
    setInputText('');
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* 顶部导航 */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: colors.primary }]}>← 返回</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>猜数字</Text>
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
          <Text style={[styles.gameIcon]}>🔢</Text>
          <Text style={[styles.gameLabel, { color: colors.textSecondary }]}>
            范围：{gameState.min} - {gameState.max}
          </Text>
          <Text style={[styles.gameLabel, { color: colors.textSecondary }]}>
            已猜次数：{gameState.tries}
          </Text>

          {/* AI 提示气泡 */}
          <View style={[styles.hintBubble, { backgroundColor: colors.surface }]}>
            <Text style={[styles.hintText, { color: colors.text }]}>💬 {aiHint}</Text>
          </View>

          {!gameOver && (
              <View style={[styles.inputRow, { backgroundColor: colors.surface, borderColor: colors.separator }]}>
              <TextInput
                style={[styles.numberInput, { color: colors.text }]}
                value={inputText}
                onChangeText={setInputText}
                keyboardType="number-pad"
                placeholder="输入数字"
                placeholderTextColor={colors.textTertiary}
                maxLength={3}
              />
            </View>
          )}

          {/* 按钮 */}
          <View style={styles.btnRow}>
            {!gameOver ? (
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: colors.primary }]}
                onPress={handleGuess}
                activeOpacity={0.7}
              >
                <Text style={styles.btnText}>确定</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: colors.surfaceSecondary }]}
              onPress={handleReset}
              activeOpacity={0.7}
            >
              <Text style={[styles.btnText, { color: colors.text }]}>重新开始</Text>
            </TouchableOpacity>
          </View>

          {/* 猜测历史 */}
          {gameState.guesses.length > 0 && (
            <View style={styles.historyRow}>
              {gameState.guesses.map((g, i) => (
                <Text key={i} style={[styles.historyItem, {
                  color: g.hint === 'correct' ? colors.success
                    : g.hint === 'bigger' ? colors.warning : colors.info,
                }]}>
                  {g.num}{g.hint === 'correct' ? '✓' : g.hint === 'bigger' ? '↑' : '↓'}
                </Text>
              ))}
            </View>
          )}
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
    paddingVertical: 12, gap: 8,
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
    padding: 20, alignItems: 'center', justifyContent: 'center',
    gap: 12,
  },
  gameIcon: { fontSize: 48 },
  gameLabel: { fontSize: 13 },
  hintBubble: {
    width: '100%', borderRadius: 10, padding: 14,
    marginVertical: 8,
  },
  hintText: { fontSize: 15, lineHeight: 22 },
  inputRow: {
    width: 120, borderRadius: 10, borderWidth: 1,
    alignItems: 'center', paddingVertical: 4,
  },
  numberInput: {
    fontSize: 28, fontWeight: '700', textAlign: 'center',
    width: '100%', paddingVertical: 4,
  },
  btnRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  btn: {
    paddingHorizontal: 24, paddingVertical: 10,
    borderRadius: 10, alignItems: 'center',
  },
  btnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  historyRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    justifyContent: 'center', marginTop: 8,
  },
  historyItem: { fontSize: 13, fontWeight: '600' },
});
