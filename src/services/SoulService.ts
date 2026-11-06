import type { AgentSoulConversation, AgentSoulMessage } from '../types/agentsoul';
import type { MemoryNode } from '../types/memory';
import type { ThinkingMode } from './agentsoulStorage';
import { buildRolePrompt, type RolePromptOptions } from './promptBuilder';
import { activeMemories } from './storyEngine';
import { recallMemories } from './memoryEngine';
import { MEMORY_RECALL_CHAR_BUDGET } from './memoryPolicy';
import { loadMoments } from './momentsStorage';
import { visibleMoments } from './visibility';
import { buildMomentsInteractionBlock, buildGroupInteractionBlock, createGroupMsgsLoader } from './contextBundle';
import { recentDialog, estimateTokens, completeTurns, messageContent } from './conversationContext';
import { parseCharacterReply, stripBracketAnnotations } from './replyParser';
import { renderInjectionBlock } from '../utils/messageParser';
import { getLLMConfig, contextWindowBudget, postChat, friendlyHttpError, type ChatBuildOptions } from './llmProviders';
import { SSEParser } from './sseParser';
import { abortable, cancelReader } from './abortable';

export interface CharacterRequest {
  character: AgentSoulConversation; history: AgentSoulMessage[]; query: string;
  conversations?: AgentSoulConversation[]; memories?: MemoryNode[]; injections?: string[];
  scene?: string; recallQuery?: string; asideMode?: ThinkingMode; signal?: AbortSignal;
}
/** Shared identity, preferences, privacy, history and budget for chat, group and regeneration. */
export async function buildCharacterRequest(p: CharacterRequest): Promise<ChatBuildOptions> {
  const config = await getLLMConfig();
  const window = contextWindowBudget(config);
  const [moments, groups] = await Promise.all([
    (async () => {
      try { return buildMomentsInteractionBlock({ aiName: p.character.name, aiConvId: p.character.id, moments: visibleMoments(await loadMoments(), p.character.id), maxMoments: 3, maxComments: 4 }); }
      catch { return ''; /* Unreadable feed entries never enter the context. */ }
    })(),
    p.conversations ? buildGroupInteractionBlock({ aiConvId: p.character.id, aiName: p.character.name, conversations: p.conversations, loadGroupMsgs: createGroupMsgsLoader(), maxGroups: 2, maxPerGroup: 6 }) : Promise.resolve(''),
  ]);
  // Follow-up questions often omit the topic. Retrieve against recent effective turns as well.
  const recentTopics=completeTurns(p.history).slice(-2).map(t=>[t.user.content,...t.assistants.filter(m=>!m.senderId||m.senderId===p.character.id).map(messageContent)].map(text=>Array.from(text).slice(-240).join('')).join('\n')).join('\n');
  const description = [p.character.settings.systemPrompt, p.character.settings.background].filter(Boolean).join('\n');
  const options:RolePromptOptions={ name: p.character.name, description, advanced: p.character.settings.advanced, conversationMode: p.character.settings.conversationMode, pureTextMode: p.character.settings.pureTextMode, scene: [p.scene, renderInjectionBlock(p.injections || [])].filter(Boolean).join('\n'), context: [p.history.filter(m => m.meta === 'system' || /^\[(TRANSFER|SCENARIO|游戏)/.test(m.content)).slice(-6).map(m => `已发生事件：${m.content}`).join('\n'), moments && `朋友圈（按条目标明作者）：\n${moments}`, groups && `群聊：\n${groups}`].filter(Boolean).join('\n'), asideMode: p.asideMode };
  const maxTokens = Math.min(config.caps.maxTokensCap, config.provider==='deepseek'&&window>=32768 ? 16384 : window >= 16384 ? 8192 : 4096);
  const basePrompt=buildRolePrompt(options);
  const headroom=window-estimateTokens(basePrompt)-estimateTokens(p.query)-maxTokens-512;
  if(headroom<0)throw new Error('当前人设、背景或本轮输入超过此接口的安全上下文预算，请缩短输入或选用更大窗口模型；原设置已保留');
  // Longer saved events must fit small endpoints too, leaving room for recent dialogue.
  const memoryBudget=Math.min(MEMORY_RECALL_CHAR_BUDGET,Math.max(0,Math.floor(headroom*.6)));
  const memories=recallMemories([p.recallQuery || p.query,recentTopics].filter(Boolean).join('\n'),p.memories||activeMemories(p.character),12,p.character.id,memoryBudget);
  let prompt=buildRolePrompt({...options,memories});
  while(memories.length&&estimateTokens(prompt)+estimateTokens(p.query)+maxTokens>window-512){memories.pop();prompt=buildRolePrompt({...options,memories});}
  const reserved = estimateTokens(prompt) + estimateTokens(p.query) + maxTokens;
  if (reserved > window - 512) throw new Error('当前人设、背景或本轮输入超过此接口的安全上下文预算，请缩短输入或选用更大窗口模型；原设置已保留');
  const dialog = recentDialog(p.history, window - reserved - 512, 40, p.character.id, !!p.character.settings.pureTextMode);
  return { config, model: config.model, messages: [{ role: 'system', content: prompt }, ...dialog, { role: 'user', content: p.query }], stream: true, thinking: true, maxTokens, temperature: p.character.settings.temperature ?? 0.7, topP: p.character.settings.topP ?? 0.9, timeoutMs: config.provider==='deepseek'?180_000:120_000 };
}

export class SoulService {
  public lastFinishReason = '';
  async *respond(p: CharacterRequest): AsyncGenerator<{ reply: string; aside: string; reasoning: string }> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (p.signal?.aborted) controller.abort();
    p.signal?.addEventListener('abort', abort, { once: true });
    let idle: ReturnType<typeof setTimeout> | null = null;
    const resetIdle = () => { if (idle) clearTimeout(idle); idle = setTimeout(abort, 60_000); };
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let raw = '', reasoning = ''; const chunks: Array<{content?:string;reasoning?:string}> = []; this.lastFinishReason = '';
    try {
      resetIdle(); // Context/storage preflight must also have a finite wait.
      const request = await abortable(buildCharacterRequest(p),controller.signal);
      const response = await postChat({ ...request, signal: controller.signal });
      if (!response.ok) throw new Error(friendlyHttpError(response.status));
      if (!response.body) throw new Error('模型没有返回可读取的正文');
      reader = response.body.getReader(); const decoder = new TextDecoder();
      const parser = new SSEParser((data, type) => {
        if (data === '[DONE]') return;
        const event = JSON.parse(data);
        if (event.error || type === 'error') throw new Error('模型服务在生成时返回错误，请重试');
        const choice = event.choices?.[0];
        if (choice?.finish_reason) this.lastFinishReason = choice.finish_reason;
        const delta = choice?.delta;
        if (typeof delta?.content === 'string' || typeof delta?.reasoning_content === 'string') chunks.push({ content: delta.content, reasoning: delta.reasoning_content });
      });
      let parsedRaw='',view={reply:'',aside:''};
      const collect=()=>{for(const chunk of chunks){raw+=chunk.content||'';reasoning+=chunk.reasoning||'';}chunks.length=0;};
      resetIdle();
      while (!parser.done) {
        const { done, value } = await abortable(reader.read(),controller.signal);
        if (done) { parser.push(decoder.decode()); parser.finish(); break; }
        if (controller.signal.aborted) throw new Error('生成已停止或超时');
        resetIdle(); parser.push(decoder.decode(value, { stream: true }));
        collect();
        // Process network batches, not every SSE event. Keep every received
        // character, including the final partial reply when the user stops.
        if(raw!==parsedRaw){view=parseCharacterReply(raw);parsedRaw=raw;}yield {...view,reasoning};
      }
      collect();
      if (controller.signal.aborted) throw new Error('生成已停止或超时');
      const result = parseCharacterReply(raw, true);
      if (!result.reply) throw new Error('模型未产生对话正文，请重试');
      if (p.character.settings.pureTextMode && !stripBracketAnnotations(result.reply)) throw new Error('模型只返回了括号注释，没有对话正文，请重试');
      yield { ...result, reasoning };
    } finally {
      if (idle) clearTimeout(idle);
      p.signal?.removeEventListener('abort', abort);
      controller.abort();
      cancelReader(reader);
    }
  }
}
