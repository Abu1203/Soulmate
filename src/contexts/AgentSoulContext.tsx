import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AgentSoulConversation, AgentSoulMessage, AgentSoulSettings } from '../types/agentsoul';
import type { AgentSoulPersona } from '../types/persona';
import type { MemoryNode, MemoryState } from '../types/memory';
import { generateId } from '../types/agentsoul';
import { loadConversations, saveConversations, flushConversationsNow, restoreCorruptBackup, confirmDiscardCorruptData, isStorageUncertain, hasPendingConversationWrites, setWriteFailureHandler, loadActiveId, saveActiveId, createConversation, createMessage, loadThinkingMode, saveThinkingMode, validConversations, type ThinkingMode } from '../services/agentsoulStorage';
import { getApiKey } from '../services/storage';
import { getLLMConfig, contextWindowBudget } from '../services/llmProviders';
import { loadPersonas } from '../services/personaStorage';
import { SoulService } from '../services/SoulService';
import { removeGroupMessages } from '../services/groupStorage';
import { groupRequestTasks, momentRequestTasks, RequestTasks } from '../services/requestTask';
import { parseUserMessage } from '../utils/messageParser';
import { initialMemoryState, unsummarizedTurns, summarizeNewTurns, applyMemoryOperations, cursorFor, summaryBatch, turnFingerprint, reopenEmptySummary, MEMORY_SUMMARY_VERSION } from '../services/memorySummary';
import { normalizeMemory } from '../services/memoryEngine';
import { hydrateStory, changeReply, restoreStoryBranch, versionsOf, selectedVersion, activeMemories, hasFollowing } from '../services/storyEngine';
import { completeTurns } from '../services/conversationContext';
import { loadGroupMessages } from '../services/groupStorage';
import { loadMoments, removeMoment } from '../services/momentsStorage';
import { momentDialogForCharacter } from '../services/momentsContext';
import { factIdentity, sameMemory, blockedMemory } from '../services/memoryIdentity';
import { CORE_MEMORY_MAX_ITEMS, CORE_MEMORY_MAX_CHARS, MEMORY_ITEM_MAX_CHARS, memoryCharCount } from '../services/memoryPolicy';
import { abortable } from '../services/abortable';
import { inspectOriginalHistory, prepareOriginalHistoryCopies, writeConversationsImmediate, type HistoryRecoveryPreview } from '../services/agentsoulStorage';
import { saveGroupMessages } from '../services/groupStorage';

