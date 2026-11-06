// ============================================================
// Soulmate v2 — 朋友圈类型定义
// ============================================================

export interface MomentComment {
  id: string;
  aiConvId: string;       // 对应对话的 id
  aiName: string;         // AI 角色名
  aiAvatar?: string;      // AI 头像
  aiBackground?: string;  // AI 人设背景（用于再回复）
  aiSystemPrompt?: string; // AI 完整角色设定（用于深度个性化回复）
  content: string;        // 评论内容
  timestamp: number;
  replyToId?: string;
}

export interface Moment {
  id: string;
  content: string;
  images: string[];
  imageDescriptions: string[];
  aiIds: string[];
  aiName?: string;           // AI 发布者的名字（自动发朋友圈时用）
  aiAvatar?: string;         // AI 发布者的头像
  authorConvId?: string;     // AI 发布者对应的对话 id（用于用户评论后作者回复）
  timestamp: number;
  comments: MomentComment[];
}

export interface MomentsDraft {
  content: string;
  images: string[];
  imageDescriptions: string[];
  aiIds: string[];
}

export function generateMomentId(): string {
  return `mom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}
