// ============================================================
// Soulmate v2 — 双模式定义
// ============================================================

export type ConversationMode = 'normal' | 'pure';

export const MODE_CONFIG = {
  normal: { showAction: true, parseAtSymbol: true, injectContext: 'explicit' },
  pure: { showAction: false, parseAtSymbol: false, injectContext: 'implicit' },
} as const;

export interface ConversationModeConfig {
  showAction: boolean;
  parseAtSymbol: boolean;
  injectContext: 'explicit' | 'implicit';
}