export interface ImmediateMemoryResult { savedCount:number; remainingTurns:number; note?:string }
interface AgentSoulContextType {
  recallMemoryNow:(id:string)=>Promise<ImmediateMemoryResult>;
  inspectHistoryRecovery:()=>Promise<HistoryRecoveryPreview>;
  recoverHistoryCopies:(token:string)=>Promise<number>;
  runDataRecovery:(action:()=>Promise<void>)=>Promise<void>;
  conversations: AgentSoulConversation[]; activeConversation: AgentSoulConversation | null;
  personas: Record<string, AgentSoulPersona>; ensurePersona: (c: AgentSoulConversation) => AgentSoulPersona;
  updatePersona: (id: string, patch: Partial<AgentSoulPersona>) => void;
  isStreaming: boolean; hasApiKey: boolean; selectionMode: boolean; selectedIds: Set<string>;
  setSelectionMode: (v: boolean) => void; toggleSelectedId: (id: string) => void; deleteSelectedConversations: () => Promise<void>;
  loadList: () => Promise<void>; createNew: () => Promise<string>; addConversation: (c: AgentSoulConversation) => Promise<void>;
  selectConversation: (id: string) => void; deleteConversation: (id: string) => Promise<void>;
  updateConversation: (id: string, patch: Partial<AgentSoulConversation>) => Promise<void>;
  updateSettings: (id: string, patch: Partial<AgentSoulSettings>) => Promise<void>; togglePin: (id: string) => Promise<void>;
  sendMessage: (text: string, files?: Array<{ uri: string; name: string }>, conversationId?:string) => Promise<void>; stopMessage: () => void;
  retryMessage: (id: string, confirmed?: boolean) => Promise<void>; switchMessageVersion: (id: string, dir: 1 | -1, confirmed?:boolean) => Promise<void>;
  editReply: (id:string,content:string,confirmed?:boolean)=>Promise<void>; restoreBranch:(id:string,confirmed?:boolean)=>Promise<void>;
  unlockMemory:(id:string,memoryId:string)=>Promise<void>; setCoreMemory:(id:string,memoryId:string,core:boolean)=>Promise<void>;
  restoreMemory:(id:string,index:number)=>Promise<void>; deleteMomentAndMemories:(id:string)=>Promise<void>; retryMemoryTasks:(id?:string)=>Promise<void>;
  deleteMessage: (id: string) => void; deleteMessages: (ids: Set<string>) => void;
  addSystemMessage: (content: string) => void; addSystemMessageTo: (id: string, content: string, messageId?: string) => Promise<void>;
  addMemoryToConversation: (id: string, content: string, tags?: string[]) => void;
  editMemory: (id: string, memoryId: string, content: string) => Promise<void>; deleteMemory: (id: string, memoryId: string) => Promise<void>;
  prepareMemoryScope: (id: string, messages: AgentSoulMessage[], scope: string) => Promise<void>;
  summarizeConversation: (id: string, messages?: AgentSoulMessage[], scope?: string, scene?: 'private' | 'group' | 'moments') => Promise<void>;
  checkApiKey: () => Promise<boolean>; thinkingMode: ThinkingMode; toggleThinkingMode: () => Promise<void>;
  storageWarning: string | null; dismissStorageWarning: () => void; restoreCorruptData: () => Promise<boolean>;
  retryPendingSave: () => Promise<boolean>; storageUncertain: boolean; discardCorruptData: () => Promise<void>;
}
const AgentSoulContext = createContext<AgentSoulContextType | null>(null);
export function AgentSoulProvider({ children }: { children: React.ReactNode }) {
  const [conversations, setConversations] = useState<AgentSoulConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>('auto');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [storageUncertainState, setStorageUncertainState] = useState(false);
  const [, renderRequests] = useState(0);
  const [legacyPersonas, setLegacyPersonas] = useState<Record<string, AgentSoulPersona>>({});
  const convsRef = useRef(conversations), activeRef = useRef(activeId), thinkingRef = useRef(thinkingMode);
  const loaded = useRef(false), loading = useRef<Promise<void> | null>(null);
  const creating = useRef<Promise<string> | null>(null);
  const mutations = useRef<Promise<unknown>>(Promise.resolve());
  const pendingChatCommits = useRef(0);
  const tasks = useRef(new RequestTasks());
  const summaryTasks = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);
  const recovering=useRef(false),recoveryExclusive=useRef(false);
  const memoryTimers=useRef(new Map<string,ReturnType<typeof setTimeout>>());
  const resumeMemory=useRef<()=>Promise<void>>(async()=>{});
  thinkingRef.current = thinkingMode;
  const showError = useCallback((error: unknown) => setStorageWarning(error instanceof Error ? error.message : '操作失败，请重试'), []);
  const display = useCallback((next: AgentSoulConversation[]) => { convsRef.current = next; if (mounted.current) setConversations(next); }, []);
  const selectConversation = useCallback((id: string) => { activeRef.current = id || null; setActiveId(id || null); saveActiveId(id || null).catch(showError); }, [showError]);
  const loadList = useCallback((): Promise<void> => {
    if (loading.current) return loading.current;
    loading.current = (async () => {
      const beforeRead = convsRef.current, selectionBeforeRead = activeRef.current;
      if (loaded.current && (pendingChatCommits.current > 0 || hasPendingConversationWrites() || convsRef.current.some(c => tasks.current.busy(c.id)))) {
        if (hasPendingConversationWrites()) setStorageWarning('有消息尚未保存，可继续聊天；请保留当前页面并重试保存');
        return;
      }
      const result = await loadConversations();
      let archive: Record<string, AgentSoulPersona> = {};
      try { archive = await loadPersonas(); } catch { setStorageWarning('旧角色副本暂不可读，原副本已保留；未将其当作空数据覆盖'); }
      // A read can finish after a new message/settings change has already saved.
      // Never publish that older read over the newer in-memory conversation.
      if (loaded.current && (convsRef.current !== beforeRead || pendingChatCommits.current > 0 || hasPendingConversationWrites() || convsRef.current.some(c => tasks.current.busy(c.id)))) return;
      setLegacyPersonas(archive);
      // Keep an existing working list during uncertainty, but allow an initially
      // empty protection screen to display a subsequently verified available peer.
      const values = (loaded.current && result.corrupt && convsRef.current.length ? convsRef.current : result.conversations).map(c => {
        const messages = c.messages.map(m => m.isStreaming ? { ...m, isStreaming: false, error: '上次生成已中断，请重新生成' } : m);
        const value=hydrateStory({ ...c, memories: c.memories ?? archive[c.id]?.memories, messages, memoryState: c.memoryState || initialMemoryState(messages, c.id) });
        // Upgrade only the cursor metadata in memory; preserve legacy bytes and do not backfill all history.
        if(value.memoryState && !value.memoryState.cursors[c.id]?.processed){const old=value.memoryState.cursors[c.id];if(old)value.memoryState={...value.memoryState,cursors:{...value.memoryState.cursors,[c.id]:{...old,...cursorFor(completeTurns(value.messages).filter(t=>t.user.timestamp<old.throughTimestamp||t.user.timestamp===old.throughTimestamp&&old.throughIds.includes(t.user.id)))}}};}
        if(value.type!=='group'&&value.settings.memoryRecall?.enabled!==false&&value.memoryState&&!value.memoryState.blocked.length&&!activeMemories(value).length){
          const old=value.memoryState.cursors[c.id],cursor=reopenEmptySummary(value.messages,old,value.settings.memoryRecall?.interval||10);
          if(cursor!==old)value.memoryState={...value.memoryState,cursors:{...value.memoryState.cursors,[c.id]:cursor!},jobs:{...value.memoryState.jobs,[c.id]:{scene:'private',attempts:0,retryAt:0}}};
        }
        return value;
      });
      display(values); loaded.current = true; setStorageUncertainState(isStorageUncertain());
      if (result.corrupt) setStorageWarning(result.recoverableCount ? `发现 ${result.recoverableCount} 个尚未找回的历史会话，点击重新读取查看` : '历史记录未能完整读取，请勿清除应用数据；新消息将单独保存');
      else setStorageWarning(previous => previous?.startsWith('历史记录未能完整读取') || previous?.startsWith('原始记录已保留') || previous?.startsWith('发现 ') ? null : previous);
      const id = await loadActiveId();
      if (convsRef.current !== values || activeRef.current !== selectionBeforeRead) return;
      const chosen = values.find(c => c.id === id)?.id || values.find(c => c.type !== 'group')?.id || null;
      activeRef.current = chosen; setActiveId(chosen);
    })().finally(() => { loading.current = null; });
    return loading.current;
  }, [display]);
  const ensureLoaded = useCallback(async () => { if(recoveryExclusive.current)throw Error('数据恢复中，请稍候'); if (!loaded.current) await loadList(); }, [loadList]);
  /** Serialize state changes. Chat saves remain ordered on disk without holding up the next turn. */
  const commit = useCallback((update: (v: AgentSoulConversation[]) => AgentSoulConversation[], persistFirst = false, allowUnsavedChat = false, onPublished?:()=>void): Promise<void> => {
    if (allowUnsavedChat) pendingChatCommits.current++;
    let persisted: Promise<void> = Promise.resolve();
    const operation = mutations.current.then(async () => {
      await ensureLoaded();
      const base=convsRef.current; const next = update(base);
      if (next === base || next.length===base.length && next.every((c,i)=>c===base[i])) { onPublished?.(); return; }
      if(!persistFirst&&!allowUnsavedChat&&!validConversations(next))throw new Error('修改后的数据不完整，未应用修改；历史记录保持不变');
      if (!persistFirst) display(next);
      if (!persistFirst) onPublished?.();
      // Let the newly published bubble render before serializing a large library.
      // Keep enqueue order: later changes cannot overtake this yield.
      if (allowUnsavedChat) await new Promise<void>(resolve => setTimeout(resolve, 0));
      persisted = (async () => { try {
        const saved = saveConversations(next); await Promise.all([saved, flushConversationsNow()]);
        setStorageUncertainState(isStorageUncertain());
        if (persistFirst) display(next.map(c => ({ ...c, messages: c.messages===base.find(b=>b.id===c.id)?.messages ? convsRef.current.find(current => current.id === c.id)?.messages || c.messages : c.messages })));
      } catch (e) {
        if (persistFirst) void saveConversations(convsRef.current).catch(showError);
        else if (!allowUnsavedChat && convsRef.current===next) {
          // Failed settings/import mutations must not leave invalid data in the
          // live array and make every subsequent full-history save fail.
          display(base);void saveConversations(base).catch(showError);
        }
        showError(allowUnsavedChat ? new Error('消息暂未保存，可继续聊天；请保留当前页面并重试保存') : e);
        if (!allowUnsavedChat) throw e;
      } })();
      // Memory edits, deletion and branch changes still require a durable barrier.
      // A chat's caller also awaits durability, but the next chat can publish now.
      if (!allowUnsavedChat) await persisted;
    });
    mutations.current = operation.catch(() => {});
    return operation.then(() => persisted).finally(() => { if (allowUnsavedChat) pendingChatCommits.current--; });
  }, [display, ensureLoaded, showError]);
  const checkApiKey = useCallback(async () => { const has = !!(await getApiKey()); setHasApiKey(has); return has; }, []);
  useEffect(() => {
    mounted.current = true; setWriteFailureHandler(showError);
    loadList().catch(showError); checkApiKey().catch(showError);
    loadThinkingMode().then(setThinkingMode).catch(showError);
    const listener = AppState.addEventListener('change', state => { if (state !== 'active') void mutations.current.then(() => flushConversationsNow()).catch(showError); else { checkApiKey().then(()=>resumeMemory.current()).catch(showError); } });
    return () => { mounted.current = false; listener.remove(); setWriteFailureHandler(null); tasks.current.cancelAll(); summaryTasks.current.forEach(c => c.abort()); memoryTimers.current.forEach(t=>clearTimeout(t)); };
  }, [loadList, checkApiKey, showError]);
  const updateConversation = useCallback((id: string, patch: Partial<AgentSoulConversation>) => { if (patch.settings?.memoryRecall?.enabled === false) summaryTasks.current.get(id)?.abort(); return commit(v => v.map(c => c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c)).then(()=>{if(patch.settings?.memoryRecall?.enabled)void resumeMemory.current().catch(showError);}); }, [commit,showError]);
  const updateSettings = useCallback((id: string, patch: Partial<AgentSoulSettings>) => {
    if (patch.memoryRecall?.enabled === false) summaryTasks.current.get(id)?.abort();
    return commit(v => v.map(c => c.id === id ? { ...c, settings: { ...c.settings, ...patch }, memoryState: patch.memoryRecall?.enabled && c.settings.memoryRecall?.enabled===false && c.memoryState ? {...c.memoryState,jobs:Object.fromEntries(Object.entries(c.memoryState.jobs||{}).map(([scope,job])=>[scope,{...job,attempts:0,retryAt:0,lastError:undefined}]))}:c.memoryState, updatedAt: Date.now() } : c)).then(()=>{if(patch.memoryRecall?.enabled)void resumeMemory.current().catch(showError);});
  }, [commit,showError]);
  const createNew = useCallback(async () => { const c = createConversation(); c.memoryState = initialMemoryState([], c.id); await commit(v => [c, ...v], false, true); selectConversation(c.id); return c.id; }, [commit, selectConversation]);
  const addConversation = useCallback(async (c: AgentSoulConversation) => { await commit(v => v.some(x => x.id === c.id) ? v : [c, ...v]); if (c.type !== 'group') selectConversation(c.id); }, [commit, selectConversation]);
  const deleteConversation = useCallback(async (id: string) => {
    const deletingGroup=convsRef.current.find(c=>c.id===id)?.type==='group';
    tasks.current.cancel(id); groupRequestTasks.cancel(id);momentRequestTasks.cancelAll();for(const g of convsRef.current.filter(c=>c.memberIds?.includes(id)))groupRequestTasks.cancel(g.id); summaryTasks.current.get(id)?.abort();
    summaryTasks.current.forEach(ctl=>ctl.abort());
    await commit(v => v.filter(c => c.id !== id).map(c => {const memories=(c.memories||[]).map(m=>m.source?.conversationId===id ? {...m,inactive:true}:m);return {...c,memories,memberIds:c.memberIds?.filter(x=>x!==id),story:c.story ? {...c.story,branches:c.story.branches.map(b=>({...b,memories:b.memories.map(m=>m.source?.conversationId===id ? {...m,inactive:true}:m)}))}:undefined,memoryState:c.memoryState ? {...c.memoryState,editVersion:c.memoryState.editVersion+1,invalidSources:[...(c.memoryState.invalidSources||[]),{scope:id}],jobs:Object.fromEntries(Object.entries(c.memoryState.jobs||{}).filter(([scope])=>scope!==id))}:undefined};}),true);
    if (activeRef.current === id) selectConversation(convsRef.current.find(c => c.type !== 'group')?.id || '');
    setLegacyPersonas(prev => { const next = { ...prev }; delete next[id]; return next; });
    if(deletingGroup)await removeGroupMessages(id).catch(showError);
  }, [commit, selectConversation, showError]);
  const prepareMemoryScope = useCallback(async (id: string, messages: AgentSoulMessage[], scope: string) => {
    const c = convsRef.current.find(x => x.id === id); if (!c || c.memoryState?.cursors[scope]) return;
    const cursor = initialMemoryState(messages, scope).cursors[scope];
    await commit(v => v.map(x => x.id !== id ? x : { ...x, memoryState: { ...(x.memoryState || initialMemoryState([], x.id)), cursors: { ...x.memoryState?.cursors, [scope]: cursor } } }));
  }, [commit]);
  const drainMemory = useCallback(async (id:string) => {
    if(recovering.current||summaryTasks.current.has(id)||!mounted.current)return;
    const controller=new AbortController(); summaryTasks.current.set(id,controller);
    const visited=new Set<string>();
    try {
      while(mounted.current&&!controller.signal.aborted){
        const c=convsRef.current.find(x=>x.id===id);if(!c||c.settings.memoryRecall?.enabled===false)break;
        const next=Object.entries(c.memoryState?.jobs||{}).find(([scope,j])=>!visited.has(scope)&&j.retryAt<=Date.now()&&j.attempts<5);if(!next)break;
        const [scope,job]=next;const state=c.memoryState!;
        try {
          const history=job.scene==='private'?c.messages:job.scene==='group'?(await abortable(loadGroupMessages(scope),controller.signal)).filter(m=>m.role==='user'||m.senderId===id):momentDialogForCharacter(await abortable(loadMoments(),controller.signal),id);
          const invalid=state.invalidSources?.filter(s=>s.scope===scope)||[];const effectiveHistory=history.filter(m=>!invalid.some(s=>!s.messageIds||s.messageIds.includes(m.id)||s.messageIds.includes(m.inReplyTo||'')));
          const turns=unsummarizedTurns(effectiveHistory,state.cursors[scope]);const interval=Math.max(1,Math.min(50,c.settings.memoryRecall?.interval||10));
          if(turns.length<interval&&!turns.some(t=>state.cursors[scope]?.partial?.[t.user.id])){
            await commit(v=>v.map(x=>{if(x.id!==id||!x.memoryState)return x;const jobs={...x.memoryState.jobs};delete jobs[scope];return {...x,memoryState:{...x.memoryState,jobs}};}),true);visited.add(scope);continue;
          }
          const config=await abortable(getLLMConfig(),controller.signal);const batch=summaryBatch(turns,interval,Math.max(512,Math.min(20000,contextWindowBudget(config)-7000)),state.cursors[scope]);
          const result=await summarizeNewTurns(batch,activeMemories(c),controller.signal,config,state.blocked);
          if(controller.signal.aborted)break;
          await commit(v=>v.map(x=>{
            if(x.id!==id||!x.memoryState||x.memoryState.editVersion!==state.editVersion||x.settings.memoryRecall?.enabled===false||controller.signal.aborted)return x;
            const refs=batch.flatMap(t=>t.assistants.map(m=>({messageId:m.id,versionId:selectedVersion(m).id})));
            const source={characterId:id,conversationId:scope,scene:job.scene,messageIds:batch.flatMap(t=>[t.user.id,...t.assistants.flatMap(m=>[m.id,...(m.legacyParts||[]).map(p=>p.id)])]),replies:refs};
            const memories=applyMemoryOperations(x.memories||[],result.operations,x.memoryState,source,result.relatedIds);
            const savedCount=memories.filter(m=>!m.inactive&&!x.memories?.some(old=>old.id===m.id&&old.content===m.content&&!old.inactive)).length;
            const lastResult=savedCount?'saved' as const:result.operations.length?'unchanged' as const:'empty' as const;
            const lastResultNote=savedCount?undefined:result.operations.length?'无新增：已有重复、删除限制或手动保护':result.emptyReason||'模型未提取出长期信息';
            return {...x,memories,memoryState:{...x.memoryState,cursors:{...x.memoryState.cursors,[scope]:{...cursorFor(batch,state.cursors[scope]),lastSuccessAt:Date.now(),lastSavedCount:savedCount,summaryPromptVersion:MEMORY_SUMMARY_VERSION,lastResult,lastResultNote}},jobs:{...x.memoryState.jobs,[scope]:{...x.memoryState.jobs?.[scope],...job,attempts:0,retryAt:0,lastError:undefined}}}};
          }),true);
          if(convsRef.current.find(x=>x.id===id)?.memoryState?.editVersion!==state.editVersion)break;
        }catch(e){
          if(controller.signal.aborted)break;
          const attempts=job.attempts+1;
          await commit(v=>v.map(x=>x.id!==id||!x.memoryState?x:{...x,memoryState:{...x.memoryState,jobs:{...x.memoryState.jobs,[scope]:{...job,...x.memoryState.jobs?.[scope],attempts,retryAt:Date.now()+Math.min(300000,30000*2**(attempts-1)),lastError:(e instanceof Error?e.message:'总结失败，请重试').slice(0,160)}}}}),true).catch(()=>{setStorageWarning('记忆保存未成功，进度未推进；请检查存储空间后重试保存。');});
          visited.add(scope);
        }
      }
    } finally {
      if(summaryTasks.current.get(id)===controller)summaryTasks.current.delete(id);
      const c=convsRef.current.find(x=>x.id===id);const jobs=Object.values(c?.memoryState?.jobs||{}).filter(j=>j.attempts<5);
      if(mounted.current&&c?.settings.memoryRecall?.enabled!==false&&jobs.length){const old=memoryTimers.current.get(id);if(old)clearTimeout(old);memoryTimers.current.set(id,setTimeout(()=>{void resumeMemory.current().catch(showError);},Math.max(100,Math.min(...jobs.map(j=>j.retryAt))-Date.now())));}
    }
  },[commit]);
  const summarizeConversation = useCallback(async(id:string,_messages?:AgentSoulMessage[],scope=id,scene:'private'|'group'|'moments'='private')=>{
    const c=convsRef.current.find(x=>x.id===id);if(recovering.current||!c||c.settings.memoryRecall?.enabled===false)return;
    // Persist the job before acquiring the running lock: another scene cannot be dropped.
    try {
      const history=scene==='private'?c.messages:scene==='group'?(await loadGroupMessages(scope)).filter(m=>m.role==='user'||m.senderId===id):momentDialogForCharacter(await loadMoments(),id);
      const pending=unsummarizedTurns(history,c.memoryState?.cursors[scope]);
      const interval=Math.max(1,Math.min(50,c.settings.memoryRecall?.interval||10));
      // Progress is reconstructed from persisted messages on restart. A scope
      // below its interval needs no enqueue-then-delete pair of full snapshots.
      if(!c.memoryState?.jobs?.[scope]&&pending.length<interval&&!pending.some(t=>c.memoryState?.cursors[scope]?.partial?.[t.user.id]))return;
      const latest = completeTurns(history).at(-1);
      const trigger = latest ? latest.user.id+':'+turnFingerprint(latest) : '';
      await commit(v=>v.map(x=>{
        if(x.id!==id)return x;
        const state=x.memoryState||initialMemoryState([],id),old=state.jobs?.[scope];
        const rearm=!!old&&old.attempts>=5&&!!trigger&&old.lastTrigger!==trigger;
        if(old&&!rearm&&old.scene===scene&&old.lastTrigger===trigger)return x;
        return {...x,memoryState:{...state,jobs:{...state.jobs,[scope]:{scene,attempts:rearm?0:old?.attempts||0,retryAt:rearm?0:old?.retryAt||0,lastTrigger:trigger,lastError:rearm?undefined:old?.lastError}}}};
      }),true);
      await drainMemory(id);
    } catch(e) { showError(e); }
  },[commit,drainMemory]);
  resumeMemory.current=async()=>{if(recovering.current||!loaded.current)return;if(!await getApiKey())return;for(const c of convsRef.current.filter(x=>x.type!=='group'&&x.settings.memoryRecall?.enabled!==false)){
    // A failed group/feed job must not hide a private scope which lost its queued trigger.
    const scopes=new Set([c.id,...Object.keys(c.memoryState?.cursors||{}),...Object.keys(c.memoryState?.jobs||{})]);
    for(const scope of scopes)void summarizeConversation(c.id,undefined,scope,scope===c.id?'private':scope.startsWith('moments:')?'moments':'group').catch(showError);
  }};
  useEffect(()=>{if(hasApiKey)void resumeMemory.current().catch(showError);},[hasApiKey,conversations.length,showError]);
  const retryMemoryTasks=useCallback(async(id?:string)=>{
    await commit(v=>v.map(c=>!c.memoryState||id&&c.id!==id?c:{...c,memoryState:{...c.memoryState,jobs:Object.fromEntries(Object.entries(c.memoryState.jobs||{}).map(([scope,j])=>[scope,{...j,attempts:0,retryAt:0,lastError:undefined}]))}}),true);
    await resumeMemory.current();
  },[commit]);
  const recallMemoryNow=useCallback(async(id:string):Promise<ImmediateMemoryResult>=>{
    await ensureLoaded();
    if(recovering.current)throw Error('数据操作进行中，请稍后重试');
    if(summaryTasks.current.has(id))throw Error('该角色已有记忆总结进行中，请稍后查看');
    const c=convsRef.current.find(x=>x.id===id);
    if(!c||c.type==='group')throw Error('请先选择已保存的角色');
    const state=c.memoryState||initialMemoryState([],id);
    const invalid=state.invalidSources?.filter(s=>s.scope===id)||[];
    const effective=c.messages.filter(m=>!invalid.some(s=>!s.messageIds||s.messageIds.includes(m.id)||s.messageIds.includes(m.inReplyTo||'')));
    const turns=unsummarizedTurns(effective,state.cursors[id]);
    if(!turns.length)return {savedCount:0,remainingTurns:0,note:'没有新增的完整对话可总结'};
    const controller=new AbortController();summaryTasks.current.set(id,controller);
    try{
      const config=await abortable(getLLMConfig(),controller.signal);
      // Exactly one model call; process only the batch that fits the current model budget.
      const batch=summaryBatch(turns,turns.length,Math.max(512,Math.min(20000,contextWindowBudget(config)-7000)),state.cursors[id]);
      const result=await summarizeNewTurns(batch,activeMemories(c),controller.signal,config,state.blocked);
      if(controller.signal.aborted)throw Error('本次总结已取消，未推进记忆进度');
      let outcome:ImmediateMemoryResult|undefined;
      await commit(v=>v.map(x=>{
        if(x.id!==id)return x;
        if(controller.signal.aborted||(x.memoryState?.editVersion||0)!==state.editVersion)throw Error('对话或记忆已变化，请重新总结');
        const current=x.memoryState||state;
        const source={characterId:id,conversationId:id,scene:'private' as const,messageIds:batch.flatMap(t=>[t.user.id,...t.assistants.flatMap(m=>[m.id,...(m.legacyParts||[]).map(p=>p.id)])]),replies:batch.flatMap(t=>t.assistants.map(m=>({messageId:m.id,versionId:selectedVersion(m).id})))};
        const memories=applyMemoryOperations(x.memories||[],result.operations,current,source,result.relatedIds);
        const savedCount=memories.filter(m=>!m.inactive&&!x.memories?.some(old=>old.id===m.id&&old.content===m.content&&!old.inactive)).length;
        const lastResult=savedCount?'saved' as const:result.operations.length?'unchanged' as const:'empty' as const;
        const note=savedCount?undefined:result.operations.length?'无新增：已有重复、删除限制或手动保护':result.emptyReason||'本次没有提取出新的长期信息';
        const cursor={...cursorFor(batch,current.cursors[id]),lastSuccessAt:Date.now(),lastSavedCount:savedCount,summaryPromptVersion:MEMORY_SUMMARY_VERSION,lastResult,lastResultNote:note};
        outcome={savedCount,remainingTurns:unsummarizedTurns(x.messages,cursor).length,note};
        const jobs={...current.jobs};
        if(jobs[id]){if(!outcome.remainingTurns)delete jobs[id];else jobs[id]={...jobs[id],attempts:0,retryAt:0,lastError:undefined};}
        return {...x,memories,memoryState:{...current,cursors:{...current.cursors,[id]:cursor},jobs}};
      }),true);
      if(!outcome)throw Error('角色已不存在，本次结果未保存');
      return outcome;
    }finally{
      if(summaryTasks.current.get(id)===controller)summaryTasks.current.delete(id);
      const latest=convsRef.current.find(x=>x.id===id);
      if(mounted.current&&latest?.settings.memoryRecall?.enabled!==false&&Object.keys(latest?.memoryState?.jobs||{}).length)void drainMemory(id).catch(showError);
    }
  },[ensureLoaded,commit,drainMemory,showError]);
  const editMemory = useCallback(async (id: string, memoryId: string, content: string) => {
    if (!content.trim()) throw new Error('记忆内容不能为空'); summaryTasks.current.get(id)?.abort();
    await commit(v => v.map(c => {
      if (c.id !== id) return c; const state = c.memoryState || initialMemoryState(c.messages, id); const old = c.memories?.find(m => m.id === memoryId);
      if(old?.core&&(memoryCharCount(content.trim())>MEMORY_ITEM_MAX_CHARS||(c.memories||[]).filter(m=>m.core&&m.id!==memoryId&&!m.inactive).reduce((n,m)=>n+memoryCharCount(m.content),memoryCharCount(content.trim()))>CORE_MEMORY_MAX_CHARS))throw Error(`核心关系记忆每条最多${MEMORY_ITEM_MAX_CHARS}字、共${CORE_MEMORY_MAX_CHARS}字，请先精简或移出核心`);
      return { ...c, memories: c.memories?.map(m => m.id === memoryId ? { ...m, content: content.trim(), factKey:factIdentity(m.factKey,content), manualLocked: true,userConfirmed:true, updatedAt: Date.now(),history:[...(m.history||[]),{content:m.content,source:m.source,at:Date.now(),reason:'用户编辑'}] } : m), memoryState: { ...state, editVersion: state.editVersion + 1, edits:old?[...(state.edits||[]),{memory:old,at:Date.now(),action:'edit' as const}]:state.edits, blocked: old ? [...state.blocked, { content: old.content,reason:"edit" as const,messageIds:old.source?.messageIds }] : state.blocked } };
    }), true);
  }, [commit]);
  const deleteMemory = useCallback(async (id: string, memoryId: string) => {
    summaryTasks.current.get(id)?.abort();
    await commit(v => v.map(c => { if (c.id !== id) return c; const state = c.memoryState || initialMemoryState(c.messages, id), old = c.memories?.find(m => m.id === memoryId); return { ...c, memories: c.memories?.filter(m => m.id !== memoryId), memoryState: { ...state, editVersion: state.editVersion + 1, edits:old?[...(state.edits||[]),{memory:old,at:Date.now(),action:'delete' as const}]:state.edits, blocked: old ? [...state.blocked, { content: old.content, factKey: old.factKey,messageIds:old.source?.messageIds }] : state.blocked } }; }), true);
  }, [commit]);
  const runReply = useCallback(async (convId: string, user: AgentSoulMessage, history: AgentSoulMessage[], target?: AgentSoulMessage) => {
    if (target) summaryTasks.current.get(convId)?.abort();
    const controller = tasks.current.begin(convId); renderRequests(n => n + 1);
    let reply = '', aside = '', reasoning = ''; const startedAt = Date.now();
    // Existing reasoning kind keeps snapshots readable by the previous 1.6.6 build.
    const thought = (): AgentSoulMessage['thinking'] => reasoning || aside ? { kind: reasoning ? 'legacy_reasoning' : 'character', content: reasoning || aside, duration: Math.max(0,Math.round((Date.now()-startedAt)/1000)), collapsed: thinkingRef.current !== 'auto' } : undefined;
    const splitMessages=!!convsRef.current.find(c=>c.id===convId)?.settings.splitMessages;
    const ai = target || { ...createMessage('assistant', ''), inReplyTo: user.id, isStreaming: true, splitMessages };
    let captured: AgentSoulConversation | undefined;
    try {
      await abortable(ensureLoaded(),controller.signal); captured = convsRef.current.find(c => c.id === convId);
      if (!captured) throw new Error('对话不存在');
      if (!await abortable(checkApiKey(),controller.signal)) throw new Error('请先在 AI 服务设置中配置 API Key');
      const parsed = parseUserMessage(user.rawText || user.content);
      if (!target) {
        // Publish the user turn before starting the model, while its serialized
        // disk save continues. Final saves remain behind it in the same queue.
        const ready = new Promise<void>((resolve,reject)=>{
          void commit(v => {
            if(controller.signal.aborted)throw new Error('生成已停止');
            return v.map(c => c.id === convId ? { ...c, messages: [...c.messages, user, ai], updatedAt: Date.now() } : c);
          },false,true,resolve).catch(reject);
        });
        await abortable(ready,controller.signal);
      }
      const svc = new SoulService(); let lastFlush = 0;
      for await (const chunk of svc.respond({ character: convsRef.current.find(c=>c.id===convId) || captured, history, query: parsed.cleanText || '请自然延续当前虚构情境。', injections: parsed.injections, conversations: convsRef.current, asideMode: thinkingRef.current, signal: controller.signal })) {
        if (!tasks.current.active(convId, controller)) break;
        reply = chunk.reply; aside = chunk.aside; reasoning = chunk.reasoning;
        if (!target && Date.now() - lastFlush >= 100) {
          lastFlush = Date.now(); display(convsRef.current.map(c => c.id === convId ? { ...c, messages: c.messages.map(m => m.id === ai.id ? { ...m, content: reply, thinking: thought() } : m) } : c));
        }
      }
      if (!tasks.current.active(convId, controller)) throw new Error('生成已停止');
      const error = ['length','max_tokens'].includes(svc.lastFinishReason) ? '回复达到模型长度限制，可重新生成' : undefined;
      if (target && error) throw new Error(error);
      const thinking = thought();
      // A complete reply commits once. Visual cadence never controls whether text is saved.
      const finish=(v:AgentSoulConversation[])=>v.map(c=>{
        if(c.id!==convId)return c;
        if(target){if((c.story?.revision||0)!==(captured!.story?.revision||0))throw Error('剧情已改变，未采用旧生成结果');return changeReply(c,ai.id,{content:reply,thinking,origin:'model',splitMessages});}
        return {...c,messages:c.messages.map(m=>m.id!==ai.id?m:{...m,content:reply,thinking,isStreaming:false,error}),updatedAt:Date.now()};
      });
      if(!target){display(finish(convsRef.current));tasks.current.end(convId,controller);if(mounted.current)renderRequests(n=>n+1);}
      await commit(finish,!!target,!target);
      if (!error) void summarizeConversation(convId).catch(showError);
    } catch (e) {
      const message = controller.signal.aborted ? '生成已停止或超时，请重试' : e instanceof Error ? e.message : '生成失败，请重试';
      if (!target && convsRef.current.some(c => c.id === convId && c.messages.some(m => m.id === ai.id))) {
        const finish=(v:AgentSoulConversation[])=>v.map(c => c.id !== convId ? c : { ...c, messages: c.messages.map(m => m.id === ai.id ? { ...m, content: reply, isStreaming: false, error: message, thinking: thought() } : m) });
        display(finish(convsRef.current));tasks.current.end(convId,controller);if(mounted.current)renderRequests(n=>n+1);
        await commit(finish, false, true).catch(showError);
      } else { showError(new Error(message)); if (!target) throw new Error(message); }
    } finally { tasks.current.end(convId, controller); if (mounted.current) renderRequests(n => n + 1); }
  }, [ensureLoaded, checkApiKey, commit, display, summarizeConversation, showError]);
  const sendMessage = useCallback(async (text: string, files?: Array<{ uri: string; name: string }>, conversationId?:string) => {
    if (files?.length) throw new Error('聊天文件解析暂未支持，请将文本粘贴到输入框；人设可使用 Word 导入');
    if(recovering.current)throw Error('数据处理中，请稍候');
    const parsed = parseUserMessage(text); if (!parsed.cleanText && !parsed.injections.length) throw new Error('消息内容为空');
    await ensureLoaded();
    let id = conversationId || activeRef.current;
    if (!id) {
      if (!creating.current) creating.current = createNew().finally(() => { creating.current = null; });
      id = await creating.current;
    }
    const c = convsRef.current.find(x => x.id === id);
    if (!c || c.type === 'group') throw new Error('请选择私聊角色');
    if (tasks.current.busy(id)) throw new Error('这段对话仍在生成中，请先停止或稍候');
    const user = { ...createMessage('user', parsed.cleanText || '（更新虚构情境）'), rawText: text, timestamp: Math.max(Date.now(), (c.messages.at(-1)?.timestamp || 0) + 1) };
    await runReply(id, user, [...c.messages]);
  }, [ensureLoaded, createNew, runReply]);
  const retryMessage = useCallback(async (messageId: string,confirmed=false) => {
    const c = convsRef.current.find(x => x.id === activeRef.current); if (!c) return;
    const index = c.messages.findIndex(m => m.id === messageId); if (index < 0 || c.messages[index].role !== 'assistant') return;
    if(hasFollowing(c,messageId)&&!confirmed)throw Error('修改历史回复会改变后续剧情，请先确认');
    let userIndex = index - 1; while (userIndex >= 0 && (c.messages[userIndex].role !== 'user' || c.messages[userIndex].meta === 'system')) userIndex--;
    if (userIndex < 0) { showError(new Error('该消息没有可重新生成的用户输入')); return; }
    try { await runReply(c.id, c.messages[userIndex], c.messages.slice(0, userIndex), c.messages[index]); } catch (e) { showError(e); }
  }, [runReply, showError]);
  const deleteMessages = useCallback((selected:Set<string>)=>{
    const id=activeRef.current;if(!id)return;tasks.current.cancel(id);summaryTasks.current.get(id)?.abort();
    void commit(v=>v.map(c=>{
      if(c.id!==id)return c;const ids=new Set(selected);
      for(const m of [...c.messages,...(c.story?.branches||[]).flatMap(b=>b.messages)])if(ids.has(m.inReplyTo||''))ids.add(m.id);
      const removed=(c.memories||[]).filter(m=>m.source?.messageIds.some(mid=>ids.has(mid)));
      const state=c.memoryState||initialMemoryState(c.messages,id);
      const invalidate=(memories:MemoryNode[])=>memories.map(m=>m.source?.messageIds.some(mid=>ids.has(mid))?{...m,inactive:true}:m);
      return {...c,messages:c.messages.filter(m=>!ids.has(m.id)),memories:invalidate(c.memories||[]),story:{activeId:c.story?.activeId||'original:'+id,revision:(c.story?.revision||0)+1,deletedIds:[...new Set([...(c.story?.deletedIds||[]),...ids])],branches:(c.story?.branches||[]).map(b=>({...b,memories:invalidate(b.memories)}))},memoryState:{...state,editVersion:state.editVersion+1,invalidSources:[...(state.invalidSources||[]),{scope:id,messageIds:[...ids]}],blocked:[...state.blocked,...removed.map(m=>({content:m.content,factKey:m.factKey,messageIds:m.source?.messageIds}))]}};
    }),true).catch(showError);
  },[commit,showError]);
  const applyStory=useCallback(async(operation:(c:AgentSoulConversation)=>AgentSoulConversation,confirmed:boolean,anchor?:string)=>{
    const id=activeRef.current,c=convsRef.current.find(x=>x.id===id);if(!c)return;
    if(tasks.current.busy(c.id))throw Error('请先停止生成，再修改剧情');
    if((anchor?hasFollowing(c,anchor):true)&&!confirmed)throw Error('此操作会切换后续剧情，请先确认');
    summaryTasks.current.get(c.id)?.abort();
    await commit(v=>v.map(x=>x.id===id?operation(x):x),true);
    void summarizeConversation(c.id).catch(showError);
  },[commit,summarizeConversation,showError]);
  const switchMessageVersion=useCallback(async(id:string,dir:1|-1,confirmed=false)=>{
    await applyStory(c=>{const m=c.messages.find(m=>m.id===id);if(!m)return c;const all=versionsOf(m),index=all.findIndex(v=>v.id===selectedVersion(m).id),next=all[Math.max(0,Math.min(all.length-1,index+dir))];return changeReply(c,id,{versionId:next.id});},confirmed,id);
  },[applyStory]);
  const editReply=useCallback(async(id:string,content:string,confirmed=false)=>{await applyStory(c=>changeReply(c,id,{content,origin:'edit'}),confirmed,id);},[applyStory]);
  const restoreBranch=useCallback(async(id:string,confirmed=false)=>{await applyStory(c=>restoreStoryBranch(c,id),confirmed);},[applyStory]);
  const unlockMemory=useCallback(async(id:string,memoryId:string)=>{summaryTasks.current.get(id)?.abort();await commit(v=>v.map(c=>c.id!==id?c:{...c,memories:c.memories?.map(m=>m.id===memoryId?{...m,manualLocked:false}:m),memoryState:c.memoryState?{...c.memoryState,editVersion:c.memoryState.editVersion+1,edits:[...(c.memoryState.edits||[]),...(c.memories||[]).filter(m=>m.id===memoryId).map(memory=>({memory,at:Date.now(),action:'unlock' as const}))]}:undefined}),true);},[commit]);
  const setCoreMemory=useCallback(async(id:string,memoryId:string,core:boolean)=>{await commit(v=>v.map(c=>{
    if(c.id!==id)return c;const selected=(c.memories||[]).find(m=>m.id===memoryId);if(!selected)return c;
    const existing=activeMemories(c).filter(m=>m.core&&m.id!==memoryId);
    if(core&&(existing.length>=CORE_MEMORY_MAX_ITEMS||memoryCharCount(selected.content)>MEMORY_ITEM_MAX_CHARS||existing.reduce((n,m)=>n+memoryCharCount(m.content),memoryCharCount(selected.content))>CORE_MEMORY_MAX_CHARS))throw Error(`核心关系记忆最多${CORE_MEMORY_MAX_ITEMS}条、共${CORE_MEMORY_MAX_CHARS}字，每条不超过${MEMORY_ITEM_MAX_CHARS}字，请先整理`);
    return {...c,memories:c.memories?.map(m=>m.id===memoryId?{...m,core,corePreference:core?'always' as const:'topic' as const}:m)};
  }),true);},[commit]);
  const restoreMemory=useCallback(async(id:string,index:number)=>{summaryTasks.current.get(id)?.abort();await commit(v=>v.map(c=>{
    if(c.id!==id||!c.memoryState)return c;const old=c.memoryState.edits?.[index]?.memory;if(!old)throw Error('记忆历史不存在');
    return {...c,memories:[...(c.memories||[]).filter(m=>m.id!==old.id),{...old,inactive:false,manualLocked:true,userConfirmed:true,updatedAt:Date.now()}],memoryState:{...c.memoryState,editVersion:c.memoryState.editVersion+1,blocked:c.memoryState.blocked.filter(b=>!blockedMemory(old,[b]))}};
  }),true);},[commit]);
  const deleteMomentAndMemories=useCallback(async(momentId:string)=>{
    const moments=await loadMoments(),post=moments.find(m=>m.id===momentId);if(!post)return;
    const ids=new Set([post.id,...post.comments.map(c=>c.id)]);momentRequestTasks.cancel(momentId);summaryTasks.current.forEach(c=>c.abort());
    const invalidate=(memories:MemoryNode[])=>memories.map(m=>m.source?.scene==='moments'&&m.source.messageIds.some(id=>ids.has(id))?{...m,inactive:true}:m);
    await commit(v=>v.map(c=>({...c,memories:invalidate(c.memories||[]),story:c.story?{...c.story,branches:c.story.branches.map(b=>({...b,memories:invalidate(b.memories)}))}:undefined,memoryState:c.memoryState?{...c.memoryState,editVersion:c.memoryState.editVersion+1,invalidSources:[...(c.memoryState.invalidSources||[]),{scope:'moments:'+c.id,messageIds:[...ids]}]}:undefined})),true);
    await removeMoment(momentId);
  },[commit]);
  const addSystemMessageTo = useCallback((id: string, content: string, messageId?: string): Promise<void> => {
    const operation = commit(v => {
      if (!v.some(c => c.id === id)) throw new Error('目标角色已删除或不存在，记录未保存');
      return v.map(c => c.id !== id || (messageId && c.messages.some(m => m.id === messageId)) ? c : {
        ...c, messages: [...c.messages, { ...createMessage('user', content), ...(messageId ? { id: messageId } : {}), meta: 'system' }], updatedAt: Date.now(),
      });
    });
    // Existing fire-and-forget callers still receive storage feedback; transactional callers can await failure.
    void operation.catch(showError); return operation;
  }, [commit, showError]);
  const addMemoryToConversation = useCallback((id: string, content: string, tags: string[] = []) => {
    // Compatibility for game/system events, not per-message keyword/emotion extraction.
    void commit(v => v.map(c => {
      if (c.id !== id || (c.memories || []).some(m => normalizeMemory(m.content) === normalizeMemory(content)) || c.memoryState?.blocked.some(b => normalizeMemory(b.content) === normalizeMemory(content))) return c;
      const memory: MemoryNode = { id: generateId(), content, tags, kind: 'event', weight: 80, isFlashbulb: false, timestamp: Date.now(), source: { characterId: id, conversationId: id, scene: tags.includes('社交') ? 'moments' : 'private', messageIds: [] } };
      return { ...c, memories: [...(c.memories || []), memory] };
    })).catch(showError);
  }, [commit, showError]);
  const runDataRecovery=useCallback(async(action:()=>Promise<void>)=>{
    if(recovering.current)throw Error('已有数据操作进行中');
    recovering.current=true;setStorageUncertainState(true);
    tasks.current.cancelAll();groupRequestTasks.cancelAll();momentRequestTasks.cancelAll();summaryTasks.current.forEach(c=>c.abort());memoryTimers.current.forEach(t=>clearTimeout(t));
    try{
      await Promise.all([tasks.current.waitForIdle(),groupRequestTasks.waitForIdle(),momentRequestTasks.waitForIdle()]);
      const deadline=Date.now()+5000;while(summaryTasks.current.size){if(Date.now()>deadline)throw Error('记忆任务尚未结束，未开始恢复');await new Promise<void>(resolve=>setTimeout(resolve,20));}
      recoveryExclusive.current=true;await mutations.current;if(!await AsyncStorage.getItem('@soulmate_recovery_transaction')&&!await flushConversationsNow())throw Error('仍有未保存数据，请先重试保存，尚未开始数据操作');
      await action();
    }finally{recoveryExclusive.current=false;recovering.current=false;await loadList();}
  },[loadList]);
  const personas: Record<string, AgentSoulPersona> = {};
  for (const c of conversations.filter(c => c.type !== 'group')) personas[c.id] = { ...legacyPersonas[c.id], id: c.id, name: c.name, avatar: c.avatar, memories: c.memories || [], relations: legacyPersonas[c.id]?.relations || {}, createdAt: c.createdAt, updatedAt: c.updatedAt };
  return <AgentSoulContext.Provider value={{
    inspectHistoryRecovery:()=>inspectOriginalHistory(convsRef.current),
    recoverHistoryCopies:async token=>{
      let count=0;
      await runDataRecovery(async()=>{
        const plan=await prepareOriginalHistoryCopies(convsRef.current,token);
        if(!plan.copies.length)return;
        // Read every group first. A failed original read must never become an empty recovered group.
        const groups=await Promise.all(plan.groups.map(async g=>({...g,messages:(await loadGroupMessages(g.from)).map(g.mapMessage)})));
        for(const g of groups)await saveGroupMessages(g.to,g.messages);
        if(!await writeConversationsImmediate(plan.conversations))throw Error('找回记录尚未保存，原记录未修改');
        display(plan.conversations);count=plan.copies.length;
        selectConversation(plan.copies.find(c=>c.type!=='group')?.id||activeRef.current||'');
      });
      return count;
    },
    conversations, activeConversation: conversations.find(c => c.id === activeId) || null, personas,
    ensurePersona: c => personas[c.id] || { id: c.id, name: c.name, avatar: c.avatar, memories: c.memories || [], relations: {}, createdAt: c.createdAt, updatedAt: c.updatedAt },
    updatePersona: (id, patch) => { if (patch.name || patch.avatar) void updateConversation(id, { name: patch.name || convsRef.current.find(c => c.id === id)?.name || '角色', avatar: patch.avatar }).catch(showError); },
    isStreaming: !!activeId && tasks.current.busy(activeId), hasApiKey, selectionMode, selectedIds, setSelectionMode,
    toggleSelectedId: id => setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }),
    deleteSelectedConversations: async () => { for (const id of selectedIds) await deleteConversation(id); setSelectedIds(new Set()); setSelectionMode(false); },
    runDataRecovery,loadList, createNew, addConversation, selectConversation, deleteConversation, updateConversation, updateSettings,
    togglePin: id => commit(v => v.map(c => c.id === id ? { ...c, isPinned: !c.isPinned } : c)),
    sendMessage, retryMessage, stopMessage: () => { if (activeRef.current) tasks.current.cancel(activeRef.current); }, switchMessageVersion,
    deleteMessage: id => deleteMessages(new Set([id])), deleteMessages,
    addSystemMessage: content => { if (activeRef.current) addSystemMessageTo(activeRef.current, content); }, addSystemMessageTo,
    addMemoryToConversation, editMemory, deleteMemory, unlockMemory,setCoreMemory,restoreMemory,deleteMomentAndMemories,retryMemoryTasks,recallMemoryNow,editReply,restoreBranch,prepareMemoryScope, summarizeConversation, checkApiKey, thinkingMode,
    toggleThinkingMode: async () => { const next = thinkingMode === 'auto' ? 'manual' : thinkingMode === 'manual' ? 'off' : 'auto'; await saveThinkingMode(next); setThinkingMode(next); },
    storageWarning, dismissStorageWarning: () => setStorageWarning(null), storageUncertain: storageUncertainState,
    retryPendingSave: async () => { await mutations.current; const ok = await flushConversationsNow(); setStorageUncertainState(isStorageUncertain());if (ok&&!isStorageUncertain()) setStorageWarning(null); return ok; },
    restoreCorruptData: async () => { const ok = await restoreCorruptBackup(); if (ok) { await loadList(); setStorageWarning(null); } setStorageUncertainState(isStorageUncertain()); return ok; },
    discardCorruptData: async () => { await confirmDiscardCorruptData(); await loadList(); setStorageWarning(null); setStorageUncertainState(false); },
  }}>{children}</AgentSoulContext.Provider>;
}
export function useAgentSoul() { const value = useContext(AgentSoulContext); if (!value) throw new Error('需要 AgentSoulProvider'); return value; }
export default AgentSoulContext;
