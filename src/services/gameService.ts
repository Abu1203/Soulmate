// ============================================================
// Soulmate - 游戏逻辑服务
// ============================================================
import type {
  GuessNumberState, IdiomChainState, TwentyQuestionsState,
  GomokuState, QAEntry, IdiomEntry, GameType,
} from '../types/game';
import { createEmptyBoard, BOARD_SIZE } from '../types/game';
import {
  getRandomIdiomByFirstChar, getRandomIdiom, validateIdiomChain,
} from './idiomBank';

// ============================================================
// 猜数字
// ============================================================
export function createGuessNumberState(): GuessNumberState {
  return {
    secret: Math.floor(Math.random() * 100) + 1,
    min: 1,
    max: 100,
    tries: 0,
    maxTries: 10,
    guesses: [],
  };
}

export function makeGuess(state: GuessNumberState, num: number): {
  state: GuessNumberState;
  hint: 'bigger' | 'smaller' | 'correct';
} {
  const tries = state.tries + 1;
  let hint: 'bigger' | 'smaller' | 'correct';
  if (num === state.secret) hint = 'correct';
  else if (num < state.secret) hint = 'bigger';
  else hint = 'smaller';

  const newState: GuessNumberState = {
    ...state,
    tries,
    guesses: [...state.guesses, { num, hint }],
  };
  return { state: newState, hint };
}

// ============================================================
// 成语接龙
// ============================================================
export function createIdiomChainState(): IdiomChainState {
  const firstIdiom = getRandomIdiom();
  return {
    history: [{ word: firstIdiom.word, by: 'ai' }],
    usedSet: [firstIdiom.word],
    currentStarter: firstIdiom.last,  // 玩家需要接这个字
    isPlayerTurn: true,
  };
}

export function playerIdiomTurn(
  state: IdiomChainState,
  word: string,
): { state: IdiomChainState; error?: string } {
  const usedSet = new Set(state.usedSet);
  const result = validateIdiomChain(word, state.currentStarter, usedSet);
  if (!result.valid) {
    return { state, error: result.error };
  }

  const newState: IdiomChainState = {
    ...state,
    history: [...state.history, { word, by: 'player' }],
    usedSet: [...state.usedSet, word],
    currentStarter: word[word.length - 1],
    isPlayerTurn: false,
  };
  return { state: newState };
}

export function aiIdiomTurn(state: IdiomChainState): {
  state: IdiomChainState;
  aiIdiom: string;
  cannotContinue: boolean;
} {
  const usedSet = new Set(state.usedSet);
  const aiIdiom = getRandomIdiomByFirstChar(state.currentStarter, usedSet);

  if (!aiIdiom) {
    return { state, aiIdiom: '', cannotContinue: true };
  }

  const newState: IdiomChainState = {
    ...state,
    history: [...state.history, { word: aiIdiom.word, by: 'ai' }],
    usedSet: [...state.usedSet, aiIdiom.word],
    currentStarter: aiIdiom.last,
    isPlayerTurn: true,
  };
  return { state: newState, aiIdiom: aiIdiom.word, cannotContinue: false };
}

