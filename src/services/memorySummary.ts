import { postChat, friendlyHttpError, getLLMConfig, contextWindowBudget, type LLMConfig } from './llmProviders';
import type { AgentSoulMessage } from '../types/agentsoul';
import type { MemoryNode, MemoryKind, MemoryState, MemoryCursor } from '../types/memory';
import { completeTurns, estimateTokens, messageContent, type DialogTurn } from './conversationContext';
import { normalizeMemory, recallMemories } from './memoryEngine';
import { selectedVersion } from './storyEngine';
import { checksum } from './snapshotStore';
import { factIdentity, sameMemory, blockedMemory } from './memoryIdentity';
import { generateId } from '../types/agentsoul';
import { SUMMARY_MAX_ITEMS, MEMORY_ITEM_MAX_CHARS, SUMMARY_MAX_CHARS, selectCoreMemories, memoryCharCount } from './memoryPolicy';

export const MEMORY_SUMMARY_VERSION=2;

/** Reconsider only one recent empty batch after this prompt fix, never the entire archive. */
export function reopenEmptySummary(messages:AgentSoulMessage[],cursor:MemoryCursor|undefined,interval:number):MemoryCursor|undefined {
  if(!cursor?.lastSuccessAt||cursor.lastSavedCount!==0||(cursor.summaryPromptVersion||0)>=MEMORY_SUMMARY_VERSION||!cursor.processed)return cursor;
  const completed=completeTurns(messages).filter(t=>cursor.processed![t.user.id]===turnFingerprint(t)).slice(-interval);
  if(completed.length<interval)return cursor;
  const processed={...cursor.processed};completed.forEach(t=>delete processed[t.user.id]);
  return {...cursor,processed,summaryPromptVersion:MEMORY_SUMMARY_VERSION};
}

export const MEMORY_SUMMARY_PROMPT = `从以下新增对话中提取对未来交流具有长期价值的核心记忆。
优先记录：用户的重要事实及偏好；双方发生的重要事件和共同经历；值得长期保留的约定、情感变化或关系发展；对已有记忆的纠正与更新。
用户明确说出的姓名、称呼、职业、居住地、生日、过敏信息、稳定喜好，以及双方明确达成的约定，均具有长期价值；即使出现在轻松闲聊中，也应提取，不需要用户额外要求“记住”。只有寒暄、临时话题、没有新增长期信息或与已有记忆重复时才返回空结果。虚构剧情中的重要经历应标为fiction，不当作用户的现实事实。
严格要求：
1. 最多 ${SUMMARY_MAX_ITEMS} 条，总计不超过 ${SUMMARY_MAX_CHARS} 个字，每条不超过 ${MEMORY_ITEM_MAX_CHARS} 字。
2. 简单事实按需简写；重要事件通常用80–200字，保留人物、起因、关键经过、结果、关系变化和未完成约定中对未来有价值的部分。一个完整事件写成一条，不为凑条数拆碎，也不为缩短字数丢掉影响后续剧情的因果。只记录对话实际提供的细节，不为了写长而补造。
3. 只记录有长期价值的信息，不记录普通闲聊。
4. 不编造、不重复、不把推测当事实。
5. 区分现实事实与虚构剧情。
6. 新事实与旧记忆冲突时，标记需要更新的事实，而不是简单追加。
7. 没有值得记录的内容则返回空结果。
只输出 JSON：{"operations":[{"action":"add|update|delete","id":"更新或删除时的已有记忆ID","content":"记忆正文","kind":"fact|event|agreement|relationship|fiction","factKey":"稳定事实属性，如user.home_city"}],"emptyReason":"仅空结果时简述原因"}。
新增记忆使用add，不填写id；update/delete的id必须逐字复制已有相关记忆的id，不能自行编号。不要因为没有旧记忆可更新就忽略新增事实。
无重要内容时 operations 为空数组。update/delete 只能引用提供的已有记忆。factKey必须描述稳定属性，城市统一user.home_city，偏好统一user.preference.<事物>，不要为同一事实换属性名。先核对已有事实和用户的删除要求。重要共同经历可用relationship，未完成约定用agreement；更新事件时保留仍然有效的重要经过，不要把完整事件退化成一句结论。用户明确表达的新信息才能更新现实事实；角色台词和剧情推演不能当作用户事实。`;

