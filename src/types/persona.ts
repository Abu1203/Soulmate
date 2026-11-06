// ============================================================
// Soulmate — AI Persona（"人档"）：每个 AI 独立完整的自我
// ============================================================
import type { MemoryNode } from './memory';
import type { SoulState } from './state';

/** AI 对另一个 AI 的关系（方向性：A→B 与 B→A 不同） */
export interface AiRelation {
  trust: number;
  intimacy: number;
  defense: number;
  /** 最近一次互动时间 */
  lastInteraction: number;
  /** 恩怨摘要（prompt 注入用，如"上次在群里被你怼过"） */
  grudge?: string;
  /** 甜蜜摘要（如"一起哄过用户开心"） */
  bond?: string;
}

/** AI 人档 — 一个独立的"人" */
export interface AgentSoulPersona {
  /** 主键 = 该 AI 的私聊 conversation.id（私聊即这个人的身份） */
  id: string;
  name: string;
  avatar?: string;
  /** 聚合记忆：跨私聊/群聊/朋友圈的全部记忆（这个"人"记得的事） */
  memories: MemoryNode[];
  /** 情绪状态（这个"人"的心情） */
  soulState?: SoulState;
  /** 关系矩阵：对其他 AI 的关系（修罗场基础） */
  relations: Record<string, AiRelation>;
  createdAt: number;
  updatedAt: number;
}