// ============================================================
// 二十问 — AI 心中想的事物（200+ 题库）
// ============================================================
const TWENTY_Q_ANSWERS: Array<{ answer: string; category: string }> = [
  // 动物
  { answer: '猫', category: '动物' }, { answer: '狗', category: '动物' },
  { answer: '大象', category: '动物' }, { answer: '长颈鹿', category: '动物' },
  { answer: '企鹅', category: '动物' }, { answer: '海豚', category: '动物' },
  { answer: '熊猫', category: '动物' }, { answer: '老虎', category: '动物' },
  { answer: '狮子', category: '动物' }, { answer: '兔子', category: '动物' },
  { answer: '蛇', category: '动物' }, { answer: '鹰', category: '动物' },
  { answer: '蝴蝶', category: '动物' }, { answer: '蚂蚁', category: '动物' },
  { answer: '鲸鱼', category: '动物' }, { answer: '金鱼', category: '动物' },
  { answer: '鹦鹉', category: '动物' }, { answer: '孔雀', category: '动物' },
  { answer: '恐龙', category: '动物' }, { answer: '乌龟', category: '动物' },
  { answer: '青蛙', category: '动物' }, { answer: '猴子', category: '动物' },
  { answer: '斑马', category: '动物' }, { answer: '北极熊', category: '动物' },
  { answer: '袋鼠', category: '动物' }, { answer: '考拉', category: '动物' },
  { answer: '鳄鱼', category: '动物' }, { answer: '变色龙', category: '动物' },
  { answer: '蜘蛛', category: '动物' }, { answer: '蜜蜂', category: '动物' },
  // 食物
  { answer: '苹果', category: '食物' }, { answer: '香蕉', category: '食物' },
  { answer: '西瓜', category: '食物' }, { answer: '披萨', category: '食物' },
  { answer: '汉堡', category: '食物' }, { answer: '寿司', category: '食物' },
  { answer: '巧克力', category: '食物' }, { answer: '冰淇淋', category: '食物' },
  { answer: '面条', category: '食物' }, { answer: '饺子', category: '食物' },
  { answer: '火锅', category: '食物' }, { answer: '蛋糕', category: '食物' },
  { answer: '面包', category: '食物' }, { answer: '咖啡', category: '食物' },
  { answer: '茶', category: '食物' }, { answer: '橙汁', category: '食物' },
  { answer: '葡萄', category: '食物' }, { answer: '草莓', category: '食物' },
  { answer: '芒果', category: '食物' }, { answer: '番茄', category: '食物' },
  // 物品
  { answer: '手机', category: '物品' }, { answer: '电脑', category: '物品' },
  { answer: '电视机', category: '物品' }, { answer: '冰箱', category: '物品' },
  { answer: '空调', category: '物品' }, { answer: '洗衣机', category: '物品' },
  { answer: '汽车', category: '物品' }, { answer: '自行车', category: '物品' },
  { answer: '飞机', category: '物品' }, { answer: '火车', category: '物品' },
  { answer: '书本', category: '物品' }, { answer: '钢笔', category: '物品' },
  { answer: '桌子', category: '物品' }, { answer: '椅子', category: '物品' },
  { answer: '床', category: '物品' }, { answer: '镜子', category: '物品' },
  { answer: '雨伞', category: '物品' }, { answer: '眼镜', category: '物品' },
  { answer: '手表', category: '物品' }, { answer: '钥匙', category: '物品' },
  { answer: '灯', category: '物品' }, { answer: '相机', category: '物品' },
  { answer: '吉他', category: '物品' }, { answer: '足球', category: '物品' },
  { answer: '篮球', category: '物品' }, { answer: '剪刀', category: '物品' },
  { answer: '时钟', category: '物品' }, { answer: '地图', category: '物品' },
  // 人物/职业
  { answer: '医生', category: '人物' }, { answer: '老师', category: '人物' },
  { answer: '警察', category: '人物' }, { answer: '消防员', category: '人物' },
  { answer: '厨师', category: '人物' }, { answer: '宇航员', category: '人物' },
  { answer: '画家', category: '人物' }, { answer: '歌手', category: '人物' },
  { answer: '运动员', category: '人物' }, { answer: '科学家', category: '人物' },
  { answer: '孙悟空', category: '人物' }, { answer: '诸葛亮', category: '人物' },
  { answer: '李白', category: '人物' }, { answer: '爱因斯坦', category: '人物' },
  { answer: '圣诞老人', category: '人物' }, { answer: '超人', category: '人物' },
  // 自然/地点
  { answer: '太阳', category: '自然' }, { answer: '月亮', category: '自然' },
  { answer: '星星', category: '自然' }, { answer: '大海', category: '自然' },
  { answer: '沙漠', category: '自然' }, { answer: '森林', category: '自然' },
  { answer: '火山', category: '自然' }, { answer: '彩虹', category: '自然' },
  { answer: '闪电', category: '自然' }, { answer: '雪花', category: '自然' },
  { answer: '长城', category: '地点' }, { answer: '金字塔', category: '地点' },
  { answer: '埃菲尔铁塔', category: '地点' }, { answer: '自由女神像', category: '地点' },
  { answer: '故宫', category: '地点' }, { answer: '西湖', category: '地点' },
  // 抽象
  { answer: '爱情', category: '抽象' }, { answer: '时间', category: '抽象' },
  { answer: '音乐', category: '抽象' }, { answer: '梦', category: '抽象' },
  { answer: '自由', category: '抽象' }, { answer: '和平', category: '抽象' },
  { answer: '快乐', category: '抽象' }, { answer: '知识', category: '抽象' },
];

export function createTwentyQuestionsState(): TwentyQuestionsState {
  const pick = TWENTY_Q_ANSWERS[Math.floor(Math.random() * TWENTY_Q_ANSWERS.length)];
  return {
    answer: pick.answer,
    category: pick.category,
    totalQuestions: 20,
    questionsLeft: 20,
    history: [],
  };
}

/**
 * ✅ AI 判断：调用 DeepSeek 评估问题的答案是/否/不确定
 * 修复(Bug3 智障)：prompt 大幅强化（含判断规则+示例），并传历史问答保持一致性，
 *   同时本地预处理"是猫吗"这类直接猜测 → 必定判 yes。
 */
