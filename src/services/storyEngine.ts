import type { AgentSoulConversation, AgentSoulMessage, ReplyVersion, StoryBranch } from '../types/agentsoul';
import type { MemoryNode } from '../types/memory';
import { blockedMemory } from './memoryIdentity';
import { generateId } from '../types/agentsoul';

export function versionsOf(m: AgentSoulMessage): ReplyVersion[] {
  const splitMessages=m.splitMessages ?? !!m.legacyParts?.length;
  return (m.replyVersions || [...(m.versions || []).map((v,i) => ({ ...v, id: `legacy:${m.id}:${i+1}`, createdAt: m.timestamp, origin: 'legacy' as const })), { id: `legacy:${m.id}:${(m.versions?.length || 0)+1}`, content: m.content, thinking: m.thinking, createdAt: m.timestamp, origin: 'legacy' as const }]).map(v=>({...v,splitMessages:v.splitMessages ?? splitMessages}));
}
export function selectedVersion(m: AgentSoulMessage): ReplyVersion {
  const all = versionsOf(m);
  return all.find(v => v.id === m.selectedReplyVersionId) || all[(m.versionIndex || all.length)-1] || all.at(-1)!;
}
export function withVersions(m: AgentSoulMessage, all: ReplyVersion[], selected: string): AgentSoulMessage {
  const latest = all.at(-1)!;
  return { ...m, content: latest.content, thinking: latest.thinking, splitMessages:latest.splitMessages ?? m.splitMessages ?? false, replyVersions: all, selectedReplyVersionId: selected, versions: all.slice(0,-1).map(v => ({ content: v.content, thinking: v.thinking,splitMessages:v.splitMessages })), versionIndex: Math.max(1,all.findIndex(v=>v.id===selected)+1) };
}
/** Canonicalize legacy split replies in memory. Original segments and their versions remain recoverable. */
export function canonicalMessages(messages: AgentSoulMessage[]): AgentSoulMessage[] {
  const result: AgentSoulMessage[] = []; let userId: string | undefined;
  for (const raw of messages) {
    if (raw.role === 'user' && raw.meta !== 'system') userId = raw.id;
    const m = raw.role === 'assistant' ? { ...raw, inReplyTo: raw.inReplyTo || userId } : raw;
    const last = result.at(-1);
    if (m.role === 'assistant' && last?.role === 'assistant' && m.inReplyTo && last.inReplyTo === m.inReplyTo && !m.senderId && !last.senderId && !m.replyVersions && !last.replyVersions) {
      const parts = [...(last.legacyParts || [last]), ...(m.legacyParts || [m])];
      const first=parts[0],tail=parts.slice(1).map(p=>selectedVersion(p).content).join('');
      result[result.length-1] = { ...last, content: first.content+tail, legacyParts: parts, versions: first.versions?.map(v=>({ ...v, content:v.content+tail })) };
    } else result.push(m);
  }
  return result.map(m => m.role === 'assistant' ? withVersions(m, versionsOf(m), selectedVersion(m).id) : m);
}
export function hydrateStory(c: AgentSoulConversation): AgentSoulConversation {
  if (c.type === 'group') return c;
  const deleted=new Set(c.story?.deletedIds||[]);
  const active = canonicalMessages(c.messages.filter(m=>!deleted.has(m.id)&&!deleted.has(m.inReplyTo||'')));
  const catalog = new Map<string, Map<string, ReplyVersion>>();
  for (const messages of [...(c.story?.branches || []).map(b=>canonicalMessages(b.messages)), active]) for (const m of messages.filter(m=>m.role==='assistant')) {
    const all = catalog.get(m.id) || new Map(); versionsOf(m).forEach(v=>all.set(v.id,v)); catalog.set(m.id,all);
  }
  const messages = active.map(m=>m.role==='assistant' ? withVersions(m,[...catalog.get(m.id)!.values()],selectedVersion(m).id) : m);
  return { ...c, messages };
}
export function hasFollowing(c: AgentSoulConversation, messageId: string) {
  const index = c.messages.findIndex(m=>m.id===messageId);
  return index >= 0 && c.messages.slice(index+1).some(m=>m.role==='user' && m.meta!=='system');
}
function snapshot(c: AgentSoulConversation): StoryBranch {
  return { id:c.story?.activeId || `original:${c.id}`, label: new Date().toLocaleString('zh-CN')+' · '+(c.messages.at(-1)?.content || '原剧情').slice(0,24), createdAt:Date.now(), messages:c.messages, memories:c.memories || [], memoryState:c.memoryState };
}
const derived = (m: MemoryNode,c:AgentSoulConversation) => !m.manualLocked && !m.userConfirmed && m.source?.scene==='private' && m.source.conversationId===c.id && m.source.messageIds.length>0;
export function activeMemories(c: AgentSoulConversation): MemoryNode[] {
  const selected = new Map(c.messages.filter(m=>m.role==='assistant').map(m=>[m.id,selectedVersion(m).id]));
  // Original split segments remain provenance for their unedited legacy unit.
  // An edited/model version is a new whole reply and cannot reactivate them.
  for(const m of c.messages)if(m.role==='assistant'&&selectedVersion(m).origin==='legacy')for(const part of m.legacyParts||[])if(part.id!==m.id)selected.set(part.id,selectedVersion(part).id);
  const ids = new Set(c.messages.flatMap(m=>[m.id,...(m.legacyParts || []).map(p=>p.id)]));
  return (c.memories || []).filter(m=>!m.inactive && (!derived(m,c) || (m.source!.messageIds.every(id=>ids.has(id)) && (m.source!.replies || []).every(r=>selected.get(r.messageId)===r.versionId))));
}
export function changeReply(c: AgentSoulConversation, id:string, change:{ content:string; origin:'model'|'edit'; thinking?:AgentSoulMessage['thinking']; splitMessages?:boolean } | { versionId:string }): AgentSoulConversation {
  c=hydrateStory(c); const index=c.messages.findIndex(m=>m.id===id); if(index<0 || c.messages[index].role!=='assistant') throw Error('请选择一条 AI 回复');
  const message=c.messages[index], all=versionsOf(message), previous=snapshot(c);
  if ('versionId' in change && selectedVersion(message).id===change.versionId) return c;
  // Selecting an earlier version restores the matching continuation, not merely its visible text.
  if ('versionId' in change) {
    if(!all.some(v=>v.id===change.versionId)) throw Error('回复版本不存在');
    const branch=c.story?.branches.find(b=>{
      const candidate=b.messages.find(m=>m.id===id);
      return candidate && selectedVersion(candidate).id===change.versionId && c.messages.slice(0,index).every((m,i)=>b.messages[i]?.id===m.id && (m.role!=='assistant' || selectedVersion(b.messages[i]).id===selectedVersion(m).id));
    });
    if(branch) return restoreStoryBranch(c,branch.id);
  }
  const version:ReplyVersion = 'content' in change ? { ...change, splitMessages:change.splitMessages ?? selectedVersion(message).splitMessages ?? false, id:generateId(),createdAt:Date.now() } : all.find(v=>v.id===change.versionId)!;
  if('content' in change && !change.content.trim()) throw Error('回复不能为空');
  const nextMessages=[...c.messages.slice(0,index),withVersions({ ...message,error:undefined,isStreaming:false },'content' in change ? [...all,version] : all,version.id)];
  const prefixIds=new Set(nextMessages.flatMap(m=>[m.id,...(m.legacyParts||[]).map(p=>p.id)]));
  const changedIds=new Set([id,...(message.legacyParts||[]).map(p=>p.id)]);
  const memories=(c.memories || []).filter(m=>!derived(m,c) || (m.source!.messageIds.every(mid=>prefixIds.has(mid)) && !m.source!.messageIds.some(mid=>changedIds.has(mid))));
  const unchanged=new Set(nextMessages.slice(0,-1).filter(m=>m.role==='user').map(m=>m.id));
  const cursor=c.memoryState?.cursors[c.id];
  return { ...c,messages:nextMessages,memories,memoryState:c.memoryState ? { ...c.memoryState,editVersion:c.memoryState.editVersion+1,cursors:{...c.memoryState.cursors,[c.id]:{throughTimestamp:0,throughIds:[],processed:Object.fromEntries(Object.entries(cursor?.processed||{}).filter(([id])=>unchanged.has(id)&&id!==message.inReplyTo))}},jobs:{...c.memoryState.jobs,[c.id]:{scene:'private',attempts:0,retryAt:0}} } : undefined,story:{...c.story,activeId:generateId(),revision:(c.story?.revision || 0)+1,branches:[...(c.story?.branches || []).filter(b=>b.id!==previous.id),previous]},updatedAt:Date.now() };
}
export function restoreStoryBranch(c:AgentSoulConversation,id:string):AgentSoulConversation {
  const branch=c.story?.branches.find(b=>b.id===id); if(!branch)throw Error('历史剧情不存在');
  const shared=(c.memories || []).filter(m=>!derived(m,c));
  for(const m of branch.memories.filter(m=>!derived(m,c)))if(!shared.some(current=>current.id===m.id || current.factKey&&current.factKey===m.factKey)&&!blockedMemory(m,c.memoryState?.blocked||[])&&!m.inactive)shared.push(m);
  const own=branch.memories.filter(m=>derived(m,c) && !blockedMemory(m,c.memoryState?.blocked||[]));
  const memories=[...shared,...own.filter(m=>!shared.some(s=>s.id===m.id))];
  const memoryState=c.memoryState ? { ...c.memoryState,editVersion:c.memoryState.editVersion+1,cursors:{...c.memoryState.cursors,[c.id]:branch.memoryState?.cursors[c.id] || {throughTimestamp:0,throughIds:[],processed:{}}},jobs:{...c.memoryState.jobs,[c.id]:{scene:'private' as const,attempts:0,retryAt:0}} } : branch.memoryState;
  return hydrateStory({ ...c,messages:branch.messages,memories,memoryState,story:{...c.story,activeId:branch.id,revision:(c.story?.revision || 0)+1,branches:[...c.story!.branches.filter(b=>b.id!==id),snapshot(c)]},updatedAt:Date.now() });
}
