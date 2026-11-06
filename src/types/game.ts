// ============================================================
// Soulmate - 游戏类型定义
// ============================================================

export type GameType = 'guess_number' | 'idiom_chain' | 'twenty_questions' | 'gomoku';

export interface GameRecord {
  id: string;
  conversationId: string;
  gameType: GameType;
  status: 'playing' | 'finished' | 'abandoned';
  result: 'win' | 'lose' | 'draw' | null;
  moves: any[];
  createdAt: number;
  updatedAt: number;
}

// ============================================================
// 猜数字
// ============================================================
export interface GuessNumberState {
  secret: number;
  min: number;
  max: number;
  tries: number;
  maxTries: number;
  guesses: GuessEntry[];
}

export interface GuessEntry {
  num: number;
  hint: 'bigger' | 'smaller' | 'correct';
}

// ============================================================
// 成语接龙
// ============================================================
export interface IdiomChainState {
  history: IdiomEntry[];     // 所有已用的成语
  usedSet: string[];          // 快速查重（成语文本数组）
  currentStarter: string;     // 当前需要接的字
  isPlayerTurn: boolean;
}

export interface IdiomEntry {
  word: string;
  by: 'player' | 'ai';
}

// ============================================================
// 二十问
// ============================================================
export interface TwentyQuestionsState {
  answer: string;
  category: string;
  totalQuestions: number;
  questionsLeft: number;
  history: QAEntry[];
}

export interface QAEntry {
  question: string;
  answer: 'yes' | 'no' | 'unsure';
}

// ============================================================
// 五子棋
// ============================================================
export interface GomokuState {
  board: string[][];          // 15x15, '.' empty, '●' player, '○' AI
  playerColor: 'black' | 'white';
  aiColor: 'black' | 'white';
  turn: 'player' | 'ai';
  lastMove: { row: number; col: number } | null;
  moveHistory: Array<{ row: number; col: number; by: 'player' | 'ai' }>;
}

export const BOARD_SIZE = 15;

export function createEmptyBoard(): string[][] {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill('.'));
}

// ============================================================
// 游戏菜单项
// ============================================================
export interface GameMenuItem {
  id: GameType;
  name: string;
  icon: string;
  description: string;
}

export const GAME_MENU_ITEMS: GameMenuItem[] = [
  { id: 'guess_number', name: '猜数字', icon: '🔢', description: 'AI 想一个数字，你来猜' },
  { id: 'idiom_chain', name: '成语接龙', icon: '📝', description: '和 AI 轮流接成语' },
  { id: 'twenty_questions', name: '二十问', icon: '❓', description: '20 个问题猜出 AI 想的事物' },
  { id: 'gomoku', name: '五子棋', icon: '⚫⚪', description: '15×15 棋盘对战 AI' },
];
