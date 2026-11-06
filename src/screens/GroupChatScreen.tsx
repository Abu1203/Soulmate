// ============================================================
// Soulmate — 群聊界面（修复版：发言归属 + 键盘同步上移 + 退出恢复私聊 + 统一记忆召回）
// ============================================================
import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, Image, ImageBackground,
  Platform, Keyboard, KeyboardAvoidingView, } from 'react-native';
import { AppAlert } from '../services/appDialog';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAgentSoul } from '../contexts/AgentSoulContext';
import { useTheme } from '../contexts/ThemeContext';
import { getApiKey } from '../services/storage';
import { useKeyboardSync } from '../utils/useKeyboardSync';
import { parseUserMessage, renderInjectionBlock } from '../utils/messageParser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AgentSoulMessage, AgentSoulConversation } from '../types/agentsoul';
import { generateId } from '../types/agentsoul';
import { groupRequestTasks } from '../services/requestTask';
import { stripBracketAnnotations } from '../services/replyParser';
import { SoulService } from '../services/SoulService';
import { usesSplitPresentation, sentenceSegments } from '../services/replyPresentation';
import { loadGroupMessages, saveGroupMessages } from '../services/groupStorage';
import { abortable } from '../services/abortable';

const LAST_PRIVATE_KEY = '@soulmate_last_private';

// ✅ 预设情景库（发布情景功能）
const SCENARIOS = [
  '🌅 早上修罗场（全员争宠）', '🐺 狼人杀之夜', '💘 真心话大冒险',
  '🎭 主题剧情扮演', '🎤 K歌大赛', '🧠 智力问答赛', '🎂 给用户过生日',
  '😈 全员互怼模式', '👻 深夜恐怖故事会', '🏖 海边度假闲聊',
];

