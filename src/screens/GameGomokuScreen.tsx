// ============================================================
// Soulmate - 五子棋游戏屏幕
// ============================================================
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Image, StyleSheet, Dimensions, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { useAgentSoul } from '../contexts/AgentSoulContext';
import {
  findBestMove, checkWin, isBoardFull,
} from '../services/gameService';
import type { GomokuDifficulty } from '../services/gameService';
import { BOARD_SIZE, createEmptyBoard } from '../types/game';
import type { GomokuState } from '../types/game';

const SCREEN_WIDTH = Dimensions.get('window').width;
const BOARD_PADDING = 16;
const BOARD_WIDTH = SCREEN_WIDTH - BOARD_PADDING * 2 - 32; // margin + padding
const CELL_SIZE = Math.floor(BOARD_WIDTH / (BOARD_SIZE + 1));

export default function GameGomokuScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { addMemoryToConversation, addSystemMessageTo } = useAgentSoul();
  const { aiName, aiAvatar, userName, userAvatar, conversationId } = route.params || {};

  const [board, setBoard] = useState<string[][]>(createEmptyBoard);
  const [turn, setTurn] = useState<'player' | 'ai'>('player');
  const [aiMsg, setAiMsg] = useState(`游戏开始，你执黑先行 ⚫`);
  const [gameOver, setGameOver] = useState(false);
  const gameOverRef = useRef(false);
  gameOverRef.current = gameOver;
  const [winner, setWinner] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<{ row: number; col: number } | null>(null);
  const [difficulty, setDifficulty] = useState<GomokuDifficulty>('medium');
  const [showDifficultyPicker, setShowDifficultyPicker] = useState(true);
  const [gameStarted, setGameStarted] = useState(false);
  const moveHistoryRef = useRef<Array<{ row: number; col: number; by: 'player' | 'ai' }>>([]);
  const boardRef = useRef(board);
  boardRef.current = board;
  const turnRef = useRef(turn);
  turnRef.current = turn;

  const aiThinkingRef = useRef(false);
  const mountedRef = useRef(true);
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelAiMove = useCallback(() => { if (aiTimerRef.current) clearTimeout(aiTimerRef.current); aiTimerRef.current = null; aiThinkingRef.current = false; }, []);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; cancelAiMove(); }; }, [cancelAiMove]);

  const makeAiMove = useCallback((currentBoard: string[][]) => {
    if (aiThinkingRef.current) return;
    aiThinkingRef.current = true;

    // 延迟模拟AI思考
    aiTimerRef.current = setTimeout(() => {
      aiTimerRef.current = null;
      // ✅ 修复：重置/认输后 AI 不再落子（gameOver 或 thinking 已被复位则放弃）
      if (!mountedRef.current || !aiThinkingRef.current || gameOverRef.current) return;
      const move = findBestMove(currentBoard, '○', '●', difficulty);
      if (!move) {
        aiThinkingRef.current = false;
        return;
      }

      const newBoard = currentBoard.map(row => [...row]);
      newBoard[move.row][move.col] = '○';

      const win = checkWin(newBoard);
      const full = isBoardFull(newBoard);

      setBoard(newBoard);
      setTurn('player');
      setLastMove(move);
      moveHistoryRef.current = [...moveHistoryRef.current, { ...move, by: 'ai' }];

      if (win === '○') {
        setGameOver(true);
        setWinner('ai');
        setAiMsg('我赢了！承让承让~ 🎉');
        addMemoryToConversation(
          conversationId,
          `和${aiName || 'AI'}玩五子棋，${aiName || 'AI'}赢了`,
        );
        addSystemMessageTo(conversationId, `[游戏] 😢 五子棋输了`);
      } else if (full) {
        setGameOver(true);
        setWinner('draw');
        setAiMsg('棋盘已满，平局！');
        addMemoryToConversation(
          conversationId,
          `和${aiName || 'AI'}玩五子棋，平局`,
        );
        addSystemMessageTo(conversationId, `[游戏] 🤝 五子棋平局`);
      } else {
        setAiMsg('轮到你了 ⚫');
      }

      aiThinkingRef.current = false;
    }, 400);
  }, [conversationId, aiName, addMemoryToConversation, addSystemMessageTo, difficulty]);

  const handleCellPress = useCallback((row: number, col: number) => {
    if (gameOver) return;
    if (turn !== 'player') return;
    if (board[row][col] !== '.') return;
    if (aiThinkingRef.current) return;

    if (!gameStarted) setGameStarted(true);

    const newBoard = board.map(r => [...r]);
    newBoard[row][col] = '●';

    const win = checkWin(newBoard);
    const full = isBoardFull(newBoard);

    setBoard(newBoard);
    setLastMove({ row, col });
    moveHistoryRef.current = [...moveHistoryRef.current, { row, col, by: 'player' }];

    if (win === '●') {
      setGameOver(true);
      setWinner('player');
      setAiMsg('🎉 恭喜你赢了！');
      addMemoryToConversation(
        conversationId,
        `和${aiName || 'AI'}玩五子棋，用户赢了`,
      );
      addSystemMessageTo(conversationId, `[游戏] 🎉 五子棋赢了！`);
      return;
    }
    if (full) {
      setGameOver(true);
      setWinner('draw');
      setAiMsg('棋盘已满，平局！');
      addMemoryToConversation(
        conversationId,
        `和${aiName || 'AI'}玩五子棋，平局`,
      );
      addSystemMessageTo(conversationId, `[游戏] 🤝 五子棋平局`);
      return;
    }

    setTurn('ai');
    setAiMsg('AI 思考中...');
    makeAiMove(newBoard);
  }, [board, turn, gameOver, makeAiMove]);

  const handleReset = useCallback(() => {
    cancelAiMove(); gameOverRef.current = false;
    setBoard(createEmptyBoard());
    setTurn('player');
    setAiMsg('游戏开始，你执黑先行 ⚫');
    setGameOver(false);
    setWinner(null);
    setLastMove(null);
    setGameStarted(false);
    setShowDifficultyPicker(true);
    moveHistoryRef.current = [];
  }, []);

  const handleUndo = useCallback(() => {
    if (gameOver || turn !== 'player') return;
    const history = moveHistoryRef.current;
    if (history.length < 2) return; // 至少撤回AI+玩家各一步

    // 撤回两步（AI一步 + 玩家一步）
    const newHistory = history.slice(0, -2);
    const newBoard = createEmptyBoard();
    for (const m of newHistory) {
      newBoard[m.row][m.col] = m.by === 'player' ? '●' : '○';
    }

    aiThinkingRef.current = false;
    setBoard(newBoard);
    setTurn('player');
    setLastMove(newHistory.length > 0 ? { row: newHistory[newHistory.length - 1].row, col: newHistory[newHistory.length - 1].col } : null);
    moveHistoryRef.current = newHistory;
    setAiMsg('已撤回，轮到你了 ⚫');
  }, [gameOver, turn]);

  const handleGiveUp = useCallback(() => {
    cancelAiMove(); gameOverRef.current = true;
    setGameOver(true);
    setWinner('ai');
    setAiMsg('你认输了。下次加油！💪');
    addMemoryToConversation(
      conversationId,
      `和${aiName || 'AI'}玩五子棋，用户认输`,
    );
    addSystemMessageTo(conversationId, `[游戏] 🏳️ 五子棋认输了`);
  }, [conversationId, aiName, addMemoryToConversation, addSystemMessageTo]);

  const isLastMove = (r: number, c: number) =>
    lastMove?.row === r && lastMove?.col === c;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* 顶部导航 */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: colors.primary }]}>← 返回</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>五子棋</Text>
        <View style={styles.backBtn} />
      </View>

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
        <Text style={[styles.pieceIndicator, { color: colors.textSecondary }]}>执白 ○</Text>
      </View>

      {/* 难度选择 — 游戏未开始或重置后显示 */}
      {(showDifficultyPicker || !gameStarted) && !gameOver && moveHistoryRef.current.length === 0 && (
        <View style={[styles.difficultyRow, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }]}>
          <Text style={[styles.difficultyLabel, { color: colors.textSecondary }]}>难度：</Text>
          {(['easy', 'medium', 'hard'] as GomokuDifficulty[]).map(d => {
            const labels: Record<GomokuDifficulty, string> = { easy: '😊 简单', medium: '🤔 中等', hard: '😈 困难' };
            const isActive = d === difficulty;
            return (
              <TouchableOpacity
                key={d}
                onPress={() => setDifficulty(d)}
                style={[styles.difficultyBtn, isActive && {
                  backgroundColor: isDark ? 'rgba(74,144,217,0.25)' : 'rgba(74,144,217,0.15)',
                  borderColor: colors.primary,
                }, {
                  borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                }]}>
                <Text style={[styles.difficultyBtnText, {
                  color: isActive ? colors.primary : colors.textSecondary,
                  fontWeight: isActive ? '600' : '400',
                }]}>{labels[d]}</Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            onPress={() => setShowDifficultyPicker(false)}
            style={{ padding: 4 }}>
            <Text style={{ color: colors.primary, fontSize: 14 }}>开始</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 游戏区域 */}
      <ScrollView style={styles.gameScroll} contentContainerStyle={styles.gameContent}>
        <View style={[styles.gameArea, { backgroundColor: colors.surfaceSecondary }]}>
          {/* 棋盘 */}
          <View style={[styles.board, { backgroundColor: isDark ? '#2A2018' : '#DEB887' }]}>
            {board.map((row, ri) => (
              <View key={ri} style={styles.boardRow}>
                {row.map((cell, ci) => {
                  const isLast = isLastMove(ri, ci);
                  return (
                    <TouchableOpacity
                      key={ci}
                      style={[
                        styles.cell,
                        { width: CELL_SIZE, height: CELL_SIZE },
                      ]}
                      onPress={() => handleCellPress(ri, ci)}
                      activeOpacity={0.7}
                    >
                      {/* 网格线 */}
                      <View style={[
                        styles.gridDot,
                        { backgroundColor: isDark ? '#5A4A3A' : '#8B7355' },
                      ]} />
                      {/* 棋子 */}
                      {cell !== '.' && (
                        <View style={[
                          styles.piece,
                          {
                            backgroundColor: cell === '●' ? '#1A1A1A' : '#F0F0F0',
                            borderColor: cell === '●' ? '#333' : '#CCC',
                          },
                          isLast && styles.lastMoveBorder,
                        ]}>
                          {isLast && (
                            <View style={[
                              styles.lastMoveDot,
                              { backgroundColor: cell === '●' ? '#FFF' : '#333' },
                            ]} />
                          )}
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>

          {/* 状态信息 */}
          <View style={[styles.statusBox, { backgroundColor: colors.surface }]}>
            <Text style={[styles.statusText, { color: colors.text }]}>
              {aiMsg}
            </Text>
            {winner && (
              <Text style={[styles.winnerText, {
                color: winner === 'player' ? colors.success : winner === 'ai' ? colors.error : colors.warning,
              }]}>
                {winner === 'player' ? '🏆 你赢了！' : winner === 'ai' ? `😔 ${aiName || 'AI'} 赢了` : '🤝 平局'}
              </Text>
            )}
          </View>

          {/* 按钮 */}
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: colors.surfaceSecondary }]}
              onPress={handleReset}
              activeOpacity={0.7}
            >
              <Text style={[styles.btnText, { color: colors.text }]}>重新开始</Text>
            </TouchableOpacity>
            {!gameOver && turn === 'player' && moveHistoryRef.current.length >= 2 && (
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: colors.warning }]}
                onPress={handleUndo}
                activeOpacity={0.7}
              >
                <Text style={styles.btnText}>悔棋</Text>
              </TouchableOpacity>
            )}
            {!gameOver && (
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: colors.error }]}
                onPress={handleGiveUp}
                activeOpacity={0.7}
              >
                <Text style={styles.btnText}>认输</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </ScrollView>

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
        <Text style={[styles.pieceIndicator, { color: colors.textSecondary }]}>执黑 ●</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 10,
  },
  backBtn: { padding: 4, minWidth: 60 },
  backText: { fontSize: 15 },
  title: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  playerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, gap: 8,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { fontSize: 20 },
  avatarImg: { width: 40, height: 40, borderRadius: 20 },
  playerName: { fontSize: 14, fontWeight: '500' },
  pieceIndicator: { fontSize: 12 },
  gameScroll: { flex: 1 },
  gameContent: { paddingBottom: 8 },
  gameArea: {
    marginHorizontal: 16, borderRadius: 12,
    padding: 12, alignItems: 'center', gap: 12,
  },
  board: {
    borderRadius: 8, padding: CELL_SIZE / 2,
  },
  boardRow: { flexDirection: 'row' },
  cell: {
    justifyContent: 'center', alignItems: 'center',
    position: 'relative',
  },
  gridDot: {
    position: 'absolute',
    width: 2, height: 2, borderRadius: 1,
  },
  piece: {
    width: CELL_SIZE - 4, height: CELL_SIZE - 4,
    borderRadius: (CELL_SIZE - 4) / 2,
    borderWidth: 1.5,
    justifyContent: 'center', alignItems: 'center',
    elevation: 2,
  },
  lastMoveBorder: {
    borderWidth: 2,
  },
  lastMoveDot: {
    width: 6, height: 6, borderRadius: 3,
  },
  statusBox: {
    width: '100%', borderRadius: 10, padding: 12,
    alignItems: 'center', gap: 4,
  },
  statusText: { fontSize: 14, textAlign: 'center' },
  winnerText: { fontSize: 18, fontWeight: '700' },
  btnRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center' },
  btn: {
    paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 10, alignItems: 'center',
  },
  btnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  // 难度选择器
  difficultyRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginHorizontal: 16, paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 10, gap: 6, flexWrap: 'wrap',
  },
  difficultyLabel: { fontSize: 13 },
  difficultyBtn: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1,
  },
  difficultyBtnText: { fontSize: 13 },
});
