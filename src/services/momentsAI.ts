import { getApiKey } from './storage';
import { postChat, getVisionLLMConfig } from './llmProviders';
import { buildCharacterRequest } from './SoulService';
import { parseCharacterReply, stripBracketAnnotations } from './replyParser';
import { generateMomentId, type Moment, type MomentComment } from '../types/moments';
import type { MemoryNode } from '../types/memory';
import type { AgentSoulConversation, AgentSoulMessage } from '../types/agentsoul';
import type { AdvancedSettings } from '../types/settings';
import * as FileSystem from 'expo-file-system/legacy';
import { abortable } from './abortable';

interface AIContext {
  convId: string; name: string; avatar?: string; systemPrompt: string; background: string;
  memories?: MemoryNode[]; advanced?: AdvancedSettings; conversationMode?: 'light'|'advanced'; pureTextMode?: boolean; dialogMessages?: AgentSoulMessage[];
  allConversations?: AgentSoulConversation[]; allMoments?: Moment[];
  loadGroupMsgs?: (id: string) => any[] | Promise<any[]>;
}
function character(ai: AIContext): AgentSoulConversation {
  return { id: ai.convId, name: ai.name, avatar: ai.avatar, settings: { systemPrompt: ai.systemPrompt, background: ai.background, advanced: ai.advanced, conversationMode: ai.conversationMode, pureTextMode: ai.pureTextMode, temperature: 0.7, topP: 0.9 }, messages: ai.dialogMessages || [], memories: ai.memories || [], isPinned: false, createdAt: 0, updatedAt: 0, energy: 0, relationshipTemp: 0, interactionCount: 0 };
}
async function compose(ai: AIContext, query: string, scene: string, signal?: AbortSignal): Promise<string> {
  const controller=new AbortController(),abort=()=>controller.abort();
  if(signal?.aborted)controller.abort();signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,60_000);
  try{
  if (!await abortable(getApiKey(),controller.signal)) throw new Error('尚未配置 API Key，AI 评论没有生成');
  const request = await abortable(buildCharacterRequest({ character: character(ai), history: ai.dialogMessages || [], query, recallQuery: query + '\n' + scene, conversations: ai.allConversations, scene, asideMode: 'off' }),controller.signal);
  const response = await postChat({ ...request, stream: false, thinking: false, maxTokens: 2048, timeoutMs: 60_000, signal:controller.signal });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(`AI 评论生成失败（${response.status}），请稍后重试`);
  if (data.choices?.[0]?.finish_reason === 'length') throw new Error('AI 评论未生成完整，请稍后重试');
  const content = parseCharacterReply(data.choices?.[0]?.message?.content || '', true).reply.trim();
  if (!content) throw new Error('模型没有返回评论正文');
  const reply=ai.pureTextMode ? stripBracketAnnotations(content) : content;
  if(!reply)throw new Error('模型仅返回注释，没有有效评论正文');
  return reply;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();}
}

export async function describeImages(imageUris: string[], signal?: AbortSignal): Promise<string[]> {
  const vision = await (signal?abortable(getVisionLLMConfig(),signal):getVisionLLMConfig()); if (!vision) return [];
  const descriptions: string[] = [];
  for (const uri of imageUris) {
    const reading=FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const base64 = await (signal?abortable(reading,signal):reading);
    const ext = uri.split('?')[0].split('.').pop()?.toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const response = await postChat({ config: vision, model: vision.model, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } }, { type: 'text', text: '用一句话描述图片内容，30字以内。' }] }], stream: false, maxTokens: 2048, thinking: false, timeoutMs: 30_000, signal });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error('图片描述生成失败；原图片已保留');
    descriptions.push(data.choices?.[0]?.message?.content?.trim() || '');
  }
  return descriptions;
}

export async function generateAIMomentsComments(content: string, ais: AIContext[], author = '用户', existing: MomentComment[] = [], signal?: AbortSignal): Promise<MomentComment[]> {
  const comments: MomentComment[] = []; const errors: string[] = [];
  for (const ai of ais) {
    if (signal?.aborted) break;
    try {
      const reply = await compose(ai, '请对这条朋友圈自然评论一两句话。', `朋友圈情境资料：${JSON.stringify({ author, content, comments: [...existing, ...comments].map(c => ({ author: c.aiName, content: c.content })) })}。区分动态作者与用户，不代替他人发言。`, signal);
      comments.push({ id: generateMomentId(), aiConvId: ai.convId, aiName: ai.name, aiAvatar: ai.avatar, content: reply, timestamp: Date.now() });
    } catch (e) { errors.push(`${ai.name}：${e instanceof Error ? e.message : '生成失败'}`); }
  }
  // Successful replies can be saved even when other members failed; no fabricated fallback.
  if (errors.length) { const error = new Error(errors.join('\n')) as Error & { comments: MomentComment[] }; error.comments = comments; throw error; }
  return comments;
}

export async function generateAIReply(name: string, background: string, userReply: string, _legacyMemory?: string, systemPrompt?: string, parentContent?: string,
  extra?: { memories?: MemoryNode[]; dialogMessages?: AgentSoulMessage[]; allMoments?: Moment[]; aiConvId?: string; allConversations?: AgentSoulConversation[]; loadGroupMsgs?: (id: string) => any[] | Promise<any[]>; advanced?: AdvancedSettings; conversationMode?: 'light'|'advanced'; pureTextMode?: boolean; momentContent?: string; signal?: AbortSignal }): Promise<string> {
  return compose({ convId: extra?.aiConvId || '', name, background, systemPrompt: systemPrompt || '', memories: extra?.memories, dialogMessages: extra?.dialogMessages, allConversations: extra?.allConversations, advanced: extra?.advanced, conversationMode: extra?.conversationMode, pureTextMode: extra?.pureTextMode }, userReply,
    `朋友圈回复情境资料：${JSON.stringify({ moment: extra?.momentContent || '', previousComment: parentContent || '' })}。以自己的语气自然回复一两句话。`, extra?.signal);
}

/** Explicitly requested fictional post; no numeric mood/trust input. */
export async function generateAutoMoment(ai: AIContext): Promise<Moment> {
  const content = await compose(ai, '请发一条符合你个性与虚构生活的朋友圈。', '这是角色的虚构生活动态，避免把新编剧情写成用户的现实经历。只输出动态正文。');
  return { id: generateMomentId(), authorConvId: ai.convId, aiName: ai.name, aiAvatar: ai.avatar, content, images: [], imageDescriptions: [], aiIds: [], timestamp: Date.now(), comments: [] };
}