export default function GroupChatScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { conversations, selectConversation, togglePin, updateConversation, activeConversation, prepareMemoryScope, summarizeConversation } = useAgentSoul();
  const convId = route.params?.convId;
  const conv = conversations.find(c => c.id === convId);

  // ✅ 修复(问题6)：进入群聊前记录"当前私聊 ID"到 ref + AsyncStorage（不依赖易过期的闭包）
  //    退出群聊时无条件恢复该私聊，避免"退出后变成别的单人对话"
  const enteredFromRef = useRef<string | null>(null);
  useEffect(() => {
    const cur = activeConversation;
    const isPrivate = cur && (!cur.type || cur.type === 'private');
    if (isPrivate && cur.id !== convId) {
      enteredFromRef.current = cur.id;
      AsyncStorage.setItem(LAST_PRIVATE_KEY, cur.id).catch(() => {});
    }
  }, [activeConversation?.id]);

  // ✅ 修复(问题6)：不再在挂载时 selectConversation(群)，避免覆盖全局活跃私聊
  //    仅在卸载时，若全局活跃仍是本群，则恢复为最近的私聊
  const latestContextRef = useRef({ activeConversation, conversations, selectConversation });
  latestContextRef.current = { activeConversation, conversations, selectConversation };
  useEffect(() => () => {
    const latest = latestContextRef.current;
    if (latest.activeConversation?.id !== convId) return;
    const validPrivate = (id: string | null) => latest.conversations.find(c => c.id === id && c.type !== 'group');
    const fallback = validPrivate(enteredFromRef.current) || latest.conversations.find(c => c.type !== 'group');
    latest.selectConversation(fallback?.id || '');
  }, [convId]);

  const [msgs, setMsgs] = useState<AgentSoulMessage[]>([]);
  // ✅ 修复(H2 退出丢回复)：消息数组 ref 驱动——setMsgs 全部经此同步，
  //    组件卸载后 ref 仍可更新并落盘，发送中途退出不再丢回复
  const msgsRef = useRef<AgentSoulMessage[]>([]);
  const syncMsgs = useCallback((next: AgentSoulMessage[]) => {
    msgsRef.current = next;
    setMsgs(next);
  }, []);
  // ✅ 修复(切换群聊污染)：跟踪当前 convId，旧群的分条定时器触发时若已切群，直接写旧群存储
  const convIdRef = useRef<string | undefined>(convId);
  useEffect(() => { convIdRef.current = convId; }, [convId]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const reportError = (e: unknown) => AppAlert.alert('群聊操作未完成', e instanceof Error ? e.message : '请重试');
  const [inputRaised, setInputRaised] = useState(false);
  const [showTransferPicker, setShowTransferPicker] = useState(false);
  const [showMemberSettings, setShowMemberSettings] = useState(false);
  // ✅ 功能菜单 + 发布情景
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showScenarioModal, setShowScenarioModal] = useState(false);
  const [scenarioCustom, setScenarioCustom] = useState('');

  // ✅ 发布情景：存入群聊 settings + 群聊消息记录
  const publishScenario = async (scenario: string) => {
    if (!scenario.trim()) return;
    try {
      const base = conv?.settings || { systemPrompt: '', background: '', temperature: 0.7, topP: 0.9 };
      await updateConversation(convId, { settings: { ...base, scenario: scenario.trim() } });
    } catch (e) { reportError(e); return; }
    const sysMsg: AgentSoulMessage = { id: generateId(), role: 'user', content: `[SCENARIO]|${scenario.trim()}`, timestamp: Date.now() };
    void addMsg({ ...sysMsg, meta: 'system' }).catch(reportError);
    setShowScenarioModal(false);
    setScenarioCustom('');
  };

  // ✅ 清除情景
  const clearScenario = async () => {
    try {
      const base = conv?.settings || { systemPrompt: '', background: '', temperature: 0.7, topP: 0.9 };
      const { scenario: _drop, ...rest } = base;
      await updateConversation(convId, { settings: { ...(rest as any), scenario: undefined } });
    } catch (e) { reportError(e); return; }
    const sysMsg: AgentSoulMessage = { id: generateId(), role: 'user', content: '[SCENARIO_CLEAR]', timestamp: Date.now() };
    void addMsg({ ...sysMsg, meta: 'system' }).catch(reportError);
    setShowMoreMenu(false);
  };
  // ✅ @ 艾特机制：输入 @ 弹出成员选择
  const [atMenuVisible, setAtMenuVisible] = useState(false);
  const [atQuery, setAtQuery] = useState('');
  const flatRef = useRef<FlatList>(null);
  const nearBottom = useRef(true);
  const userDraggingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; requestRef.current?.abort(); }; }, []);

  const [contentReady, setContentReady] = useState(false);
  useEffect(() => {
    let alive = true; requestRef.current?.abort(); requestRef.current=null; setSending(false); setText(''); setContentReady(false); setLoadError(''); syncMsgs([]);
    loadGroupMessages(convId).then(values => { if (alive) syncMsgs(values); })
      .catch(e => { if (alive) setLoadError(e.message || '群聊记录不可读，已暂停发送'); })
      .finally(() => { if (alive) setContentReady(true); });
    return () => { alive = false; requestRef.current?.abort(); };
  }, [convId, syncMsgs]);
  useEffect(() => navigation.addListener('focus', () => {
    loadGroupMessages(convId).then(values => {
      if (convIdRef.current !== convId || !mountedRef.current) return;
      const merged = new Map(values.map(m => [m.id, m]));
      for (const m of msgsRef.current) merged.set(m.id, m);
      syncMsgs([...merged.values()].sort((a,b) => a.timestamp-b.timestamp)); setLoadError('');
    }).catch(e => setLoadError(e.message || '群聊记录不可读'));
  }), [navigation, convId, syncMsgs]);

  // ✅ 修复(Bug2/3)：统一键盘联动 —— 输入栏 translateY 同步平移 + 列表 padding 上移 + 强制滚底
  const scrollToEndCb = useCallback((animated = false) => {
    flatRef.current?.scrollToEnd({ animated });
  }, []);
  const kb = useKeyboardSync({
    isNearBottomRef: nearBottom,
    userDraggingRef,
    scrollToEnd: scrollToEndCb,
  });

  const persistMsg = useCallback(async (newMsgs: AgentSoulMessage[]) => {
    const saved = await saveGroupMessages(convId, newMsgs);
    if (mountedRef.current && convIdRef.current === convId) syncMsgs(saved);
    // Group messages are already durable. Updating the sidebar timestamp must
    // not make every group response wait for another full private-history save.
    void updateConversation(convId, { updatedAt: Date.now() }).catch(reportError);
    return saved;
  }, [convId, updateConversation, syncMsgs]);

  const navColor = isDark ? '#FFF' : '#1A1A1A';
  const members = (conv?.memberIds || [])
    .map(id => conversations.find(c => c.id === id))
    .filter(Boolean) as AgentSoulConversation[];

  // memberId → member 的快速查找表（头像 fallback + 颜色分配）
  const memberMap = useRef<Record<string, AgentSoulConversation>>({});
  memberMap.current = {};
  for (const m of members) { memberMap.current[m.id] = m; }

  // 根据 senderId 生成稳定的颜色（不同 AI 视觉区分）
  const getSenderColor = (senderId?: string) => {
    if (!senderId) return colors.primary;
    let hash = 0;
    for (let i = 0; i < senderId.length; i++) hash = ((hash << 5) - hash + senderId.charCodeAt(i)) | 0;
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 50%, ${isDark ? '65%' : '40%'})`;
  };

  const addMsg = useCallback(async (m: AgentSoulMessage) => {
    await persistMsg([...msgsRef.current, m]);
  }, [persistMsg]);

  const handleSend = async () => {
    const msg = text.trim(); if (!msg || requestRef.current || loadError || !conv || !contentReady) return;
    if (!members.length) { AppAlert.alert('暂无可回复的角色', '群聊成员已被删除，请选择有有效成员的群聊'); return; }
    let ctl: AbortController;
    try { ctl = groupRequestTasks.begin(convId); } catch (e) { reportError(e); return; }
    requestRef.current = ctl; setSending(true);
    let userSaved = false;
    const scope = convId;
    try {
      if (!await abortable(getApiKey(),ctl.signal)) throw new Error('请先配置 API Key');
      const before = [...msgsRef.current];
      const summaryReady=new Set<string>();
      for (const member of members) {if(ctl.signal.aborted)return;try{await abortable(prepareMemoryScope(member.id,before,scope),ctl.signal);summaryReady.add(member.id);}catch(e){if(ctl.signal.aborted)return;reportError(new Error(`记忆准备未完成，群聊仍可继续：${e instanceof Error?e.message:'请重试'}`));}}
      if(ctl.signal.aborted)return;
      const parsed = parseUserMessage(msg);
      if (!parsed.cleanText && !parsed.injections.length) throw new Error('消息内容为空');
      const user: AgentSoulMessage = { id: generateId(), role: 'user', content: parsed.cleanText || '（更新虚构情境）', rawText: msg, timestamp: Math.max(Date.now(), (before.at(-1)?.timestamp || 0)+1) };
      let effective=await persistMsg([...before,user]);userSaved=true;if(convIdRef.current===scope){setText('');Keyboard.dismiss();}
      const currentReplies: Array<{id:string;name:string;content:string}> = [];
      for (const member of members) {
        if (ctl.signal.aborted) break;
        let reply = ''; const service = new SoulService();
        try {
          for await (const chunk of service.respond({
            character: { ...member, settings: { ...member.settings, pureTextMode: conv.settings.pureTextMode, splitMessages: conv.settings.splitMessages } },
            history: before, query: parsed.cleanText || '请自然延续当前群聊情境。', injections: parsed.injections,
            conversations, asideMode: 'off', signal: ctl.signal,
            scene: `群聊资料：${JSON.stringify({ name: conv.name, members: members.map(m=>({id:m.id,name:m.name})), scenario: conv.settings.scenario || '', currentReplies })}。仅以自己的身份接话，注意其他成员的发言归属。`,
          })) reply = chunk.reply;
          if (ctl.signal.aborted) break;
          if (['length','max_tokens'].includes(service.lastFinishReason)) throw new Error(`${member.name}的回复达到长度限制，请重新发送`);
          const segments = [reply];
          const replyTime=Math.max(Date.now(),user.timestamp+1,(effective.at(-1)?.timestamp||0)+1);
          const additions: AgentSoulMessage[] = segments.map((content,i) => ({ id: generateId(), role: 'assistant', content, splitMessages:!!conv.settings.splitMessages, inReplyTo: user.id, senderId: member.id, senderName: member.name, senderAvatar: member.avatar, timestamp: replyTime+i }));
          effective=await persistMsg([...effective,...additions]);
          currentReplies.push({ id:member.id, name: member.name, content: reply });
        } catch (e) { if (ctl.signal.aborted) break; reportError(new Error(`${member.name}回复失败：${e instanceof Error ? e.message : '请重试'}`)); }
      }
      if (!ctl.signal.aborted) for (const member of members) {
        // Only rounds with this character's actual successful response enter its summary scope.
        const ownHistory = effective.filter(m => m.role === 'user' || m.senderId === member.id);
        if(summaryReady.has(member.id))void summarizeConversation(member.id, ownHistory, scope, 'group').catch(reportError);
      }
    } catch (e) { if (!userSaved&&convIdRef.current===scope) setText(msg); if(!ctl.signal.aborted)reportError(e); }
    finally { groupRequestTasks.end(convId, ctl); if (requestRef.current === ctl) { requestRef.current = null; if (mountedRef.current) setSending(false); } }
  };

  const displayMsgs=useMemo(()=>{
    const units: AgentSoulMessage[]=[];
    for(const m of msgs){
      const previous=units.at(-1);
      if(m.role==='assistant'&&m.splitMessages===undefined&&previous?.splitMessages===undefined&&m.inReplyTo&&previous?.role==='assistant'&&previous.inReplyTo===m.inReplyTo&&(m.senderId?previous.senderId===m.senderId:!!m.senderName&&!previous.senderId&&previous.senderName===m.senderName))units[units.length-1]={...previous,content:previous.content+m.content,legacyParts:[...(previous.legacyParts||[previous]),m]};
      else units.push({...m});
    }
    return units.flatMap(m=>{
      if(m.role!=='assistant')return [m];
      const content=conv?.settings.pureTextMode?stripBracketAnnotations(m.content):m.content;
      const parts=usesSplitPresentation(m)?sentenceSegments(content):[content];
      return (parts.length?parts:['']).map((body,index)=>({...m,id:index?m.id+':display:'+index:m.id,content:body}));
    });
  },[msgs,conv?.settings.pureTextMode]);

  const renderMsg = ({ item }: { item: AgentSoulMessage }) => {
    const isUser = item.role === 'user';
    const name = item.senderName || 'AI';
    const avatarUri = item.senderAvatar || memberMap.current[item.senderId || '']?.avatar || '';
    const senderColor = getSenderColor(item.senderId);
    const userAvatarUri = conv?.userAvatar || '';
    // ✅ 渲染情景卡片
    if (item.content?.startsWith('[SCENARIO]')) {
      const scenario = item.content.split('|')[1] || '';
      return (
        <View style={{ alignItems: 'center', marginVertical: 6 }}>
          <View style={{ backgroundColor: isDark ? 'rgba(245,166,35,0.15)' : 'rgba(245,166,35,0.12)', borderColor: 'rgba(245,166,35,0.4)', borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 8, alignItems: 'center', maxWidth: '85%' }}>
            <Text style={{ fontSize: 16 }}>🎭</Text>
            <Text style={{ color: navColor, fontSize: 14, fontWeight: '600', marginTop: 2 }}>情景发布</Text>
            <Text style={{ color: isDark ? '#DDD' : '#555', fontSize: 13, marginTop: 2, textAlign: 'center' }}>{scenario}</Text>
          </View>
        </View>
      );
    }
    if (item.content?.startsWith('[SCENARIO_CLEAR]')) {
      return (
        <View style={{ alignItems: 'center', marginVertical: 6 }}>
          <View style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 6 }}>
            <Text style={{ color: isDark ? '#AAA' : '#888', fontSize: 13 }}>🧹 当前情景已清除</Text>
          </View>
        </View>
      );
    }
    // ✅ 修复(群聊转账)：渲染转账卡片
    if (item.content?.startsWith('[TRANSFER]')) {      const parts = item.content.split('|');
      const amount = parts[1] || '0';
      const toName = parts[2] || '';
      const note = parts[3] || '';
      return (
        <View style={[styles.row, styles.rowUser, { justifyContent: 'center' }]}>
          <View style={{
            backgroundColor: isDark ? 'rgba(74,144,217,0.18)' : 'rgba(74,144,217,0.1)',
            borderColor: isDark ? 'rgba(74,144,217,0.35)' : 'rgba(74,144,217,0.25)',
            borderWidth: 1, borderRadius: 12,
            paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', maxWidth: '80%',
          }}>
            <Text style={{ fontSize: 16, marginBottom: 2 }}>💰</Text>
            <Text style={{ color: navColor, fontSize: 14, fontWeight: '600' }}>你向{toName}转账 ¥{amount}</Text>
            {note ? <Text style={{ color: isDark ? '#AAA' : '#888', fontSize: 12, marginTop: 2 }}>{note}</Text> : null}
          </View>
        </View>
      );
    }
    return (
      <View style={[styles.row, isUser && styles.rowUser]}>
        {!isUser && (
          <View style={[styles.av, { backgroundColor: senderColor }]}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avImg} />
            ) : (
              <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>{name[0]}</Text>
            )}
          </View>
        )}
        <View style={[
          styles.bub, isUser ? styles.bubU : styles.bubA,
          {
            backgroundColor: isUser
              ? (isDark ? '#1A3A5C' : '#4A90D9')
              : (isDark ? '#2A2A2A' : '#F0F0F0'),
          },
          !isUser && { borderLeftWidth: 3, borderLeftColor: senderColor },
        ]}>
          {!isUser && (
            <Text style={[styles.sname, { color: senderColor }]}>{name}</Text>
          )}
          <Text style={{
            color: isUser ? '#FFF' : (isDark ? '#DDD' : '#1A1A1A'),
            fontSize: 15, lineHeight: 21,
          }}>
            {item.content}
          </Text>
        </View>
        {isUser && (
          <View style={[styles.av, { backgroundColor: '#34C759', marginLeft: 8, marginRight: 0 }]}>
            {userAvatarUri ? (
              <Image source={{ uri: userAvatarUri }} style={styles.avImg} />
            ) : (
              <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>我</Text>
            )}
          </View>
        )}
      </View>
    );
  };

  const bgImage = conv?.backgroundImage;
  const bgOpacity = (conv?.settings?.backgroundOpacity ?? 10) / 100;

  const inner = (
    <View style={{ flex: 1 }}>
      {/* 导航栏 */}
      <View style={[styles.nav, { paddingTop: insets.top + 8, borderBottomColor: colors.separator }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ color: navColor, fontSize: 14 }}>◀</Text>
        </TouchableOpacity>
        <Text style={{ color: navColor, fontSize: 18, fontWeight: '600' }}>
          {conv?.name || '群聊'}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {/* ✅ 修复(设定不生效-主因)：群聊 ✎ 弹出成员选择，改哪个 AI 就进哪个 AI 的设置页 */}
          <TouchableOpacity onPress={() => setShowMemberSettings(true)}>
            <Text style={{ color: navColor, fontSize: 18 }}>✎</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Theme', { convId })}>
            <Text style={{ color: navColor, fontSize: 18 }}>🎨</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setInputRaised(!inputRaised)}>
            <Text style={{ color: inputRaised ? colors.primary : navColor, fontSize: 18 }}>⇅</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => conv && togglePin(conv.id)}>
            <Text style={{ color: navColor, fontSize: 18 }}>{conv?.isPinned ? '⭐' : '☆'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 成员列表 */}
      <View style={[styles.memberBar, { backgroundColor: isDark ? '#1A1A1A' : '#F0F0F0' }]}>
        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
          {members.map(m => m.name).join('、')} ({members.length}人)
        </Text>
      </View>

      {/* ✅ 键盘联动：KAV behavior=height 让输入框随键盘上移（不手动 transform，避免叠加） */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
      {/* 消息列表 — ✅ 未定位前隐藏防抖动；键盘弹起由 hook 强制滚底 */}
      {!!loadError && <Text style={{ color: '#C0392B', padding: 12 }}>{loadError}</Text>}
      <FlatList
        ref={flatRef}
        data={displayMsgs}
        renderItem={renderMsg}
        keyExtractor={i => i.id}
        style={{ flex: 1, opacity: contentReady ? 1 : 0 }}
        contentContainerStyle={{ padding: 12, paddingBottom: 8 }}
        onScrollToIndexFailed={() => {}}
        onScroll={({ nativeEvent }) => {
          const d = nativeEvent.contentSize.height - nativeEvent.contentOffset.y
            - nativeEvent.layoutMeasurement.height;
          nearBottom.current = d < 120;
        }}
        onScrollBeginDrag={() => { userDraggingRef.current = true; }}
        onScrollEndDrag={() => { userDraggingRef.current = false; }}
        onContentSizeChange={() => {
          if (nearBottom.current && !userDraggingRef.current)
            setTimeout(() => flatRef.current?.scrollToEnd({ animated: false }), 50);
        }}
      />

      {/* ✅ @ 艾特成员选择面板 — 在 KAV 内、输入栏上方（键盘弹起时可见） */}
      {atMenuVisible && (
        <View style={{
          position: 'absolute', bottom: inputRaised ? 130 : 100, left: 12, right: 12,
          backgroundColor: isDark ? '#222' : '#FFF',
          borderRadius: 12, borderWidth: 1,
          borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
          padding: 8, zIndex: 20, elevation: 8,
        }}>
          <Text style={{ color: navColor, fontSize: 13, fontWeight: '600', marginBottom: 6, paddingHorizontal: 6 }}>
            艾特成员
          </Text>
          {members
            .filter(m => m.name.includes(atQuery) || !atQuery)
            .map(m => (
              <TouchableOpacity
                key={m.id}
                onPress={() => {
                  // 用 @名字 替换 @查询文本
                  const atIdx = text.lastIndexOf('@');
                  const newText = text.slice(0, atIdx) + `@${m.name} ` + text.slice(atIdx + 1 + atQuery.length);
                  setText(newText);
                  setAtMenuVisible(false);
                }}
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 6, borderRadius: 8 }}
                activeOpacity={0.6}>
                <Text style={{ color: colors.primary, fontSize: 15, fontWeight: '600' }}>@{m.name}</Text>
                {m.avatar ? (
                  <Image source={{ uri: m.avatar }} style={{ width: 22, height: 22, borderRadius: 11, marginLeft: 8 }} />
                ) : null}
              </TouchableOpacity>
            ))}
        </View>
      )}

      {/* 输入栏 — ✅ 由 KAV 随键盘上移，输入框始终在键盘上方 */}
      <View style={[
        styles.inp,
        {
          backgroundColor: isDark ? '#111' : '#F5F5F5',
          borderTopColor: colors.separator,
          paddingBottom: inputRaised ? 60 : Math.max(insets.bottom, 8),
        },
      ]}>
        {/* ✅ 修复：+ 打开功能菜单（转账只是其中一项），不再直接弹转账 */}
        <TouchableOpacity onPress={() => { setAtMenuVisible(false); setShowMemberSettings(false); setShowMoreMenu(m => !m); }} style={{ paddingHorizontal: 6 }}>
          <Text style={{ color: navColor, fontSize: 22 }}>+</Text>
        </TouchableOpacity>
        <TextInput
          style={[styles.ti, { color: navColor, backgroundColor: isDark ? '#222' : '#FFF' }]}
          value={text}
          onChangeText={(t) => {
            setText(t);
            // ✅ @ 检测：最后一个 @ 后跟文字 → 弹出成员选择
            //    但必须排除 @@ 语法（@背景@）：若 @ 前面有配对的 @（@xxx@ 形式）则不弹
            const atIdx = t.lastIndexOf('@');
            if (atIdx !== -1 && atIdx >= t.length - 20) {
              const prevAt = t.lastIndexOf('@', atIdx - 1);
              const inPair = prevAt !== -1 && !t.slice(prevAt + 1, atIdx).includes(' ');
              const q = t.slice(atIdx + 1).trim();
              if (inPair || q.includes(' ') || t.length - atIdx > 20) {
                setAtMenuVisible(false);
              } else {
                setAtQuery(q);
                // ✅ 修复(浮层互斥)：打开 @ 面板时关闭其他浮层
                setShowMoreMenu(false);
                setShowMemberSettings(false);
                setShowTransferPicker(false);
                setShowScenarioModal(false);
                setAtMenuVisible(true);
              }
            } else {
              setAtMenuVisible(false);
            }
          }}
          placeholder="说点什么...（输入 @ 可艾特成员）"
          placeholderTextColor="#999"
          multiline
          maxLength={2000}
          editable={!loadError}
          returnKeyType="default"
          blurOnSubmit={false}
        />
        <TouchableOpacity
          onPress={() => { if (sending) requestRef.current?.abort(); else void handleSend(); }}
          style={[styles.sb, { backgroundColor: text ? colors.primary : '#CCC' }]}
          disabled={!sending && (!text.trim() || !!loadError || !contentReady)}
        >
          <Text style={{ color: '#FFF', fontWeight: '600' }}>{sending ? '■' : '↑'}</Text>
        </TouchableOpacity>
      </View>
      </KeyboardAvoidingView>

      {/* ✅ 成员设置选择面板（改哪个 AI 就进哪个的设置页） */}
      {showMemberSettings && (
        <View style={{
          position: 'absolute', bottom: 60, left: 0, right: 0,
          backgroundColor: colors.surface,
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
          padding: 16, borderTopWidth: 1, borderColor: colors.separator,
        }}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600', marginBottom: 10 }}>
            选择要修改设置的成员
          </Text>
          {members.map(m => (
            <TouchableOpacity
              key={m.id}
              onPress={() => {
                setShowMemberSettings(false);
                navigation.navigate('AgentSoulSettings', { convId: m.id });
              }}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: colors.separator }}
              activeOpacity={0.6}>
              {m.avatar ? (
                <Image source={{ uri: m.avatar }} style={{ width: 28, height: 28, borderRadius: 14, marginRight: 10 }} />
              ) : (
                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                  <Text style={{ color: '#FFF', fontSize: 13 }}>{m.name[0]}</Text>
                </View>
              )}
              <Text style={{ color: colors.text, fontSize: 15 }}>{m.name}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={() => setShowMemberSettings(false)} style={{ alignItems: 'center', paddingVertical: 12 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 14 }}>取消</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ✅ 功能菜单（+ 按钮） */}
      {showMoreMenu && (
        <View style={{
          position: 'absolute', bottom: inputRaised ? 130 : 100, left: 12, right: 12,
          backgroundColor: isDark ? '#222' : '#FFF',
          borderRadius: 12, borderWidth: 1,
          borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
          padding: 12, zIndex: 20, elevation: 8,
          flexDirection: 'row', flexWrap: 'wrap', gap: 10,
        }}>
          <TouchableOpacity
            onPress={() => { setShowMoreMenu(false); setAtMenuVisible(false); setShowTransferPicker(true); }}
            style={{ width: '46%', alignItems: 'center', paddingVertical: 12, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', borderRadius: 10 }}
            activeOpacity={0.6}>
            <Text style={{ fontSize: 24, marginBottom: 4 }}>💰</Text>
            <Text style={{ color: navColor, fontSize: 13 }}>转账</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { setShowMoreMenu(false); setAtMenuVisible(false); setShowScenarioModal(true); }}
            style={{ width: '46%', alignItems: 'center', paddingVertical: 12, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', borderRadius: 10 }}
            activeOpacity={0.6}>
            <Text style={{ fontSize: 24, marginBottom: 4 }}>🎭</Text>
            <Text style={{ color: navColor, fontSize: 13 }}>发布情景</Text>
          </TouchableOpacity>
          {conv?.settings?.scenario ? (
            <TouchableOpacity
              onPress={() => { clearScenario(); }}
              style={{ width: '46%', alignItems: 'center', paddingVertical: 12, backgroundColor: 'rgba(224,96,96,0.12)', borderRadius: 10 }}
              activeOpacity={0.6}>
              <Text style={{ fontSize: 24, marginBottom: 4 }}>🧹</Text>
              <Text style={{ color: '#E06060', fontSize: 13 }}>清除情景</Text>
            </TouchableOpacity>
          ) : null}
          {showMoreMenu && (
            <TouchableOpacity
              onPress={() => setShowMoreMenu(false)}
              style={{ width: '46%', alignItems: 'center', paddingVertical: 12 }}
              activeOpacity={0.6}>
              <Text style={{ color: navColor, fontSize: 13 }}>收起</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ✅ 发布情景面板 */}
      {showScenarioModal && (
        <View style={{
          position: 'absolute', bottom: inputRaised ? 130 : 100, left: 12, right: 12,
          backgroundColor: isDark ? '#222' : '#FFF',
          borderRadius: 12, borderWidth: 1,
          borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
          padding: 12, zIndex: 30, elevation: 8,
        }}>
          <Text style={{ color: navColor, fontSize: 14, fontWeight: '600', marginBottom: 10 }}>
            🎭 发布情景 — 规定群内此刻的情境/背景
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {SCENARIOS.map(s => (
              <TouchableOpacity
                key={s}
                onPress={() => publishScenario(s)}
                style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }}
                activeOpacity={0.6}>
                <Text style={{ color: navColor, fontSize: 13 }}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={[styles.ti, { color: navColor, backgroundColor: isDark ? '#333' : '#F0F0F0', marginBottom: 10 }]}
            value={scenarioCustom}
            onChangeText={setScenarioCustom}
            placeholder="或自定义情境描述（如：外星人来袭，大家要一起保卫地球）"
            placeholderTextColor="#999"
            multiline
            maxLength={200}
          />
          <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
            <TouchableOpacity onPress={() => { setShowScenarioModal(false); setScenarioCustom(''); }} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }}>
              <Text style={{ color: navColor, fontSize: 13 }}>取消</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => publishScenario(scenarioCustom)} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16, backgroundColor: colors.primary }}>
              <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '600' }}>发布</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* 转账选择面板 */}
      {showTransferPicker && (
        <View style={{
          position: 'absolute', bottom: 60, left: 0, right: 0,
          backgroundColor: colors.surface,
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
          padding: 16, borderTopWidth: 1, borderColor: colors.separator,
        }}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600', marginBottom: 10 }}>
            选择转账对象
          </Text>
          {members.map(m => (
            <TouchableOpacity
              key={m.id}
              onPress={() => {
                setShowTransferPicker(false);
                navigation.navigate('Transfer', { roleName: m.name, convId: m.id, fromGroup: true, groupConvId: convId });
              }}
              style={{ paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: colors.separator }}
            >
              <Text style={{ color: colors.text, fontSize: 16 }}>{m.name}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            onPress={() => setShowTransferPicker(false)}
            style={{ marginTop: 10, alignItems: 'center' }}
          >
            <Text style={{ color: colors.textSecondary, fontSize: 14 }}>取消</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  return bgImage ? (
    <ImageBackground source={{ uri: bgImage }} style={styles.ct} imageStyle={{ opacity: bgOpacity }}>
      {inner}
    </ImageBackground>
  ) : (
    <View style={[styles.ct, { backgroundColor: colors.background }]}>
      {inner}
    </View>
  );
}

const styles = StyleSheet.create({
  ct: { flex: 1 },
  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 0.5,
  },
  memberBar: {
    paddingHorizontal: 16, paddingVertical: 6,
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(128,128,128,0.2)',
  },
  inp: {
    flexDirection: 'row', alignItems: 'flex-end',
    padding: 8, borderTopWidth: 0.5,
  },
  ti: {
    flex: 1, maxHeight: 100, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
    fontSize: 15, marginRight: 8,
  },
  sb: {
    width: 36, height: 36, borderRadius: 18,
    justifyContent: 'center', alignItems: 'center',
  },
  row: { flexDirection: 'row', marginBottom: 10, alignItems: 'flex-start' },
  rowUser: { justifyContent: 'flex-end' },
  av: {
    width: 28, height: 28, borderRadius: 14,
    marginRight: 8, justifyContent: 'center', alignItems: 'center',
  },
  avImg: { width: 28, height: 28, borderRadius: 14 },
  bub: { maxWidth: '75%', borderRadius: 14, padding: 10 },
  bubA: { borderTopLeftRadius: 4 },
  bubU: { borderTopRightRadius: 4 },
  sname: { fontSize: 12, fontWeight: '600', marginBottom: 2 },
});
