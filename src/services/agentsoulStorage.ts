import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import type { AgentSoulConversation, AgentSoulMessage } from '../types/agentsoul';
import { DEFAULT_SETTINGS, generateId } from '../types/agentsoul';
import { SnapshotStore, checksum } from './snapshotStore';
import { recordStorageRead, readFailureReason, storageReadReport } from './storageDiagnostics';
import { loadPersonas } from './personaStorage';
const MAIN = '@agentsoul_conversations';
const ACTIVE = '@agentsoul_active';
const BACKUPS = [MAIN + '_backup', MAIN + '_backup2', MAIN + '_corrupt_backup'];
const FILE = (FileSystem.documentDirectory || '') + 'soulmate_conversations.json';
let uncertain = false, initialized = false;
let continuityActive = false, damagedContinuity = false;
let unresolvedHistory = false;
let loading: Promise<LoadConversationsResult> | null = null;
let failureHandler: ((message: string) => void) | null = null;
let pending: string | null = null;
let saveRevision = 0, pendingRevision = 0, inFlightWrites = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let waiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
let flushing: Promise<boolean> = Promise.resolve(true);
import { validConversations, readableConversations, conversationValidationIssue } from './dataValidation';
export { validConversations } from './dataValidation';
const store = new SnapshotStore<AgentSoulConversation[]>('@soulmate_conversations_commit_v1', 'soulmate_conversations.commit.json', validConversations,false,false,readableConversations,conversationValidationIssue);
// Protection of an ambiguous original must not disable chat. Keep subsequent
// changes in an independent verified snapshot; never repair/merge originals here.
export const CONTINUITY_KEY = '@soulmate_conversations_continuity_commit_v1';
export const CONTINUITY_FILE = 'soulmate_conversations.continuity.commit.json';
const continuity = new SnapshotStore<AgentSoulConversation[]>(CONTINUITY_KEY, CONTINUITY_FILE, validConversations, false, true,readableConversations,conversationValidationIssue);
function parse(raw: string | null): AgentSoulConversation[] | null { if (!raw) return null; try { const v = JSON.parse(raw); return validConversations(v) ? v : null; } catch { return null; } }
async function legacyFile(uri: string): Promise<string | null> { return (await FileSystem.getInfoAsync(uri)).exists ? FileSystem.readAsStringAsync(uri) : null; }
export interface LoadConversationsResult { conversations: AgentSoulConversation[]; corrupt: boolean; recovered?: boolean; unreadable?: boolean; recoverableCount?: number; incomplete?: boolean }
export function setWriteFailureHandler(fn: typeof failureHandler) { failureHandler = fn; }
export function isStorageUncertain() { return uncertain; }
export function hasPendingConversationWrites() { return pending !== null || inFlightWrites > 0; }
export function clearStorageUncertain() { uncertain = false; }
async function readOriginalHistory(): Promise<LoadConversationsResult> {
  const committed = await store.read();
  if (committed.value !== null) return { conversations: committed.value, corrupt: false };
  // Never fall back to an older snapshot when a newer deletion may have committed.
  if (committed.damaged) return { conversations: committed.available || [], corrupt: true, unreadable: true, incomplete:committed.available===undefined||!!committed.partial };
  const labels=[MAIN,'soulmate_conversations.json','soulmate_conversations.bak.json',...BACKUPS];
  const sources = await Promise.allSettled([AsyncStorage.getItem(MAIN), legacyFile(FILE), legacyFile(FILE.replace('.json', '.bak.json')), ...BACKUPS.map(k => AsyncStorage.getItem(k))]);
  const raws = sources.map(r => r.status === 'fulfilled' ? r.value : null), values = raws.map(parse);
  sources.forEach((r,i)=>{
    let invalid='INVALID_JSON';if(r.status==='fulfilled'&&r.value!==null&&values[i]===null)try{invalid=conversationValidationIssue(JSON.parse(r.value));}catch{}
    recordStorageRead(labels[i],r.status==='rejected'?readFailureReason(r.reason):r.value===null?'MISSING':values[i]!==null?`VALID_LEGACY conversations=${values[i]!.length} chars=${r.value.length}`:invalid+' chars='+r.value.length);
  });
  const readable=raws.map((raw,i)=>{if(values[i]!==null)return values[i];try{return raw===null?null:readableConversations(JSON.parse(raw));}catch{return null;}});
  const primary = readable.slice(0, 2).filter((v): v is AgentSoulConversation[] => v !== null);
  const conflict = primary.length === 2 && JSON.stringify(primary[0]) !== JSON.stringify(primary[1]);
  const damage = sources.slice(0, 2).some(r => r.status === 'rejected') || raws.slice(0, 2).some((r, i) => r !== null && !values[i]);
  const incomplete=readable.slice(0,2).some((v,i)=>v!==null&&values[i]===null)||damage&&!primary.length;
  return {conversations:primary[0] || values.slice(2).find(v=>v!==null) || [],corrupt:conflict||damage||(!primary.length&&values.slice(2).some(v=>v!==null)),unreadable:damage||undefined,incomplete};
}
function missingOriginals(current:AgentSoulConversation[],original:AgentSoulConversation[]) {
  return original.filter(old=>{
    const fingerprint=checksum(JSON.stringify(old));
    if(current.some(c=>c.recoveredFrom?.conversationId===old.id&&c.recoveredFrom.fingerprint===fingerprint))return false;
    const live=current.find(c=>c.id===old.id);if(!live)return true;
    const ids=new Set([...live.messages,...(live.story?.branches||[]).flatMap(b=>b.messages)].flatMap(m=>[m.id,...(m.legacyParts||[]).map(p=>p.id)]));
    for(const id of live.story?.deletedIds||[])ids.add(id);
    return [...old.messages,...(old.story?.branches||[]).flatMap(b=>b.messages)].some(m=>!ids.has(m.id));
  });
}
export interface HistoryRecoveryPreview { count:number; messages:number; token:string; diagnostic:string }
export async function inspectOriginalHistory(current:AgentSoulConversation[]):Promise<HistoryRecoveryPreview> {
  const original=await readOriginalHistory(),missing=missingOriginals(current,original.conversations);
  return {count:missing.length,messages:missing.reduce((n,c)=>n+c.messages.length,0),token:checksum(JSON.stringify(original.conversations)),diagnostic:storageReadReport()};
}
/** Explicit confirmation is required: a pre-continuation copy may contain intentional deletions. */
export async function prepareOriginalHistoryCopies(current:AgentSoulConversation[],token:string) {
  const original=await readOriginalHistory();
  if(checksum(JSON.stringify(original.conversations))!==token)throw Error('历史来源已变化，请重新读取后确认');
  const missing=missingOriginals(current,original.conversations);
  const personas=missing.some(c=>c.type!=='group'&&c.memories===undefined)?await loadPersonas():{};
  const mapping=new Map(missing.map(c=>[c.id,generateId()]));
  const remap=(id:string)=>mapping.get(id)||id;
  const scope=(id:string)=>id.startsWith('moments:')?'moments:'+remap(id.slice(8)):remap(id);
  const scopeMap=(v:Record<string,any>|undefined)=>v&&Object.fromEntries(Object.entries(v).map(([key,value])=>[scope(key),value]));
  const source=(s:any)=>s&&({...s,characterId:remap(s.characterId),conversationId:scope(s.conversationId)});
  const memory=(m:any)=>({...m,source:source(m.source),history:m.history?.map((e:any)=>({...e,source:source(e.source)}))});
  const state=(s:any)=>s&&({...s,cursors:scopeMap(s.cursors),jobs:scopeMap(s.jobs),invalidSources:s.invalidSources?.map((v:any)=>({...v,scope:scope(v.scope)})),edits:s.edits?.map((v:any)=>({...v,memory:memory(v.memory)}))});
  const message=(m:AgentSoulMessage):AgentSoulMessage=>({...m,senderId:m.senderId?remap(m.senderId):undefined,legacyParts:m.legacyParts?.map(message)});
  const copies=missing.map(c=>({...c,id:remap(c.id),recoveredFrom:{conversationId:c.id,fingerprint:checksum(JSON.stringify(c))},memberIds:c.memberIds?.map(remap),messages:c.messages.map(message),memories:(c.memories??personas[c.id]?.memories)?.map(memory),memoryState:state(c.memoryState),story:c.story&&{...c.story,branches:c.story.branches.map(b=>({...b,messages:b.messages.map(message),memories:b.memories.map(memory),memoryState:state(b.memoryState)}))}}));
  const conversations=[...current,...copies];
  if(!validConversations(conversations))throw Error('找回后的关联校验未通过，当前聊天和原记录均未修改');
  return {conversations,copies,groups:missing.filter(c=>c.type==='group').map(c=>({from:c.id,to:remap(c.id),mapMessage:message}))};
}
export function loadConversations(): Promise<LoadConversationsResult> {
  if (loading) return loading;
  loading = (async () => {
    const continued = await continuity.read();
    if (continued.value !== null) {
      // Continuation is not evidence that the protected original was recovered.
      // Inspect it on every explicit reload/startup, without merging or replacing it.
      const original=await readOriginalHistory(),missing=missingOriginals(continued.value,original.conversations);
      continuityActive=true;damagedContinuity=false;unresolvedHistory=missing.length>0||!!original.incomplete;uncertain=unresolvedHistory;initialized=true;
      return {conversations:continued.value,corrupt:uncertain,recoverableCount:missing.length};
    }
    // An unreadable engine stays untouched by preserveUnreadable. Its verified
    // peer needs no additional full-history archive on every app restart.
    if (continued.damaged) { continuityActive = true; damagedContinuity = !continued.unreadableOnly; unresolvedHistory=continued.available===undefined||!!continued.partial;uncertain = true; initialized = true; return { conversations: continued.available || [], corrupt: true, unreadable: true }; }
    const original=await readOriginalHistory();
    initialized=true;uncertain=original.corrupt;unresolvedHistory=!!original.incomplete;continuityActive=uncertain;return original;
  })().finally(() => { loading = null; });
  return loading;
}
async function persist(payload: string) {
  if (!initialized) await loadConversations();
  if (continuityActive) {
    if (damagedContinuity) {
      // A second storage fault must not destroy the first protected continuation.
      // Preserve every readable byte first; the store never writes to an engine
      // whose current payload/receipt cannot be read (e.g. Android large rows).
      const uri = (FileSystem.documentDirectory || '') + CONTINUITY_FILE;
      const reads = await Promise.allSettled([AsyncStorage.getItem(CONTINUITY_KEY), legacyFile(uri), AsyncStorage.getItem(CONTINUITY_KEY + ':head'), legacyFile(uri + '.head'),legacyFile(uri+'.replica')]);
      const raw = JSON.stringify({values: reads.map(r => r.status === 'fulfilled' ? r.value : null), unreadable: reads.flatMap((r, i) => r.status === 'rejected' ? [i] : [])});
      const archive = '@soulmate_recovery_archive_continuity_' + generateId();
      const writes = await Promise.allSettled([
        (async () => { await AsyncStorage.setItem(archive, raw); if (await AsyncStorage.getItem(archive) !== raw) throw Error('原文保护校验失败'); })(),
        (async () => { const file = (FileSystem.documentDirectory || '') + archive.slice(1) + '.json'; await FileSystem.writeAsStringAsync(file, raw); if (await FileSystem.readAsStringAsync(file) !== raw) throw Error('原文保护校验失败'); })(),
      ]);
      if (writes.every(w => w.status === 'rejected')) throw Error('原记录尚未安全保留；可继续聊天，请保留当前页面并重试保存');
    }
    await continuity.writeSerialized(payload); damagedContinuity = false; uncertain = unresolvedHistory;
  } else await store.writeSerialized(payload);
  // Original arrays/files remain untouched as a rollback baseline; no destructive migration.
}
export function saveConversations(convs: AgentSoulConversation[]): Promise<void> {
  pending = JSON.stringify(convs);
  pendingRevision = ++saveRevision;
  const promise = new Promise<void>((resolve, reject) => waiters.push({ resolve, reject }));
  if (!timer) timer = setTimeout(() => { void flushConversationsNow(); }, 300);
  return promise;
}
export function flushConversationsNow(): Promise<boolean> {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!pending) return flushing;
  const snapshot = pending, revision = pendingRevision, listeners = waiters; pending = null; waiters = [];
  inFlightWrites++;
  flushing = flushing.then(async () => {
    try { await persist(snapshot); listeners.forEach(w => w.resolve()); return true; }
    catch (error) { const e = error instanceof Error ? error : new Error('保存失败'); if (!pending && revision === saveRevision) { pending = snapshot; pendingRevision = revision; } failureHandler?.(e.message); listeners.forEach(w => w.reject(e)); return false; }
    finally { inFlightWrites--; }
  });
  return flushing;
}
export async function writeConversationsImmediate(convs: AgentSoulConversation[], _skipBackup = false): Promise<boolean> {
  await flushConversationsNow(); const promise = saveConversations(convs); const [_, ok] = await Promise.all([promise, flushConversationsNow()]); return ok;
}
export async function peekCorruptBackup(): Promise<AgentSoulConversation[] | null> { for (const key of BACKUPS) { const v = parse(await AsyncStorage.getItem(key)); if (v) return v; } return null; }
export async function restoreCorruptBackup(): Promise<boolean> {
  if (continuityActive) {if(!await flushConversationsNow())return false;return !(await loadConversations()).corrupt;}
  const current = await store.read();
  if (current.value !== null) { uncertain = false; return true; }
  // Explicit recovery preserves every known message ID. Never merge legacy copies automatically.
  const raws = await Promise.all([AsyncStorage.getItem(MAIN), ...BACKUPS.map(k => AsyncStorage.getItem(k)), legacyFile(FILE), legacyFile(FILE.replace('.json', '.bak.json'))].map(p => p.catch(() => null)));
  const candidates = raws.map(parse).filter((v): v is AgentSoulConversation[] => !!v);
  if (!candidates.length) return false;
  const byId = new Map<string, AgentSoulConversation>();
  for (const list of candidates) for (const conv of list) {
    const prev = byId.get(conv.id); if (!prev) { byId.set(conv.id, conv); continue; }
    const newer = conv.updatedAt > prev.updatedAt ? conv : prev;
    const messages = new Map(prev.messages.map(m => [m.id, m]));
    conv.messages.forEach(m => { if (!messages.has(m.id)) messages.set(m.id, m); });
    byId.set(conv.id, { ...newer, messages: [...messages.values()].sort((a, b) => a.timestamp - b.timestamp) });
  }
  try {
    const protectedRaw=JSON.stringify({createdAt:Date.now(),kv:await AsyncStorage.getItem('@soulmate_conversations_commit_v1'),head:await AsyncStorage.getItem('@soulmate_conversations_commit_v1:head'),file:await legacyFile((FileSystem.documentDirectory||'')+'soulmate_conversations.commit.json'),fileHead:await legacyFile((FileSystem.documentDirectory||'')+'soulmate_conversations.commit.json.head')});
    const rescueKey='@soulmate_recovery_archive_legacy_'+Date.now();
    await AsyncStorage.setItem(rescueKey,protectedRaw);if(await AsyncStorage.getItem(rescueKey)!==protectedRaw)throw Error('原始损坏记录未能归档，未开始恢复');
    await store.write([...byId.values()]); uncertain = false; initialized = true; return true;
  } catch { return false; }
}
export async function confirmDiscardCorruptData(): Promise<void> {
  if (timer) clearTimeout(timer); timer = null; pending = null;
  waiters.splice(0).forEach(w => w.reject(new Error('已取消旧数据保存'))); await flushing;
  await (continuityActive ? continuity : store).write([]); uncertain = false; initialized = true;
}
export async function saveActiveId(id: string | null) { if (id) await AsyncStorage.setItem(ACTIVE, id); else await AsyncStorage.removeItem(ACTIVE); }
export async function loadActiveId(): Promise<string | null> { return AsyncStorage.getItem(ACTIVE).catch(() => null); }
export function createConversation(name?: string): AgentSoulConversation { return { id: generateId(), name: name || '新对话', isPinned: false, settings: { ...DEFAULT_SETTINGS }, messages: [], energy: 60, relationshipTemp: 30, interactionCount: 0, createdAt: Date.now(), updatedAt: Date.now() }; }
export function createMessage(role: 'user' | 'assistant', content: string): AgentSoulMessage { return { id: generateId(), role, content, timestamp: Date.now() }; }
export type ThinkingMode = 'auto' | 'manual' | 'off';
export async function loadThinkingMode(): Promise<ThinkingMode> { const v = await AsyncStorage.getItem('@agentsoul_thinking_mode').catch(() => null); return v === 'auto' || v === 'manual' || v === 'off' ? v : 'auto'; }
export async function saveThinkingMode(mode: ThinkingMode) { await AsyncStorage.setItem('@agentsoul_thinking_mode', mode); }
export async function loadAutoExpandThinking() { return (await loadThinkingMode()) === 'auto'; }
export async function saveAutoExpandThinking(v: boolean) { await saveThinkingMode(v ? 'auto' : 'manual'); }