export async function judgeTwentyQ(
  question: string,
  answer: string,
  category: string,
  history: QAEntry[] = [],
  signal?: AbortSignal,
): Promise<'yes' | 'no' | 'unsure'> {
  const q = question.trim();
  // ✅ 本地预处理：判断"是不是在直接猜答案"
  //    把疑问/猜测语气词全部剥掉后，若剩余核心就是答案 → 必中 yes
  //    （解决之前 guessWords 顺序错误 + 死代码导致"本地必中"不生效的问题）
  const normalize = (s: string) => s
    .replace(/是不是|是吗|对吗|对吧|是|猜|答案|的|吗|呢|吧|啊|？|\?|！|!|。|\s/g, '')
    .toLowerCase();
  const core = normalize(q);
  const ansNorm = normalize(answer);
  // ✅ 修复：否定句（"不是猫吗"）不算猜中，交给 AI 判断
  const negated = /(不是|没有|并非|难道不是|怎么可能是|不会是|不可能|未必)/.test(q);
  // 核心等于答案 → 必中
  if (!negated && ansNorm && core === ansNorm) return 'yes';
  // 原句/核心包含答案 → 猜中（但否定句除外）


  try {
    const { postChat } = await import('./llmProviders');

    // ✅ 历史一致性：带上之前问答，避免前后矛盾
    const historyText = history.length > 0
      ? `\n之前的问答（必须保持一致，不能自相矛盾）：\n${history.slice(-10).map((h, i) => `${i + 1}. 问：${h.question} → ${h.answer}`).join('\n')}`
      : '';

    const resp = await postChat({
      messages: [
        {
          role: 'system',
          content: `你在主持"二十问"猜谜游戏。你心里的答案是【${answer}】（类别：${category}）。
玩家会问你一个是非问题，你要根据答案如实回答。

【判断规则】
- 问题的陈述对【${answer}】成立 → 回答 yes
- 问题的陈述对【${answer}】不成立 → 回答 no
- 无法用是/否回答（与答案无关、太模糊、或本身不是是非题）→ 回答 unsure

【示例（答案=猫）】
- "是动物吗" → yes（猫是动物）
- "会飞吗" → no（猫不会飞）
- "是哺乳动物吗" → yes
- "比狗大吗" → no（一般猫比狗小）
- "今天天气好吗" → unsure（与答案无关）

只输出一个词：yes、no 或 unsure。不要任何解释。${historyText}`,
        },
        { role: 'user', content: q },
      ],
      stream: false,
      temperature: 0.1,
      maxTokens: 2048,
      thinking: false, signal, timeoutMs: 30_000,
    });
    if (!resp.ok) throw new Error('游戏判断请求失败，请稍后重试；本次不扣问题次数');
    const data: any = await resp.json();
    const result = (data.choices?.[0]?.message?.content || '').trim().toLowerCase();
    if (result === 'yes') return 'yes';
    if (result === 'no') return 'no';
    if (result === 'unsure') return 'unsure';
    throw new Error('游戏判断格式异常，本次不扣问题次数');
  } catch (e) { throw e; }
}

export async function askTwentyQ(
  state: TwentyQuestionsState,
  question: string,
  signal?: AbortSignal,
): Promise<{ state: TwentyQuestionsState; result: QAEntry }> {
  if (state.questionsLeft <= 0) throw new Error('问题次数已用完，请直接猜答案');
  const judgement = await judgeTwentyQ(question, state.answer, state.category, state.history, signal);
  const entry: QAEntry = { question, answer: judgement };
  const newState: TwentyQuestionsState = {
    ...state,
    questionsLeft: state.questionsLeft - 1,
    history: [...state.history, entry],
  };
  return { state: newState, result: entry };
}

// ============================================================
// 五子棋 AI（基于评分法）
// ============================================================

// 评分权重
const BASE_SCORES = {
  FIVE: 100000,
  OPEN_FOUR: 10000,
  FOUR: 5000,
  OPEN_THREE: 2000,
  THREE: 500,
  OPEN_TWO: 200,
  TWO: 50,
  ONE: 10,
};

// 方向偏移
const DIRECTIONS = [
  [0, 1],   // 水平
  [1, 0],   // 垂直
  [1, 1],   // 对角线
  [1, -1],  // 反对角线
];

export type GomokuDifficulty = 'easy' | 'medium' | 'hard';

