// ============================================================
// Soulmate - 二十问游戏屏幕
// ============================================================
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, Image,
  StyleSheet, KeyboardAvoidingView, Platform, ScrollView, } from 'react-native';
import { AppAlert } from '../services/appDialog';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { useAgentSoul } from '../contexts/AgentSoulContext';
import { createTwentyQuestionsState, askTwentyQ } from '../services/gameService';
import type { TwentyQuestionsState } from '../types/game';

export default function GameTwentyQuestionsScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { addMemoryToConversation, addSystemMessageTo } = useAgentSoul();
  const { aiName, aiAvatar, userName, userAvatar, conversationId } = route.params || {};

  const [gameState, setGameState] = useState<TwentyQuestionsState>(createTwentyQuestionsState);
  const [inputText, setInputText] = useState('');
  const [aiMsg, setAiMsg] = useState('我想好了一个东西，你开始问吧！');
  const [gameOver, setGameOver] = useState(false);
  const [gameResult, setGameResult] = useState('');
  const [guessingMode, setGuessingMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const handleAsk = useCallback(async () => {
    const q = inputText.trim();
    if (!q || request.current || gameOver) return;

    if (guessingMode) {
      // ✅ 直接猜测：宽容匹配（去空格/标点/大小写），"是猫吗""猫"都算猜中
      const norm = (s: string) => s.replace(/[\s吗呢吧啊？?！!是]/g, '').toLowerCase();
      if (!/(不是|并非|没有|不会)/.test(q) && norm(q) === norm(gameState.answer)) {
        setAiMsg(`🎉 答对了！答案就是"${gameState.answer}"！你用了 ${gameState.totalQuestions - gameState.questionsLeft} 个问题。`);
        setGameOver(true);
        setGameResult('win');
        addMemoryToConversation(
          conversationId,
          `和${aiName || 'AI'}玩二十问，赢了（猜出"${gameState.answer}"）`,
        );
        addSystemMessageTo(conversationId, `[游戏] 🎉 二十问赢了！答案是"${gameState.answer}"`);
      } else {
        setAiMsg(gameState.questionsLeft <= 0 ? `这次没猜中，答案是${gameState.answer}。` : `不对哦，继续加油！`);
        if (gameState.questionsLeft <= 0) { setGameOver(true); setGameResult('lose'); }
      }
      setInputText('');
      setGuessingMode(false);
      return;
    }

    if (gameState.questionsLeft <= 0) { setGuessingMode(true); setAiMsg('问题已用完，请直接猜答案。'); return; }
    const controller = new AbortController(); request.current = controller; setBusy(true);
    try {
    const { state, result } = await askTwentyQ(gameState, q, controller.signal);
    if (controller.signal.aborted) return;
    setGameState(state); setInputText('');

    const answerEmoji = result.answer === 'yes' ? '✅ 是' : result.answer === 'no' ? '❌ 不是' : '🤔 不确定';
    setAiMsg(`${answerEmoji}`);

    // 检查是否已猜对（问题中包含答案）
    const solved = result.answer === 'yes' && q.replace(/[\s？?吗是]/g, '') === state.answer;
    if (solved) {
      setAiMsg(`🎉 答对了！答案就是"${state.answer}"！`);
      setGameOver(true);
      setGameResult('win');
      addMemoryToConversation(
        conversationId,
        `和${aiName || 'AI'}玩二十问，赢了（猜出"${state.answer}"）`,
      );
      addSystemMessageTo(conversationId, `[游戏] 🎉 二十问赢了！答案是"${state.answer}"`);
    }
    if (state.questionsLeft === 0 && !solved) { setGuessingMode(true); setAiMsg(`${answerEmoji}。20个问题已回答，请直接猜答案。`); }
    } catch (e) { if (!controller.signal.aborted) AppAlert.alert('提问未完成', e instanceof Error ? e.message : '请重试'); }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  }, [inputText, gameState, guessingMode, gameOver]);

  const handleDirectGuess = useCallback(() => {
    setGuessingMode(true);
    setInputText('');
    setAiMsg('直接猜吧，你觉得是什么？');
  }, []);

  const handleReset = useCallback(() => {
    request.current?.abort(); request.current = null; setBusy(false);
    setGameState(createTwentyQuestionsState());
    setInputText('');
    setAiMsg('我想好了一个东西，你开始问吧！');
    setGameOver(false);
    setGameResult('');
    setGuessingMode(false);
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* 顶部导航 */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: colors.primary }]}>← 返回</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>二十问</Text>
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
          <Text style={styles.gameIcon}>❓</Text>

          {/* 问题计数 */}
          <View style={[styles.countBox, { backgroundColor: colors.surface }]}>
            <Text style={[styles.countText, { color: colors.text }]}>
              剩余问题：{gameState.questionsLeft} / {gameState.totalQuestions}
            </Text>
            <View style={[styles.progressBar, { backgroundColor: colors.surfaceSecondary }]}>
              <View style={[styles.progressFill, {
                backgroundColor: colors.primary,
                width: `${(gameState.questionsLeft / gameState.totalQuestions) * 100}%`,
              }]} />
            </View>
          </View>

          {/* AI 消息 */}
          <View style={[styles.aiBubble, { backgroundColor: colors.surface }]}>
            <Text style={[styles.aiBubbleText, { color: colors.text }]}>💬 {aiMsg}</Text>
          </View>

          {/* 问答历史 */}
          <ScrollView style={styles.historyScroll} contentContainerStyle={styles.historyContent}>
            {gameState.history.map((entry, i) => (
              <View key={i} style={[styles.qaEntry, { borderColor: colors.separator }]}>
                <Text style={[styles.qaQuestion, { color: colors.text }]}>
                  🙋 Q{i + 1}: {entry.question}
                </Text>
                <Text style={[styles.qaAnswer, {
                  color: entry.answer === 'yes' ? colors.success
                    : entry.answer === 'no' ? colors.error
                    : colors.warning,
                }]}>
                  {entry.answer === 'yes' ? '✅ 是' : entry.answer === 'no' ? '❌ 不是' : '🤔 不确定'}
                </Text>
              </View>
            ))}
          </ScrollView>

          {/* 游戏结果 */}
          {gameResult ? (
            <Text style={[styles.resultText, {
              color: gameResult === 'win' ? colors.success : colors.error,
            }]}>
              {gameResult === 'win' ? '🎉 你赢了！' : `答案是"${gameState.answer}"`}
            </Text>
          ) : null}

          {/* 输入区 */}
          {!gameOver && (
            <View style={[styles.inputRow, { backgroundColor: colors.surface, borderColor: colors.separator }]}>
              <TextInput
                style={[styles.textInput, { color: colors.text }]}
                value={inputText}
                onChangeText={setInputText}
                placeholder={guessingMode ? '输入你的猜测...' : '输入你的问题...'}
                placeholderTextColor={colors.textTertiary}
                maxLength={50}
              />
            </View>
          )}

          {/* 按钮 */}
          <View style={styles.btnRow}>
            {!gameOver ? (
              <>
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: colors.primary }]}
                  disabled={busy}
                  onPress={handleAsk}
                  activeOpacity={0.7}
                >
                  <Text style={styles.btnText}>{guessingMode ? '确认猜测' : '确定'}</Text>
                </TouchableOpacity>
                {!guessingMode && (
                  <TouchableOpacity
                    style={[styles.btn, { backgroundColor: colors.warning }]}
                    disabled={busy}
                    onPress={handleDirectGuess}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.btnText}>直接猜</Text>
                  </TouchableOpacity>
                )}
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
  countBox: { width: '100%', borderRadius: 10, padding: 12, gap: 8 },
  countText: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  progressBar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  aiBubble: {
    width: '100%', borderRadius: 10, padding: 12,
  },
  aiBubbleText: { fontSize: 15, lineHeight: 22 },
  historyScroll: { width: '100%', maxHeight: 200 },
  historyContent: { gap: 8, paddingBottom: 4 },
  qaEntry: {
    borderRadius: 8, borderWidth: 0.5, padding: 10,
  },
  qaQuestion: { fontSize: 13, marginBottom: 2 },
  qaAnswer: { fontSize: 12, fontWeight: '600' },
  resultText: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  inputRow: {
    width: '90%', borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  textInput: { fontSize: 15, textAlign: 'center' },
  btnRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center' },
  btn: {
    paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 10, alignItems: 'center',
  },
  btnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
});
