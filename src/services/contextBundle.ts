// ============================================================
// Soulmate v2 — 统一上下文包（私聊 / 群聊 / 朋友圈 三场景共用）
// 目标：每个 AI 都拿到 —— 人设 + 相关长期记忆 + 最近对话 + 之前朋友圈互动
// ============================================================
import type { MemoryNode } from '../types/memory';
import type { Moment } from '../types/moments';
import type { AgentSoulMessage } from '../types/agentsoul';
import { visibleMoments } from './visibility';
import { loadGroupMessages } from './groupStorage';
import { recallMemories } from './memoryEngine';
import { recentDialog as selectRecentDialog } from './conversationContext';

/** 群聊消息存储 key 前缀（与 GroupChatScreen 一致） */
const GROUP_MSGS_KEY = '@soulmate_group_msgs_';

/**
 * 创建一个"按群 id 读取群消息"的加载器（供群聊互动块使用）
 */
export function createGroupMsgsLoader(): (convId: string) => Promise<AgentSoulMessage[]> {
  return (convId: string) => loadGroupMessages(convId);
}

/** 朋友圈互动文本块参数 */
export interface MomentsBlockParams {
  aiConvId?: string;
  /** 当前 AI 的名字（用于标注"你回复过"） */
  aiName: string;
  /** 所有朋友圈动态 */
  moments: Moment[];
  /** 用户昵称（默认"用户"） */
  userName?: string;
  /** 最多带几条动态（默认 3） */
  maxMoments?: number;
  /** 每条动态最多带几条评论（默认 6） */
  maxComments?: number;
}

/**
 * 构建"之前朋友圈互动"文本块 —— AI 能记起用户发过的动态 + 自己/别人的评论
 * 返回空串表示没有可注入的内容
 */
export function buildMomentsInteractionBlock(p: MomentsBlockParams): string {
  const { aiName, aiConvId, moments, userName = '用户', maxMoments = 3, maxComments = 6 } = p;
  if (!moments || moments.length === 0) return '';

  // 按时间倒序取最近几条
  const recent = [...moments].sort((a, b) => b.timestamp - a.timestamp).slice(0, maxMoments);
  const now = Date.now();
  let block = '';

  for (const m of recent) {
    const ago = Math.floor((now - m.timestamp) / 3600000);
    const agoStr = ago < 1 ? '刚刚' : ago < 24 ? `${ago}小时前` : `${Math.floor(ago / 24)}天前`;
    // ✅ 修复(复查)：Moment 的作者字段是 aiName（AI 发的动态有值），不是 authorName
    const momentAiName = (m as any).aiName as string | undefined;
    const authorName = momentAiName && momentAiName.trim() ? momentAiName : userName;
    const content = (m.content || '').slice(0, 60);
    if (!content) continue;
    block += `- ${authorName}（${agoStr}）：${content}\n`;
    const comments = (m.comments || []).slice(0, maxComments);
    for (const c of comments) {
      const who = (aiConvId ? c.aiConvId === aiConvId : c.aiName === aiName) ? '你' : (c.aiConvId === '__user__' ? userName : c.aiName);
      block += `    ${who}：${(c.content || '').slice(0, 50)}\n`;
    }
  }
  return block.trim();
}

/** 统一上下文包 */
export interface ContextBundle {
  /** 本轮相关事实 */
  factMemories: MemoryNode[];
  /** 召回的记忆（重要 + 关键词命中 + 近因 + 近期流水垫底） */
  recalledMemories: MemoryNode[];
  /** 合成的一段"记忆文本"（仅本轮相关记忆，用 ；分隔） */
  memoryText: string;
  /** 最近对话（[{role, content}]，可直接拼进 messages） */
  recentDialog: Array<{ role: string; content: string }>;
  /** 之前朋友圈互动文本块 */
  momentsBlock: string;
  /** 之前群聊互动文本块（该 AI 参与过的群聊近期消息） */
  groupBlock: string;
}

/** 群聊互动文本块参数 */
export interface GroupBlockParams {
  /** 当前 AI 的对话 id（只取它所在的群） */
  aiConvId: string;
  /** 当前 AI 的名字（标注"你"） */
  aiName: string;
  /** 全部群聊会话 */
  conversations: Array<{ id: string; name: string; type?: string; memberIds?: string[] }>;
  /** 读取某个群消息数组的函数（来自 AsyncStorage） */
  loadGroupMsgs: (convId: string) => AgentSoulMessage[] | Promise<AgentSoulMessage[]>;
  /** 用户昵称 */
  userName?: string;
  /** 每个群最多带几条（默认 8） */
  maxPerGroup?: number;
  /** 最多带几个群（默认 2） */
  maxGroups?: number;
}

/**
 * 构建"之前群聊互动"文本块 —— AI 能记起"你和用户/其他AI在群里聊了什么"
 * 只取该 AI 作为成员的群聊，按时间倒序取近期消息
 */