/** 根据难度获取调整后的评分权重 */
function getScoresForDifficulty(difficulty: GomokuDifficulty): typeof BASE_SCORES {
  const scale = difficulty === 'easy' ? 0.5 : difficulty === 'hard' ? 1.3 : 1.0;
  const result = { ...BASE_SCORES };
  for (const k of Object.keys(result) as (keyof typeof BASE_SCORES)[]) {
    result[k] = Math.round(result[k] * scale);
  }
  return result;
}

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

/**
 * 评估某个位置对指定玩家的分数
 */
function evaluatePosition(board: string[][], row: number, col: number, player: string, scores: typeof BASE_SCORES): number {
  if (board[row][col] !== '.') return -1;

  let totalScore = 0;

  for (const [dr, dc] of DIRECTIONS) {
    let count = 1;   // 当前位置
    let openEnds = 0;

    // 正方向
    let r = row + dr, c = col + dc;
    while (inBounds(r, c) && board[r][c] === player) {
      count++;
      r += dr;
      c += dc;
    }
    if (inBounds(r, c) && board[r][c] === '.') openEnds++;

    // 反方向
    r = row - dr;
    c = col - dc;
    while (inBounds(r, c) && board[r][c] === player) {
      count++;
      r -= dr;
      c -= dc;
    }
    if (inBounds(r, c) && board[r][c] === '.') openEnds++;

    totalScore += scoreForLine(count, openEnds, scores);
  }

  return totalScore;
}

function scoreForLine(count: number, openEnds: number, scores: typeof BASE_SCORES): number {
  if (count >= 5) return scores.FIVE;
  if (openEnds === 0) return 0;

  switch (count) {
    case 4:
      return openEnds === 2 ? scores.OPEN_FOUR : scores.FOUR;
    case 3:
      return openEnds === 2 ? scores.OPEN_THREE : scores.THREE;
    case 2:
      return openEnds === 2 ? scores.OPEN_TWO : scores.TWO;
    case 1:
      return scores.ONE;
    default:
      return 0;
  }
}

/**
 * AI 寻找最佳落子位置
 */
export function findBestMove(
  board: string[][],
  aiPiece: string,
  playerPiece: string,
  difficulty: GomokuDifficulty = 'medium',
): { row: number; col: number } | null {
  const scores = getScoresForDifficulty(difficulty);
  const candidateRange = difficulty === 'easy' ? 1 : difficulty === 'hard' ? 3 : 2;
  const defenseMultiplier = difficulty === 'easy' ? 0.9 : difficulty === 'hard' ? 1.3 : 1.1;

  let bestScore = -1;
  let bestMove: { row: number; col: number } | null = null;

  // 候选范围随难度变化
  const candidates: Set<string> = new Set();
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== '.') {
        for (let dr = -candidateRange; dr <= candidateRange; dr++) {
          for (let dc = -candidateRange; dc <= candidateRange; dc++) {
            const nr = r + dr, nc = c + dc;
            if (inBounds(nr, nc) && board[nr][nc] === '.') {
              candidates.add(`${nr},${nc}`);
            }
          }
        }
      }
    }
  }

  // 如果棋盘为空，下中心
  if (candidates.size === 0) {
    if (isBoardFull(board)) return null;
    const center = Math.floor(BOARD_SIZE / 2);
    return { row: center, col: center };
  }

  for (const key of candidates) {
    const [r, c] = key.split(',').map(Number);
    const aiScore = evaluatePosition(board, r, c, aiPiece, scores);
    const playerScore = evaluatePosition(board, r, c, playerPiece, scores);
    const total = aiScore + playerScore * defenseMultiplier;

    if (total > bestScore) {
      bestScore = total;
      bestMove = { row: r, col: c };
    }
  }

  return bestMove;
}

/**
 * 检查是否有人获胜
 */
export function checkWin(board: string[][]): string | null {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = board[r][c];
      if (piece === '.') continue;

      // 检查四个方向
      for (const [dr, dc] of DIRECTIONS) {
        let count = 1;
        for (let i = 1; i < 5; i++) {
          const nr = r + dr * i, nc = c + dc * i;
          if (inBounds(nr, nc) && board[nr][nc] === piece) count++;
          else break;
        }
        if (count >= 5) return piece;
      }
    }
  }
  return null;
}

/**
 * 检查棋盘是否已满（平局）
 */
export function isBoardFull(board: string[][]): boolean {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === '.') return false;
    }
  }
  return true;
}

export function createGomokuState(playerFirst: boolean = true): GomokuState {
  return {
    board: createEmptyBoard(),
    playerColor: 'black',
    aiColor: 'white',
    turn: playerFirst ? 'player' : 'ai',
    lastMove: null,
    moveHistory: [],
  };
}
