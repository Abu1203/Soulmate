// ============================================================
// AgentSoul - 类型定义
// ============================================================
import type { SoulState } from './state';
import type { MemoryNode } from './memory';
import type { MemoryState, MemoryRecallSettings } from './memory';
import type { AdvancedSettings } from './settings';

export interface AgentSoulSettings {
  systemPrompt: string;
  background: string;
  temperature: number;
  topP: number;
  backgroundOpacity?: number;
  pureTextMode?: boolean;
  conversationMode?: 'light' | 'advanced';  // 普通/高级模式；仅高级启用表达偏好，沿用旧存储值
  splitMessages?: boolean;  // AI回复分条发送
  advanced?: AdvancedSettings;
  /** 群聊当前情景（发布情景功能） */
  scenario?: string;
  memoryRecall?: MemoryRecallSettings;
}

export interface AgentSoulConversation {
  id: string;
  name: string;
  isPinned: boolean;
  type?: 'private' | 'group';
  memberIds?: string[];  // 群聊成员对话ID
  settings: AgentSoulSettings;
  messages: AgentSoulMessage[];
  backgroundImage?: string;
  avatar?: string;
  userAvatar?: string;
  energy: number;           // 旧版存档字段，不再驱动角色
  relationshipTemp: number;  // 旧版存档字段，不再驱动角色
  interactionCount: number;  // 旧版存档字段
  createdAt: number;
  updatedAt: number;
  // 旧版状态只为历史数据兼容保留
  soulState?: SoulState;
  memories?: MemoryNode[];
  memoryState?: MemoryState;
  story?: { activeId: string; revision: number; branches: StoryBranch[]; deletedIds?:string[] };
  /** A user-confirmed independent copy; never overwrites the protected original. */
  recoveredFrom?: { conversationId: string; fingerprint: string };
}

export interface StoryBranch {
  id: string; label: string; createdAt: number;
  messages: AgentSoulMessage[]; memories: MemoryNode[]; memoryState?: MemoryState;
}
export interface ReplyVersion { id: string; content: string; thinking?: AgentSoulMessage['thinking']; splitMessages?: boolean; createdAt: number; origin: 'model' | 'edit' | 'legacy' }

export interface AgentSoulMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  rawText?: string;
  inReplyTo?: string;
  /** 'system' = 系统事件消息（转账/游戏结果等），发给 AI 时用 system 角色，不是用户发言 */
  meta?: string;
  senderId?: string;       // 群聊时发送者对话ID
  senderName?: string;     // 群聊时发送者名字
  senderAvatar?: string;   // 群聊时发送者头像
  thinking?: {
    kind?: 'character' | 'legacy_reasoning';
    content: string;
    duration: number;
    collapsed: boolean;
  };
  timestamp: number;
  isStreaming?: boolean;
  /** Presentation captured for this reply, independent of the current conversation toggle. */
  splitMessages?: boolean;
  error?: string;
  // ✅ 多版本回复（DeepSeek 式 <1/2> 切换）：versions 存旧版本，主 content 为最新版本
  versions?: Array<{ content: string; splitMessages?:boolean; thinking?: { kind?: 'character' | 'legacy_reasoning'; content: string; duration: number; collapsed: boolean } }>;
  versionIndex?: number;   // 当前显示版本号（0 = 最新主内容）
  replyVersions?: ReplyVersion[];
  selectedReplyVersionId?: string;
  legacyParts?: AgentSoulMessage[];
}

export const DEFAULT_SETTINGS: AgentSoulSettings = {
  systemPrompt: '',
  background: '',
  temperature: 0.7,
  topP: 0.9,
};

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
