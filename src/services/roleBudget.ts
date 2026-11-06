// ============================================================
// roleBudget — 人设文本预算保护
// 目标：人设（角色设定/背景）保存与输入【无字数上限】（支持几万字 Word 文档），
//       但 DeepSeek API 上下文窗口有限（chat 128K / reasoner 64K tokens），
//       请求时超预算自动截取，避免"上下文超限"报错导致对话完全不可用。
// 截断只发生在请求侧，存储中的完整人设永远保留。
// ============================================================

// 人设预算：24000 字符（中文约 1.8-2 万 tokens），
// 剩余窗口留给历史消息、记忆、朋友圈上下文与输出。
export const ROLE_TEXT_CHAR_LIMIT = 24000;

export interface RoleBudgetResult {
  text: string;
  /** 是否因超预算被截断 */
  truncated: boolean;
}

/**
 * 对人设/背景文本做预算截断（超限保留开头——人设核心通常在开头）。
 * 未超限原样返回（无任何改动）。
 */
export function enforceRoleBudget(text: string | undefined | null): RoleBudgetResult {
  const t = (text || '').trim();
  if (t.length <= ROLE_TEXT_CHAR_LIMIT) return { text: t, truncated: false };
  // 按完整 code point 截断（避免切断 UTF-16 代理对，边界 emoji/生僻字不变成半个字符）
  const chars = Array.from(t);
  if (chars.length <= ROLE_TEXT_CHAR_LIMIT) return { text: t, truncated: false };
  return { text: chars.slice(0, ROLE_TEXT_CHAR_LIMIT).join(''), truncated: true };
}