export function turnFingerprint(t:DialogTurn):string { return checksum(JSON.stringify([t.user.content,...t.assistants.map(m=>[m.id,selectedVersion(m).id,messageContent(m)])])); }
export function cursorFor(turns: DialogTurn[], previous?:MemoryCursor): MemoryCursor {
  const timestamp = Math.max(previous?.throughTimestamp||0, ...turns.map(t => t.user.timestamp));
  const processed={...previous?.processed},partial={...previous?.partial};
  for(const t of turns){if(t.progress && t.progress.next<t.progress.total)partial[t.user.id]={fingerprint:t.progress.fingerprint,offset:t.progress.next};else{processed[t.user.id]=turnFingerprint(t);delete partial[t.user.id];}}
  return { ...previous, throughTimestamp:timestamp,throughIds:[...new Set([...(previous?.throughTimestamp===timestamp?previous.throughIds:[]),...turns.filter(t=>t.user.timestamp===timestamp).map(t=>t.user.id)])],processed,partial };
}
export function initialMemoryState(messages: AgentSoulMessage[], scope: string): MemoryState { return { cursors: { [scope]: cursorFor(completeTurns(messages)) }, editVersion: 0, blocked: [] }; }
export function unsummarizedTurns(messages: AgentSoulMessage[], cursor?: MemoryCursor): DialogTurn[] {
  return completeTurns(messages).filter(t => cursor?.processed ? cursor.processed[t.user.id]!==turnFingerprint(t) : !cursor || t.user.timestamp > cursor.throughTimestamp || t.user.timestamp === cursor.throughTimestamp && !cursor.throughIds.includes(t.user.id));
}
export interface MemoryOperation { action: 'add' | 'update' | 'delete'; id?: string; content?: string; kind?: MemoryKind; factKey?: string }
export function summaryBatch(turns: DialogTurn[], maxTurns: number, tokenBudget = 24000, cursor?:MemoryCursor): DialogTurn[] {
  const batch: DialogTurn[] = []; let used = 0;
  for (const turn of turns.slice(0, maxTurns)) {
    const size = [turn.user, ...turn.assistants].reduce((n,m) => n + estimateTokens(messageContent(m)), 0);
    if (used + size > tokenBudget) {
      if(batch.length)break;
      const transcript=JSON.stringify({user:turn.user.content,replies:turn.assistants.map(m=>({speaker:m.senderName||'角色',content:messageContent(m)}))});
      const fingerprint=turnFingerprint(turn),old=cursor?.partial?.[turn.user.id];
      const offset=old?.fingerprint===fingerprint?old.offset:0;
      const excerpt=Array.from(transcript).slice(offset,offset+Math.max(64,Math.floor(tokenBudget*.65))).join('');
      batch.push({...turn,excerpt,progress:{fingerprint,offset,next:offset+Array.from(excerpt).length,total:Array.from(transcript).length}});break;
    }
    batch.push(turn); used += size;
  }
  if (!batch.length) throw new Error('首轮新增对话过长，未截断原文或推进记忆进度；请手动保存重要记忆');
  return batch;
}
export function validateOperations(value: unknown): MemoryOperation[] {
  const ops = (value as any)?.operations;
  if (!Array.isArray(ops) || ops.length > SUMMARY_MAX_ITEMS) throw new Error('记忆总结格式不符合要求');
  let total = 0;
  for (const op of ops) {
    if (!op || !['add', 'update', 'delete'].includes(op.action)) throw new Error('记忆操作无效');
    if (op.action !== 'delete') {
      if (typeof op.content !== 'string' || !op.content.trim() || memoryCharCount(op.content.trim()) > MEMORY_ITEM_MAX_CHARS) throw new Error('记忆正文超过限制');
      total += memoryCharCount(op.content.trim());
      if (!['fact', 'event', 'agreement', 'relationship', 'fiction'].includes(op.kind)) throw new Error('记忆类型无效');
    }
    if (op.action !== 'add' && typeof op.id !== 'string') throw new Error('缺少更新记忆ID');
    if (op.factKey !== undefined && (typeof op.factKey !== 'string' || op.factKey.length > 100)) throw new Error('记忆属性无效');
  }
  if (total > SUMMARY_MAX_CHARS) throw new Error('记忆总结总字数超过限制');
  return ops;
}
export function parseSummaryResult(raw: string): {operations:MemoryOperation[];emptyReason?:string} {
  let text=raw.trim().replace(/^\uFEFF/,'');
  const fenced=text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if(fenced)text=fenced[1];
  let value:unknown;
  try { value=JSON.parse(text); } catch { throw Error('记忆总结格式异常，未保存或推进进度'); }
  // Both structured operation arrays and {operations:[...]} retain the same validation.
  const operations=validateOperations(Array.isArray(value)?{operations:value}:value);
  const emptyReason=!operations.length && typeof (value as any)?.emptyReason==='string' ? (value as any).emptyReason.trim().slice(0,100) : undefined;
  return {operations,emptyReason};
}
export function parseSummaryOperations(raw:string):MemoryOperation[]{return parseSummaryResult(raw).operations;}
export async function summarizeNewTurns(turns: DialogTurn[], memories: MemoryNode[], signal?: AbortSignal, config?: LLMConfig, blocked:MemoryState['blocked']=[]): Promise<{ operations: MemoryOperation[]; relatedIds: string[];emptyReason?:string }> {
  const query = turns.map(t => t.user.content).join('\n');
  const related = recallMemories(query, memories, 16,undefined,1800);
  const blockedHints = recallMemories(query, blocked.map((m,i)=>({id:String(i),content:m.content,tags:[],weight:0,isFlashbulb:false,timestamp:i,factKey:m.factKey})), 12, undefined, 600);
  const selectedConfig=config || await getLLMConfig();
  const messages = [
    { role: 'system', content: MEMORY_SUMMARY_PROMPT },
    { role: 'user', content: JSON.stringify({ 新增对话: turns.map(t => t.excerpt ? {长对话资料片段:t.excerpt,片段进度:t.progress,说明:'这是同一完整对话的连续片段，人物身份按片段中的user与speaker判断，不把角色台词当用户事实'} : ({ user: t.user.content, replies: t.assistants.map(m => ({ speaker: m.senderName || '角色', content: messageContent(m) })) })), 已有相关记忆: related.map(m => ({ id: m.id, content: m.content, kind: m.kind || 'unverified', factKey: factIdentity(m.factKey,m.content), 手动确认:m.manualLocked })), 用户已删除或纠正禁止重新创建:blockedHints.map(b=>({content:b.content,factKey:factIdentity(b.factKey,b.content)})) }) },
  ];
  const remaining=contextWindowBudget(selectedConfig)-messages.reduce((n,m)=>n+estimateTokens(m.content),0)-512;
  if(remaining<512)throw Error('记忆资料超过模型上下文预算，未推进进度');
  const resp = await postChat({ config:selectedConfig, messages, stream: false, thinking: false, json: true, maxTokens:Math.min(8192,selectedConfig.caps.maxTokensCap,remaining), temperature: 0.2, timeoutMs: 90_000, signal });
  if (!resp.ok) throw new Error(friendlyHttpError(resp.status));
  const data = await resp.json();
  if(data?.error)throw Error('记忆总结接口返回错误，未推进进度');
  if(['length','max_tokens'].includes(data?.choices?.[0]?.finish_reason))throw Error('记忆总结被截断，未推进进度');
  const raw = data.choices?.[0]?.message?.content;
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('记忆总结没有返回结果');
  const result=parseSummaryResult(raw);
  if(result.operations.some(op=>op.action!=='add'&&!related.some(m=>m.id===op.id)))throw Error('模型引用了不存在的记忆ID，未保存或推进进度');
  return { ...result, relatedIds: related.map(m => m.id) };
}
export function applyMemoryOperations(memories: MemoryNode[], operations: MemoryOperation[], state: MemoryState, source: NonNullable<MemoryNode['source']>, relatedIds: string[]): MemoryNode[] {
  if(state.invalidSources?.some(s=>s.scope===source.conversationId&&(!s.messageIds||s.messageIds.some(id=>source.messageIds.includes(id)))))return memories;
  let result = [...memories]; const allowed = new Set(relatedIds);
  for (const op of operations) {
    const content = (op.content || '').trim(), normalized = normalizeMemory(content);
    const factKey=factIdentity(op.factKey,content);
    if (op.action!=='delete' && blockedMemory({content,factKey},state.blocked)) continue;
    let existing = op.id ? result.find(m => m.id === op.id && allowed.has(m.id)) : undefined;
    if (op.action !== 'add' && (!existing || existing.source && existing.source.characterId !== source.characterId)) continue;
    if (!existing && factKey) existing = result.find(m => factIdentity(m.factKey,m.content) === factKey && (op.kind==='fact' ? !m.kind||m.kind==='fact'||m.kind==='unverified' : m.kind===op.kind) && (!m.source || m.source.characterId === source.characterId));
    if (existing && (existing.kind === 'fiction') !== (op.kind === 'fiction') && op.action !== 'delete') continue;
    if (existing?.manualLocked) continue;
    if (op.action === 'delete') { result = result.map(m => m.id !== existing!.id ? m : {...m,inactive:true,history:[...(m.history||[]),{content:m.content,source:m.source,at:Date.now(),reason:'模型更新删除'}]}); continue; }
    if (result.some(m => m.id !== existing?.id && sameMemory(m.content,content))) continue;
    const node: MemoryNode = { ...existing, id: existing?.id || generateId(), content, kind: op.kind, factKey: factKey || existing?.factKey, inactive:false, core:existing?.corePreference==='always'||existing?.corePreference!=='topic'&&(op.kind==='agreement'||op.kind==='relationship'), history:existing ? [...(existing.history||[]),{content:existing.content,source:existing.source,at:Date.now(),reason:'新增对话更新'}] : [], tags: [op.kind || 'event'], weight: 80, isFlashbulb: false, isFact: op.kind === 'fact', timestamp: existing?.timestamp || Date.now(), updatedAt: Date.now(), source };
    result = existing ? result.map(m => m.id === existing!.id ? node : m) : [...result, node];
  }
  const core=selectCoreMemories(result.filter(m=>m.core&&!m.inactive));
  return result.map(m=>m.core&&!core.includes(m)?{...m,core:false}:m);
}
