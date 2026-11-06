import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, Switch, ScrollView } from 'react-native';
import { AppAlert } from '../services/appDialog';
import { useAgentSoul } from '../contexts/AgentSoulContext';
import { useTheme } from '../contexts/ThemeContext';
import ThemedSheet from './ThemedSheet';
import { activeMemories } from '../services/storyEngine';
import { unsummarizedTurns } from '../services/memorySummary';
import { SUMMARY_MAX_ITEMS, SUMMARY_MAX_CHARS, MEMORY_ITEM_MAX_CHARS, CORE_MEMORY_MAX_ITEMS, CORE_MEMORY_MAX_CHARS } from '../services/memoryPolicy';
import type { MemoryRecallSettings as RecallSettings } from '../types/memory';

export default function MemoryRecallSettings({ conversationId, value, onChange }: { conversationId?: string; value: RecallSettings; onChange: (v: RecallSettings) => void }) {
  const { conversations, editMemory, deleteMemory,unlockMemory,setCoreMemory,restoreMemory,updateSettings,retryMemoryTasks,recallMemoryNow } = useAgentSoul(); const { colors } = useTheme();
  const character=conversations.find(c=>c.id===conversationId);
  const memories=character?activeMemories(character):[];
  const [historyOpen,setHistoryOpen]=useState(false);
  const [managerOpen,setManagerOpen]=useState(false);
  const [intervalDraft,setIntervalDraft]=useState(String(value.interval));
  const preferencesQueue=useRef<Promise<unknown>>(Promise.resolve());
  const immediateRequest=useRef<object|null>(null);
  const [recalling,setRecalling]=useState(false);
  useEffect(()=>{setIntervalDraft(String(value.interval));},[value.interval,conversationId]);
  useEffect(()=>{setManagerOpen(false);setEditing(null);setHistoryOpen(false);},[conversationId]);
  useEffect(()=>{immediateRequest.current=null;setRecalling(false);return()=>{immediateRequest.current=null;};},[conversationId]);
  const recallNow=async()=>{
    if(!conversationId||immediateRequest.current)return;
    const token={};immediateRequest.current=token;setRecalling(true);
    try{
      await preferencesQueue.current;
      if(immediateRequest.current!==token)return;
      const result=await recallMemoryNow(conversationId);
      if(immediateRequest.current!==token)return;
      const progress=result.remainingTurns?`；还有 ${result.remainingTurns} 轮待总结`:'';
      AppAlert.alert('立即召回',result.savedCount?`已新增或更新 ${result.savedCount} 条记忆${progress}`:(result.note||'本次没有新增记忆')+progress);
    }catch(e){if(immediateRequest.current===token)AppAlert.alert('总结未完成',e instanceof Error?e.message:'请稍后重试');}
    finally{if(immediateRequest.current===token){immediateRequest.current=null;setRecalling(false);}}
  };
  const savePreferences=(next:RecallSettings)=>{
    onChange(next);
    if(!conversationId)return;
    const id=conversationId;
    const operation=preferencesQueue.current.then(()=>updateSettings(id,{memoryRecall:next}));
    preferencesQueue.current=operation.catch(e=>AppAlert.alert('记忆设置未保存',e instanceof Error?e.message:'请重试'));
  };
  const saveInterval=()=>{
    const interval=Number(intervalDraft);
    if(!Number.isInteger(interval)||interval<1||interval>50){setIntervalDraft(String(value.interval));AppAlert.alert('间隔范围为1–50轮');return;}
    if(interval!==character?.settings.memoryRecall?.interval)savePreferences({...value,interval});
  };
  const cursor=character?.memoryState?.cursors[character.id];
  const pending=character?unsummarizedTurns(character.messages,cursor).length:0;
  const jobs=Object.values(character?.memoryState?.jobs||{});
  const failed=jobs.find(job=>job.attempts>0);
  const summarizing=!!character&&pending>=value.interval&&character.memoryState?.jobs?.[character.id]?.attempts===0;

  const perform=async(action:()=>Promise<void>)=>{if(busy)return;setBusy(true);try{await action();}catch(e){report(e);}finally{setBusy(false);}};
  const [editing, setEditing] = useState<string | null>(null), [draft, setDraft] = useState(''), [busy, setBusy] = useState(false);
  const report = (e: unknown) => AppAlert.alert('记忆未保存', e instanceof Error ? e.message : '请重试');
  return <View style={{ marginVertical: 18, gap: 10 }}>
    <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>记忆召回</Text>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text style={{ color: colors.text }}>自动总结长期记忆</Text>
      <Switch value={value.enabled} onValueChange={enabled => savePreferences({ ...value, enabled })} />
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Text style={{ color: colors.textSecondary }}>每隔完整对话轮数</Text>
      <TextInput accessibilityLabel="记忆总结间隔" keyboardType="number-pad" value={intervalDraft} onChangeText={text => { const digits=text.replace(/\D/g,'');setIntervalDraft(digits);const interval=Number(digits);if(digits&&interval>=1&&interval<=50)onChange({...value,interval}); }} onBlur={saveInterval} onSubmitEditing={saveInterval} style={{ color: colors.text, borderWidth: 1, borderColor: colors.separator, borderRadius: 8, padding: 8, minWidth: 50 }} />
      <TouchableOpacity accessibilityLabel="立即召回记忆" disabled={!character||recalling||busy} onPress={recallNow} style={{marginLeft:'auto',paddingVertical:10,paddingLeft:8,opacity:!character||recalling||busy?0.5:1}}>
        <Text numberOfLines={1} style={{color:colors.primary,fontSize:13,fontWeight:'600'}}>{recalling?'总结中…':'立即召回'}</Text>
      </TouchableOpacity>
    </View>
    <Text style={{color:colors.textTertiary,fontSize:12}}>{!value.enabled?'自动总结已关闭；已有记忆仍可召回':failed?'有总结未完成，点击查看详情':summarizing?`正在自动总结 · ${pending} 轮待处理`:`私聊已积累 ${pending}/${value.interval} 轮${cursor?.lastResult==='empty'?'；上次未提取新记忆':'；满额后自动总结'}`}</Text>
    <TouchableOpacity accessibilityLabel="查看已保存记忆" onPress={()=>setManagerOpen(true)} style={{paddingVertical:12,flexDirection:'row',justifyContent:'space-between'}}>
      <Text style={{color:colors.primary}}>已保存 {memories.length} 条记忆</Text><Text style={{color:colors.primary}}>查看 / 管理 ›</Text>
    </TouchableOpacity>
    {managerOpen&&<ThemedSheet visible={managerOpen} title="已保存记忆" busy={busy} large onClose={()=>setManagerOpen(false)}>
        <ScrollView contentContainerStyle={{gap:12,paddingBottom:24}} keyboardShouldPersistTaps="handled">
        <Text style={{color:colors.textSecondary,fontSize:12}}>开关立即保存，间隔离开输入框后保存。仅统计新增完整对话；普通闲聊可能不生成记忆。编辑和删除立即保存。</Text>
        <Text style={{color:colors.textSecondary,fontSize:12}}>每批最多{SUMMARY_MAX_ITEMS}条记忆，单条最多{MEMORY_ITEM_MAX_CHARS}字、共{SUMMARY_MAX_CHARS}字。核心关系优先召回，最多{CORE_MEMORY_MAX_ITEMS}条、共{CORE_MEMORY_MAX_CHARS}字；普通记忆按话题召回，其他剧情分支不混入。</Text>
        {!!cursor?.lastSuccessAt&&<Text style={{color:colors.textSecondary,fontSize:12}}>上次总结：{new Date(cursor.lastSuccessAt).toLocaleString()}，新增或更新 {cursor.lastSavedCount||0} 条</Text>}
        {!!cursor?.lastResultNote&&<Text style={{color:colors.textSecondary,fontSize:12}}>{cursor.lastResultNote}</Text>}
        {failed&&<View style={{gap:8}}><Text style={{color:colors.error}}>总结未完成：{failed.lastError||'网络或模型响应异常'}；已完成进度保留。</Text><TouchableOpacity disabled={busy} onPress={()=>{if(conversationId)void perform(()=>retryMemoryTasks(conversationId));}}><Text style={{color:colors.primary}}>重试本角色记忆</Text></TouchableOpacity></View>}
        {memories.length===0&&<Text style={{color:colors.textSecondary}}>当前剧情尚无已保存记忆。旧对话不自动回填；达到间隔且有长期价值的信息后生成。</Text>}
    {memories.map(m => <View key={m.id} style={{ padding: 14, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.separator, borderRadius: 14, gap: 8 }}>
      <Text style={{ color: colors.textTertiary, fontSize: 11 }}>{m.source ? `${m.kind || '记忆'} · ${m.source.scene === 'group' ? '群聊' : m.source.scene === 'moments' ? '朋友圈' : '私聊'} · ${new Date(m.updatedAt || m.timestamp).toLocaleDateString()}` : '历史记忆 · 来源未标注'}{m.manualLocked ? ' · 已手动确认' : ''}{m.core?' · 核心关系':''}</Text>
      {editing === m.id ? <>
        <TextInput multiline value={draft} onChangeText={setDraft} style={{ color: colors.inputText, backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 80, textAlignVertical: 'top' }} />
        <View style={{ flexDirection: 'row', flexWrap:'wrap', gap: 16 }}>
          <TouchableOpacity disabled={busy} onPress={async () => { if (!conversationId || busy) return; setBusy(true); try { await editMemory(conversationId, m.id, draft); setEditing(null); } catch (e) { report(e); } finally { setBusy(false); } }}><Text style={{ color: colors.primary }}>保存纠正</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setEditing(null)}><Text style={{ color: colors.textSecondary }}>取消</Text></TouchableOpacity>
        </View>
      </> : <>
        <Text style={{ color: colors.text }}>{m.content}</Text>
        <View style={{ flexDirection: 'row', flexWrap:'wrap', gap: 16 }}>
          <TouchableOpacity onPress={() => { setEditing(m.id); setDraft(m.content); }}><Text style={{ color: colors.primary }}>编辑</Text></TouchableOpacity>
          <TouchableOpacity disabled={busy} onPress={()=>{if(conversationId)void perform(()=>setCoreMemory(conversationId,m.id,!m.core));}}><Text style={{color:colors.primary}}>{m.core?'移出核心':'设为核心'}</Text></TouchableOpacity>
          {m.manualLocked&&<TouchableOpacity disabled={busy} onPress={()=>AppAlert.alert('允许更新这条记忆？','解除锁定后，新增对话可以纠正此事实；手动确认记录仍保留。',[{text:'取消'},{text:'允许更新',onPress:()=>{if(conversationId)void perform(()=>unlockMemory(conversationId,m.id));}}])}><Text style={{color:colors.primary}}>解除锁定</Text></TouchableOpacity>}
          <TouchableOpacity disabled={busy} onPress={() => AppAlert.alert('删除这条记忆？', '删除后不会从旧摘要自动恢复。', [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: async () => { if (!conversationId) return; setBusy(true); try { await deleteMemory(conversationId, m.id); } catch (e) { report(e); } finally { setBusy(false); } } }])}><Text style={{ color: colors.error }}>删除</Text></TouchableOpacity>
        </View>
      </>}
    </View>)}
    {!!character?.memoryState?.edits?.length&&<>
      <TouchableOpacity onPress={()=>setHistoryOpen(v=>!v)}><Text style={{color:colors.primary}}>{historyOpen?'收起':'查看'}记忆修改/删除记录 ({character.memoryState.edits.length})</Text></TouchableOpacity>
      {historyOpen&&character.memoryState.edits.map((entry,index)=><View key={index} style={{padding:14,backgroundColor:colors.surfaceSecondary,borderWidth:1,borderColor:colors.separator,borderRadius:14}}><Text style={{color:colors.textSecondary,fontSize:12}}>{new Date(entry.at).toLocaleString()} · {entry.action==='delete'?'删除':entry.action==='unlock'?'解除锁定':'编辑前'}</Text><Text style={{color:colors.text}}>{entry.memory.content}</Text><TouchableOpacity disabled={busy} onPress={()=>AppAlert.alert('恢复并确认这条记忆？','将作为手动确认记忆恢复，同时解除对应的遗忘限制。',[{text:'取消'},{text:'恢复',onPress:()=>{if(conversationId)void perform(()=>restoreMemory(conversationId,index));}}])}><Text style={{color:colors.primary}}>恢复此内容</Text></TouchableOpacity></View>)}
    </>}
        </ScrollView>
    </ThemedSheet>}
  </View>;
}