export async function buildGroupInteractionBlock(p: GroupBlockParams): Promise<string> {
  const { aiConvId, aiName, conversations, loadGroupMsgs, userName = '用户', maxPerGroup = 8, maxGroups = 2 } = p;
  if (!conversations || conversations.length === 0) return '';

  // 该 AI 所在的群聊（memberIds 含 aiConvId）
  const myGroups = conversations.filter(
    (c) => c.type === 'group' && Array.isArray(c.memberIds) && c.memberIds.includes(aiConvId),
  );
  if (myGroups.length === 0) return '';

  // 收集所有群的消息，按最近活跃排序
  const groupData: Array<{ name: string; lastTs: number; lines: string[] }> = [];
  // Read every member group (selection still depends on actual last message time),
  // with bounded concurrency so a slow phone does not perform them all serially.
  let nextGroup = 0;
  const collected = new Array<(typeof groupData)[number] | undefined>(myGroups.length);
  const collect = async () => { while (nextGroup < myGroups.length) {
    const index = nextGroup++, g = myGroups[index];
    let msgs: AgentSoulMessage[] = [];
    try { msgs = await loadGroupMsgs(g.id) || []; } catch { msgs = []; }
    if (!msgs || msgs.length === 0) continue;
    const recent = msgs.slice(-maxPerGroup);
    const lines = recent.filter(m=>m.content?.trim()).map((m) => {
      const who = m.role === 'user' ? userName : (((m as any).senderName) || 'AI');
      const whoDisp = m.role==='assistant' && m.senderId===aiConvId ? '你' : who;
      return `    ${whoDisp}：${(m.content || '').slice(0, 50)}`;
    });
    if (lines.length === 0) continue;
    const lastTs = msgs[msgs.length - 1]?.timestamp || 0;
    collected[index] = { name: g.name || '群聊', lastTs, lines };
  } };
  await Promise.all(Array.from({length: Math.min(3, myGroups.length)}, collect));
  // Preserve original tie ordering even when I/O finishes out of order.
  for (const data of collected) if (data) groupData.push(data);
  if (groupData.length === 0) return '';

  groupData.sort((a, b) => b.lastTs - a.lastTs);
  let block = '';
  for (const gd of groupData.slice(0, maxGroups)) {
    block += `- 群聊"${gd.name}"：\n${gd.lines.join('\n')}\n`;
  }
  return block.trim();
}

export interface BuildBundleParams {
  /** 召回关键词（通常是当前用户输入/动态内容） */
  query: string;
  /** 该 AI 的完整记忆池 */
  memories: MemoryNode[];
  /** 该 AI 的名字 */
  aiName: string;
  /** 该 AI 的对话 id（用于找它所在的群聊） */
  aiConvId?: string;
  /** 最近对话原始消息（私聊=conv.messages，群聊=群消息数组） */
  dialogMessages?: AgentSoulMessage[];
  /** 对话历史保留条数（默认 20） */
  dialogCount?: number;
  /** 对话是否带"名字："前缀（群聊=true，私聊=false） */
  dialogWithSpeaker?: boolean;
  /** 朋友圈动态列表（可选，给了就注入互动） */
  moments?: Moment[];
  /** 全部会话（可选，给了就注入群聊互动） */
  conversations?: Array<{ id: string; name: string; type?: string; memberIds?: string[] }>;
  /** 读取群消息的函数（可选，配合 conversations 注入群聊互动） */
  loadGroupMsgs?: (convId: string) => AgentSoulMessage[] | Promise<AgentSoulMessage[]>;
  /** 用户昵称 */
  userName?: string;
  /** 记忆召回上限（默认 30） */
  maxMemories?: number;
}

/**
 * 构建统一上下文包
 */
export async function buildContextBundle(p: BuildBundleParams): Promise<ContextBundle> {
  const {
    query,
    memories = [],
    aiName,
    aiConvId,
    dialogMessages = [],
    dialogCount = 20,
    dialogWithSpeaker = false,
    moments = [],
    conversations = [],
    loadGroupMsgs,
    userName = '用户',
    maxMemories = 30,
  } = p;

  const recalledMemories = recallMemories(query, memories, maxMemories, aiConvId);
  const factMemories = recalledMemories.filter(m => m.kind === 'fact' || m.isFact);
  const memoryText = recalledMemories.map(m => m.content).join('；');
  const recentDialog = selectRecentDialog(dialogMessages, 24000, 40, aiConvId);

  // 5. 朋友圈互动块
  const momentsBlock = buildMomentsInteractionBlock({ aiName, moments: visibleMoments(moments, aiConvId), userName });

  // 6. 群聊互动块（该 AI 作为成员参与的群聊近期消息）
  let groupBlock = '';
  if (aiConvId && loadGroupMsgs && conversations.length > 0) {
    try {
      groupBlock = await buildGroupInteractionBlock({ aiConvId, aiName, conversations, loadGroupMsgs, userName });
    } catch { groupBlock = ''; }
  }

  return { factMemories, recalledMemories, memoryText, recentDialog, momentsBlock, groupBlock };
}
