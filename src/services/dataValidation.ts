import type { AgentSoulConversation, AgentSoulMessage } from '../types/agentsoul';
import type { MemoryNode, MemoryState } from '../types/memory';
import type { Moment } from '../types/moments';
import { versionsOf } from './storyEngine';
const object=(v:any)=>!!v && typeof v==='object' && !Array.isArray(v);
const text=(v:any)=>typeof v==='string';
const id=(v:any)=>text(v)&&v.length>0;
const time=(v:any)=>Number.isFinite(v)&&v>=0&&v<=8640000000000000;
const optional=(v:any,check:(x:any)=>boolean)=>v===undefined||check(v);
const strings=(v:any)=>Array.isArray(v)&&v.every(text);
const unique=(v:any[])=>v.every(object)&&new Set(v.map(x=>x.id)).size===v.length;
const aside=(v:any)=>object(v)&&text(v.content)&&time(v.duration)&&typeof v.collapsed==='boolean'&&optional(v.kind,(x:any)=>['character','legacy_reasoning'].includes(x));
export function validMessage(m:any,depth=0):m is AgentSoulMessage {
  if(!object(m)||!id(m.id)||!['user','assistant'].includes(m.role)||!text(m.content)||!time(m.timestamp))return false;
  if(!['rawText','meta','senderId','senderName','senderAvatar','error','inReplyTo','selectedReplyVersionId'].every(k=>optional(m[k],text))||!optional(m.isStreaming,(v:any)=>typeof v==='boolean')||!optional(m.thinking,aside))return false;
  if(!optional(m.versions,(v:any)=>Array.isArray(v)&&v.every((x:any)=>object(x)&&text(x.content)&&optional(x.thinking,aside)&&optional(x.splitMessages,(s:any)=>typeof s==='boolean'))))return false;
  if(!optional(m.versionIndex,(v:any)=>Number.isInteger(v)&&v>=0&&v<=(m.versions?.length||0)+1))return false;
  if(!optional(m.splitMessages,(v:any)=>typeof v==='boolean'))return false;
  if(!optional(m.replyVersions,(v:any)=>Array.isArray(v)&&v.length>0&&unique(v)&&v.every((x:any)=>object(x)&&id(x.id)&&text(x.content)&&time(x.createdAt)&&['model','edit','legacy'].includes(x.origin)&&optional(x.thinking,aside)&&optional(x.splitMessages,(s:any)=>typeof s==='boolean'))))return false;
  if(m.selectedReplyVersionId && !m.replyVersions?.some((v:any)=>v.id===m.selectedReplyVersionId))return false;
  return optional(m.legacyParts,(v:any)=>depth===0&&Array.isArray(v)&&v.every((p:any)=>validMessage(p,depth+1)));
}
export function validMemory(m:any):m is MemoryNode {
  if(!object(m)||!id(m.id)||!text(m.content)||!strings(m.tags)||!time(m.timestamp)||!Number.isFinite(m.weight)||typeof m.isFlashbulb!=='boolean')return false;
  if(!optional(m.updatedAt,time)||!optional(m.kind,(v:any)=>['fact','event','agreement','relationship','fiction','unverified'].includes(v))||!optional(m.factKey,text))return false;
  if(!['manualLocked','userConfirmed','inactive','core','isFact','ephemeral'].every(k=>optional(m[k],(v:any)=>typeof v==='boolean')))return false;
  if(!optional(m.source,(s:any)=>object(s)&&id(s.characterId)&&id(s.conversationId)&&['private','group','moments','manual'].includes(s.scene)&&strings(s.messageIds)&&optional(s.replies,(v:any)=>Array.isArray(v)&&v.every((r:any)=>object(r)&&id(r.messageId)&&id(r.versionId)))))return false;
  return optional(m.history,(v:any)=>Array.isArray(v)&&v.every((e:any)=>object(e)&&text(e.content)&&time(e.at)&&text(e.reason)));
}
export function validMemoryState(s:any):s is MemoryState {
  return object(s)&&object(s.cursors)&&Object.values(s.cursors).every((c:any)=>object(c)&&optional(c.summaryPromptVersion,(v:any)=>Number.isInteger(v)&&v>=0)&&optional(c.lastResult,(v:any)=>['saved','empty','unchanged'].includes(v))&&optional(c.lastResultNote,text)&&optional(c.lastSuccessAt,time)&&optional(c.lastSavedCount,(n:any)=>Number.isInteger(n)&&n>=0)&&time(c.throughTimestamp)&&strings(c.throughIds)&&optional(c.processed,(v:any)=>object(v)&&Object.values(v).every(text))&&optional(c.partial,(v:any)=>object(v)&&Object.values(v).every((x:any)=>object(x)&&text(x.fingerprint)&&Number.isInteger(x.offset)&&x.offset>=0)))&&Number.isSafeInteger(s.editVersion)&&s.editVersion>=0&&Array.isArray(s.blocked)&&s.blocked.every((b:any)=>object(b)&&text(b.content)&&optional(b.factKey,text)&&optional(b.messageIds,strings))&&optional(s.jobs,(v:any)=>object(v)&&Object.values(v).every((j:any)=>object(j)&&['private','group','moments'].includes(j.scene)&&Number.isSafeInteger(j.attempts)&&j.attempts>=0&&time(j.retryAt)&&optional(j.lastTrigger,text)&&optional(j.lastError,text)))&&optional(s.edits,(v:any)=>Array.isArray(v)&&v.every((e:any)=>object(e)&&validMemory(e.memory)&&time(e.at)&&['edit','delete','unlock'].includes(e.action)));
}
function messages(v:any):v is AgentSoulMessage[]{
  if(!Array.isArray(v)||!v.every(m=>validMessage(m))||!unique(v))return false;
  const users=new Set(v.filter(m=>m.role==='user').map(m=>m.id));
  return v.every(m=>!m.inReplyTo||users.has(m.inReplyTo));
}
function memories(v:any,role:string){return Array.isArray(v)&&v.every(m=>validMemory(m)&&(!m.source||m.source.characterId===role))&&unique(v);}
export function validConversations(v:unknown):v is AgentSoulConversation[]{
  if(!Array.isArray(v)||!unique(v)||!v.every(c=>object(c)&&id(c.id)&&text(c.name)&&time(c.createdAt)&&time(c.updatedAt)&&object(c.settings)&&messages(c.messages)&&optional(c.type,(x:any)=>['private','group'].includes(x))&&optional(c.memberIds,(x:any)=>strings(x)&&new Set(x).size===x.length)&&optional(c.memories,(x:any)=>memories(x,c.id))&&optional(c.memoryState,validMemoryState)))return false;
  const roles=new Set(v.filter(c=>c.type!=='group').map(c=>c.id));
  return v.every(c=>{
    const s=c.settings;
    if(!['avatar','userAvatar','backgroundImage'].every(k=>optional(c[k],text))||!optional(c.isPinned,(v:any)=>typeof v==='boolean'))return false;
    if(!['systemPrompt','background','scenario'].every(k=>optional(s[k],text))||!['temperature','topP','backgroundOpacity'].every(k=>optional(s[k],Number.isFinite))||!['pureTextMode','splitMessages'].every(k=>optional(s[k],(x:any)=>typeof x==='boolean')))return false;
    if(!optional(s.conversationMode,(x:any)=>['light','advanced'].includes(x))||!optional(s.memoryRecall,(x:any)=>object(x)&&typeof x.enabled==='boolean'&&Number.isInteger(x.interval)&&x.interval>=1&&x.interval<=50))return false;
    if(!optional(s.advanced,(x:any)=>object(x)&&optional(x.thoughtBaseline,(v:any)=>['极少','中等','较多','极多'].includes(v))&&['trustSpeed','defenseLevel','initiative'].every(k=>optional(x[k],(v:any)=>Number.isFinite(v)&&v>=0&&v<=100))))return false;
    if(!optional(s.temperature,(v:any)=>v>=0&&v<=2)||!optional(s.topP,(v:any)=>v>=0&&v<=1)||!optional(s.backgroundOpacity,(v:any)=>v>=0&&v<=100))return false;
    if(!optional(c.memoryState?.invalidSources,(v:any)=>Array.isArray(v)&&v.every((x:any)=>object(x)&&id(x.scope)&&optional(x.messageIds,strings))))return false;
    if(c.type==='group' && c.memberIds?.some((mid:string)=>!roles.has(mid)))return false;
    if(!optional(c.story,(x:any)=>object(x)&&id(x.activeId)&&optional(x.deletedIds,strings)&&Number.isInteger(x.revision)&&x.revision>=0&&Array.isArray(x.branches)&&unique(x.branches)&&!x.branches.some((b:any)=>b.id===x.activeId)&&x.branches.every((b:any)=>object(b)&&id(b.id)&&text(b.label)&&time(b.createdAt)&&messages(b.messages)&&memories(b.memories,c.id)&&optional(b.memoryState,validMemoryState))))return false;
    const known=[...c.messages,...(c.story?.branches||[]).flatMap((b:any)=>b.messages)];
    const references=[...(c.memories||[]),...(c.story?.branches||[]).flatMap((b:any)=>b.memories)].filter(m=>!m.inactive&&m.source?.scene==='private'&&m.source.conversationId===c.id&&m.source.replies?.length);
    if(references.length){
      const catalog=new Map<string,Set<string>>();
      for(const message of [...known,...known.flatMap(m=>m.legacyParts||[])])if(message.role==='assistant'){const ids=catalog.get(message.id)||new Set<string>();for(const version of versionsOf(message))ids.add(version.id);catalog.set(message.id,ids);}
      for(const m of references)if(m.source!.replies!.some((r:any)=>!catalog.get(r.messageId)?.has(r.versionId)))return false;
    }
    return true;
  });
}
export function validMoments(v:unknown):v is Moment[]{return Array.isArray(v)&&unique(v)&&v.every(m=>object(m)&&id(m.id)&&text(m.content)&&time(m.timestamp)&&strings(m.images)&&optional(m.imageDescriptions,strings)&&optional(m.aiIds,strings)&&optional(m.authorConvId,text)&&Array.isArray(m.comments)&&unique(m.comments)&&m.comments.every((c:any)=>object(c)&&id(c.id)&&id(c.aiConvId)&&text(c.aiName)&&text(c.content)&&time(c.timestamp)&&optional(c.replyToId,text)));}
export function validGroupMessages(v:unknown):v is AgentSoulMessage[]{return messages(v);}
/** Salvage whole valid records only. Never drop fields/messages inside a record or claim completeness. */
export function readableConversations(v:unknown):AgentSoulConversation[]|null {
  if(!Array.isArray(v))return null;
  const counts=new Map<string,number>();for(const c of v)if(object(c)&&id(c.id))counts.set(c.id,(counts.get(c.id)||0)+1);
  const candidates=v.filter(c=>object(c)&&counts.get(c.id)===1);
  const privateRoles=candidates.filter(c=>c.type!=='group'&&validConversations([c]));
  const groups=candidates.filter(c=>c.type==='group'&&validConversations([...privateRoles,c]));
  const usable=new Set([...privateRoles,...groups]);
  const result=v.filter(c=>usable.has(c));return result.length&&validConversations(result)?result:null;
}
export function conversationValidationIssue(v:unknown):string {
  if(!Array.isArray(v))return 'NOT_ARRAY';
  if(!unique(v))return 'DUPLICATE_OR_INVALID_CONVERSATION_ID';
  for(let i=0;i<v.length;i++){
    const c=v[i],base='conversation['+i+']';
    if(!object(c)||!id(c.id)||!text(c.name)||!time(c.createdAt)||!time(c.updatedAt))return base+'.IDENTITY_OR_TIME';
    if(!Array.isArray(c.messages))return base+'.MESSAGES_NOT_ARRAY';
    for(let j=0;j<c.messages.length;j++)if(!validMessage(c.messages[j]))return base+'.message['+j+'].INVALID_FIELDS';
    if(!messages(c.messages))return base+'.MESSAGE_LINK_OR_DUPLICATE';
    if(c.memories!==undefined&&!memories(c.memories,c.id))return base+'.MEMORY_FIELDS_OR_OWNER';
    if(c.memoryState!==undefined&&!validMemoryState(c.memoryState))return base+'.MEMORY_CURSOR';
    if(!validConversations([{...c,type:'private',memberIds:undefined}]))return base+'.SETTINGS_STORY_OR_MEMORY_REFERENCE';
  }
  return 'GROUP_MEMBER_REFERENCE';
}
