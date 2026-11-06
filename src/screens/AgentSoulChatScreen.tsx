// ============================================================
// Soulmate - 主对话界面（倒置列表版：微信式布局）
// ============================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, ImageBackground, ScrollView,
  Platform, Vibration, Keyboard, Animated, Modal, LayoutAnimation,
  KeyboardAvoidingView, Pressable,
} from 'react-native';
import { AppAlert } from '../services/appDialog';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAgentSoul } from '../contexts/AgentSoulContext';
import { useTheme } from '../contexts/ThemeContext';
import { DrawerActions } from '@react-navigation/native';
import { useKeyboardSync } from '../utils/useKeyboardSync';
import AgentSoulMessageBubble from '../components/AgentSoulMessageBubble';
import Toast from '../components/Toast';
import GlassModal from '../components/GlassModal';
import ThemedSheet from '../components/ThemedSheet';
import { messageContent } from '../services/conversationContext';
import { selectedVersion,hasFollowing } from '../services/storyEngine';
import { createMessageRows, type DisplayMessage } from '../services/replyPresentation';

export default function AgentSoulChatScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const {
    activeConversation,
    isStreaming,
    hasApiKey,
    sendMessage, stopMessage, storageUncertain,
    retryMessage,
    switchMessageVersion,editReply,restoreBranch,
    deleteMessage,
    deleteMessages,
    thinkingMode,
    togglePin,
  } = useAgentSoul();
  const activeConversationRef=useRef(activeConversation);activeConversationRef.current=activeConversation;

  // ✅ 防御：如果活跃对话是群聊，跳转到群聊界面（双重检测：type + memberIds）
  useEffect(() => {
    const c = activeConversation;
    const isGroup = c?.type === 'group' || (c?.memberIds && c.memberIds.length > 0);
    if (isGroup && c?.id) {
      navigation.navigate('GroupChat', { convId: c.id });
    }
  }, [activeConversation?.type, activeConversation?.id, activeConversation?.memberIds]);

  const flatListRef = useRef<FlatList>(null);
  const rowsRef = useRef<DisplayMessage[]>([]);
  const scrollRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollAttemptsRef = useRef(0);
  useEffect(() => () => { if (scrollRetryRef.current) clearTimeout(scrollRetryRef.current); }, []);
  const [text, setText] = useState('');
  const sendPressRef=useRef<{id:string|null}|null>(null);
  useEffect(()=>{if(!isStreaming)sendPressRef.current=null;},[isStreaming,activeConversation?.id]);
  const draftRef = useRef('');
  const isNearBottomRef = useRef(true);
  const userDraggingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);
  const [inputExpanded, setInputExpanded] = useState(false);
  // AsyncStorage 同步「扩展输入框」（侧边栏按钮也会改）
  useEffect(() => {
    const load = () => {
      AsyncStorage.getItem('@soulmate_input_expanded').then(v => {
        setInputExpanded(v === '1');
      }).catch(() => {});
    };
    load();
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation]);
  const toggleInputExpanded = async () => {
    const next = !inputExpanded;
    try {
      await AsyncStorage.setItem('@soulmate_input_expanded', next ? '1' : '0'); setInputExpanded(next);
    } catch { AppAlert.alert('输入框设置未保存', '请检查存储空间后重试'); }
  };
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [showDeleteMsgModal, setShowDeleteMsgModal] = useState(false);
  const [deleteMsgTarget, setDeleteMsgTarget] = useState<string | null>(null);
  const [msgSelectionMode, setMsgSelectionMode] = useState(false);
  const [editSelection,setEditSelection]=useState(false);
  const [editingReply,setEditingReply]=useState<string|null>(null),[replyDraft,setReplyDraft]=useState(''),[savingReply,setSavingReply]=useState(false);
  const [branchesOpen,setBranchesOpen]=useState(false);
  useEffect(()=>{setEditSelection(false);setEditingReply(null);setBranchesOpen(false);setMsgSelectionMode(false);setMsgSelectedIds(previous=>previous.size?new Set():previous);setShowDeleteMsgModal(false);setDeleteMsgTarget(null);setSearchOpen(false);setSearchText('');},[activeConversation?.id]);
  const storyError=(e:unknown)=>AppAlert.alert('剧情未修改',e instanceof Error?e.message:'请重试');
  const confirmStory=useCallback((id:string,action:(confirmed:boolean)=>Promise<void>)=>{
    const current=activeConversationRef.current;
    const execute=(confirmed:boolean)=>{if(activeConversationRef.current?.id!==current?.id){storyError(new Error('当前角色已切换，请重新选择回复'));return;}void action(confirmed).catch(storyError);};
    if(current&&hasFollowing(current,id))AppAlert.alert('改变后续剧情？','此回复之后的对话将保留为可恢复的历史剧情，不再影响当前对话和自动记忆。',[{text:'取消',style:'cancel'},{text:'确认修改',onPress:()=>execute(true)}]);else execute(false);
  },[]);
  const openReplyEditor=useCallback((id:string)=>{const m=activeConversationRef.current?.messages.find(m=>m.id===id&&m.role==='assistant');if(!m)return;setReplyDraft(selectedVersion(m).content);setEditingReply(id);},[]);
  const saveReply=()=>{if(!editingReply||savingReply)return;const id=editingReply;confirmStory(id,async confirmed=>{setSavingReply(true);try{await editReply(id,replyDraft,confirmed);setEditingReply(null);setEditSelection(false);}finally{setSavingReply(false);}});};
  // ✅ 平滑过渡：多选模式切换时用 LayoutAnimation 防止屏幕跳动
  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, [msgSelectionMode]);
  const [msgSelectedIds, setMsgSelectedIds] = useState<Set<string>>(new Set());

  const [showScrollDown, setShowScrollDown] = useState(false);

  // ============================================================
  // 聊天记录搜索
  // ============================================================
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const searchInputRef = useRef<TextInput>(null);

  // 点击搜索结果 → 定位+高亮（inverted 列表索引需反转：index = len-1-msgIndex）
  const jumpToMessage = useCallback((msgIndex: number, msgId: string) => {
    setSearchOpen(false);
    setSearchText('');
    Keyboard.dismiss();
    setHighlightedMsgId(msgId);
    setTimeout(() => {
      if (!mountedRef.current) return;
      const index = rowsRef.current.findIndex(m => (m.unitId || m.id) === msgId);
      if (index < 0) return;
      scrollAttemptsRef.current = 0;
      flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    }, 150);
    setTimeout(() => setHighlightedMsgId(null), 2500);
  }, [activeConversation?.messages?.length]);

  const canSend = text.trim().length > 0 && hasApiKey && !isStreaming;

  // ============================================================
  // ↓ 滚动到底按钮（inverted：offset 0 = 最新消息）
  // ============================================================
  const scrollToBottom = useCallback(() => {
    isNearBottomRef.current = true;
    setShowScrollDown(false);
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  // ============================================================
  // 键盘联动（KAV behavior=height + 键盘弹起强制回底部）
  // ============================================================
  const scrollToEndCb = useCallback((animated = false) => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated });
  }, []);
  const kb = useKeyboardSync({
    isNearBottomRef,
    userDraggingRef,
    scrollToEnd: scrollToEndCb,
  });
  const keyboardVisible = kb.keyboardVisible;

  // ============================================================
  // 进入对话 — 倒置列表天然定位在最新消息（offset 0 = 底部）
  // ============================================================
  useEffect(() => {
    const focus = navigation.addListener('focus', () => {
      // 回到聊天页强制关闭 Drawer，杜绝"卡在侧边栏回不去对话"
      try { navigation.dispatch(DrawerActions.closeDrawer()); } catch {}
    });
    return () => { focus?.(); };
  }, [navigation]);

  // ✅ 对话切换：滚动到 offset 0（最新消息），无动画
  useEffect(() => {
    const cid = activeConversation?.id;
    if (!cid) return;
    flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
    isNearBottomRef.current = true;
  }, [activeConversation?.id]);

  const handleFlatListLayout = useCallback(() => {
    // 倒置列表：offset 0 即最新消息，无需滚动
  }, []);

  // ============================================================
  // 扩展面板 — 纯 opacity + useNativeDriver
  // ============================================================
  const [toolPanelOpen, setToolPanelOpen] = useState(false);
  const [showGamePicker, setShowGamePicker] = useState(false);
  const panelOpacity = useRef(new Animated.Value(0)).current;
  const panelTranslate = useRef(new Animated.Value(100)).current;

  const toggleToolPanel = () => {
    if (toolPanelOpen) {
      Animated.parallel([
        Animated.timing(panelOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(panelTranslate, { toValue: 100, duration: 180, useNativeDriver: true }),
      ]).start(() => setToolPanelOpen(false));
    } else {
      Keyboard.dismiss();
      setToolPanelOpen(true);
      panelOpacity.setValue(0);
      panelTranslate.setValue(100);
      Animated.parallel([
        Animated.timing(panelOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.timing(panelTranslate, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start();
      // 仅在底部时滚，看历史时不动
      if (isNearBottomRef.current && !userDraggingRef.current) {
        setTimeout(() => { if (mountedRef.current && isNearBottomRef.current && !userDraggingRef.current) flatListRef.current?.scrollToOffset({ offset: 0, animated: false }); }, 200);
      }
    }
  };

  const tools = [
    { icon: '💰', label: '转账', action: () => navigation.navigate('Transfer', { roleName: activeConversation?.name || 'AI', convId: activeConversation?.id }) },
    { icon: '🎮', label: '游戏', action: () => setShowGamePicker(true) },
    { icon: '🔍', label: '搜索', action: () => { setToolPanelOpen(false); setTimeout(() => { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 100); }, 100); } },
    { icon: '🍅', label: '番茄钟', action: () => {
      setToolPanelOpen(false);
      setTimeout(() => navigation.navigate('Pomodoro', {
        aiName: activeConversation?.name || 'AI',
        aiAvatar: activeConversation?.avatar,
      }), 100);
    }},
    { icon: '🎤', label: '语音' },
    { icon: '📍', label: '位置' }, { icon: '💬', label: '引用' }, { icon: '⚙️', label: '更多' },
  ];

  const navigateToGame = (gameId: string) => {
    setShowGamePicker(false);
    const screenMap: Record<string, string> = {
      guess: 'GameGuessNumber', chengyu: 'GameIdiomChain',
      '20q': 'GameTwentyQuestions', gomoku: 'GameGomoku',
    };
    const screenName = screenMap[gameId];
    if (screenName) {
      navigation.navigate(screenName, {
        aiName: activeConversation?.name || 'AI',
        aiAvatar: activeConversation?.avatar,
        userName: '我',
        userAvatar: activeConversation?.userAvatar,
        conversationId: activeConversation?.id,
      });
    }
  };

  const handleSend = useCallback(async () => {
    const owner={id:activeConversationRef.current?.id||null};
    if(sendPressRef.current&&sendPressRef.current.id===owner.id)return;
    if (!canSend) {
      if (!hasApiKey) { setToastMsg('请先在 AI 服务设置中配置 API Key'); setToastVisible(true); }
      return;
    }
    const msg = text.trim();
    sendPressRef.current=owner;
    setText('');
    Keyboard.dismiss();
    // 发送后立即回到底部（inverted: offset 0 = 最新消息）
    setTimeout(() => flatListRef.current?.scrollToOffset({ offset: 0, animated: false }), 100);
    try { await sendMessage(msg,undefined,owner.id||undefined); } catch (e: any) { if((activeConversationRef.current?.id||null)===owner.id){setToastMsg(e.message || '发送失败'); setToastVisible(true); setText(current => current || msg);} }
    finally{if(sendPressRef.current===owner)sendPressRef.current=null;}
  }, [canSend, hasApiKey, text, sendMessage]);

  const messages = activeConversation?.messages || [];
  // ✅ 倒置列表数据：最新消息在 index 0（微信式布局）
  const messageRows=useRef(createMessageRows()).current;
  const invertedData = useMemo(() => messageRows(messages,!!activeConversation?.settings.pureTextMode), [messages,activeConversation?.settings.pureTextMode,messageRows]);
  rowsRef.current = invertedData;
  // ✅ 搜索结果：过滤包含搜索词的消息（必须在 messages 之后）
  const searchResults = searchText.trim()
    ? messages
        .map((m, idx) => ({ item: m, index: idx }))
        .filter(({ item }) => messageContent(item).toLowerCase().includes(searchText.toLowerCase()))
    : [];
  const backgroundImage = activeConversation?.backgroundImage;
  const bgOpacity = (activeConversation?.settings?.backgroundOpacity ?? 10) / 100;
  const avatar = activeConversation?.avatar;
  const userAvatar = activeConversation?.userAvatar;
  const navColor = isDark ? '#FFFFFF' : '#1A1A1A';

  const handleMessageLongPress = useCallback((messageId: string) => {
    Vibration.vibrate(30);
    setDeleteMsgTarget(messageId);
    setShowDeleteMsgModal(true);
  }, []);

  // ✅ 稳定引用：extraData 用 useMemo，避免流式期间每 100ms 全列表重渲染
  const extraDataRef = useMemo(
    () => ({ highlightedMsgId, msgSelectedIds, msgSelectionMode, editSelection, isDark }),
    [highlightedMsgId, msgSelectedIds, msgSelectionMode, editSelection, isDark],
  );

  const renderMessage = useCallback(({ item }: { item: DisplayMessage }) => {
    const unitId=item.unitId||item.id;
    const isHighlighted = unitId === highlightedMsgId;
    return (
    <View style={{
      flexDirection: 'row', alignItems: 'flex-start',
      justifyContent: item.role === 'user' ? 'flex-end' : 'flex-start',
      paddingLeft: msgSelectionMode ? 4 : 0,
    }}>
      {msgSelectionMode && (
        <TouchableOpacity onPress={() => {
          setMsgSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(unitId)) next.delete(unitId); else next.add(unitId);
            return next;
          });
        }} style={{ width: 36, height: 36, justifyContent: 'center', alignItems: 'center', marginRight: 4, marginTop: 6 }}>
          <Text style={{ fontSize: 20 }}>{msgSelectedIds.has(unitId) ? '✅' : '⬜'}</Text>
        </TouchableOpacity>
      )}
      <View style={{ flexShrink: 1,position:'relative' }}>
        {editSelection&&item.role==='assistant'&&<Pressable accessibilityLabel="选择这条AI回复进行修改" onPress={()=>openReplyEditor(unitId)} style={{position:'absolute',top:0,left:0,right:0,bottom:0,zIndex:10,borderWidth:1,borderColor:colors.primary,borderRadius:12}} />}
        {/* ✅ 搜索高亮：金色脉冲边框 */}
        <View style={isHighlighted ? {
          borderWidth: 2, borderColor: '#F5A623', borderRadius: 18,
          backgroundColor: isDark ? 'rgba(245,166,35,0.08)' : 'rgba(245,166,35,0.12)',
          padding: 2, margin: -2,
        } as any : undefined}>
        <AgentSoulMessageBubble
          message={item}
          bodyText={item.bodyText}
          pureTextMode={!!activeConversation?.settings.pureTextMode}
          avatar={avatar}
          userAvatar={userAvatar}
          thinkingMode={thinkingMode}
          onLongPress={msgSelectionMode || editSelection ? undefined : ()=>handleMessageLongPress(unitId)}
          onRetry={item.role === 'assistant' && !item.continuation && !isStreaming && !editSelection ? () => confirmStory(unitId,confirmed=>retryMessage(unitId,confirmed)) : undefined}
          onSwitchVersion={item.role === 'assistant' && !item.continuation && !isStreaming && !editSelection ? (dir) => confirmStory(unitId,confirmed=>switchMessageVersion(unitId,dir,confirmed)) : undefined}
        />
        </View>
      </View>
    </View>
  )}, [avatar, userAvatar, thinkingMode, retryMessage, switchMessageVersion, handleMessageLongPress, msgSelectionMode, msgSelectedIds, highlightedMsgId, isDark,editSelection,isStreaming, activeConversation?.settings.pureTextMode,confirmStory,openReplyEditor]);

  const handleScroll = useCallback(({ nativeEvent }: any) => {
    // ✅ 倒置列表：offset 0 = 底部（最新消息），offset 增大 = 向上看历史
    const near = nativeEvent.contentOffset.y < 120;
    isNearBottomRef.current = near;
    setShowScrollDown(!near && messages.length > 5);
  }, [messages.length]);

  // ============================================================
  // contentSizeChange — 倒置列表下新消息自动出现在底部，无需滚动
  // ============================================================
  const handleContentSizeChange = useCallback(() => {
    // 用户在底部：保持 offset 0，确保最新消息在底部可见（键盘弹出等场景）
    if (isNearBottomRef.current && !userDraggingRef.current) {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, []);

  const expandAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(expandAnim, {
      toValue: inputExpanded ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [inputExpanded]);

  const inner = (
    <View style={styles.inner}>
      {/* 顶部导航 */}
      <View style={[styles.nav, { paddingTop: insets.top }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => navigation.dispatch(DrawerActions.openDrawer())} style={styles.navBtn}>
            <Text style={[styles.navIcon, { color: navColor }]}>☰</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => {
            setEditSelection(false);
            if (msgSelectionMode) {
              if (msgSelectedIds.size > 0) {
                deleteMessages(msgSelectedIds);
                setMsgSelectedIds(new Set());
              }
              setMsgSelectionMode(false);
              setText(draftRef.current);
            } else {
              draftRef.current = text;
              setMsgSelectionMode(true);
            }
          }} style={[styles.navBtn, { marginLeft: 10 }]}>
            <Text style={[styles.navIcon, { color: msgSelectionMode ? '#E06060' : navColor }]}>🗑</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityLabel="修改AI回复" disabled={isStreaming||storageUncertain} onPress={()=>{setMsgSelectionMode(false);setMsgSelectedIds(new Set());setEditSelection(v=>!v);}} style={[styles.navBtn,{marginLeft:6}]}><Text style={{fontSize:13,color:editSelection?colors.primary:navColor}}>{editSelection?'取消':'修改'}</Text></TouchableOpacity>
        </View>
        <Text style={[styles.title, { color: navColor }]} numberOfLines={1}>{activeConversation?.name || '新对话'}</Text>
        <View style={styles.navRight}>
          <TouchableOpacity onPress={() => { try { navigation.navigate('AgentSoulSettings'); } catch {} }} style={styles.navBtn}>
            <Text style={[styles.navIcon, { color: navColor }]}>✎</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { try { navigation.navigate('Theme'); } catch {} }} style={styles.navBtn}>
            <Text style={[styles.navIcon, { color: navColor }]}>🎨</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={toggleInputExpanded} style={styles.navBtn}>
            <Text style={[styles.navIcon, { color: inputExpanded ? colors.primary : navColor }]}>{inputExpanded ? '↕' : '⇅'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => activeConversation && togglePin(activeConversation.id)} style={styles.navBtn}>
            <Text style={[styles.navIcon, { color: navColor }]}>{activeConversation?.isPinned ? '⭐' : '☆'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {(editSelection||!!activeConversation?.story?.branches.length)&&<View style={{flexDirection:'row',justifyContent:'space-between',paddingHorizontal:14,paddingVertical:8,backgroundColor:colors.surface}}>
        {editSelection&&<Text style={{color:colors.textSecondary,fontSize:12}}>请选择一条 AI 回复，分条回复将整轮修改</Text>}
        {!!activeConversation?.story?.branches.length&&<TouchableOpacity onPress={()=>setBranchesOpen(true)}><Text style={{color:colors.primary,fontSize:12}}>历史剧情 ({activeConversation.story.branches.length})</Text></TouchableOpacity>}
      </View>}
      <ThemedSheet visible={!!editingReply} title="修改完整 AI 回复" closeText="取消" busy={savingReply} large onClose={()=>setEditingReply(null)}
        action={{text:'保存',onPress:saveReply,disabled:!replyDraft.trim()}}>
        <Text style={{color:colors.textSecondary,fontSize:12,marginBottom:12}}>保存为新版本，原回复仍可切换和恢复。</Text>
        <TextInput accessibilityLabel="完整AI回复正文" multiline editable={!savingReply} value={replyDraft} onChangeText={setReplyDraft}
          style={{flex:1,color:colors.inputText,backgroundColor:colors.inputBackground,borderWidth:1,borderColor:colors.inputBorder,borderRadius:12,padding:14,fontSize:16,textAlignVertical:'top'}} />
      </ThemedSheet>
      <ThemedSheet visible={branchesOpen} title="可恢复的历史剧情" closeText="关闭" onClose={()=>setBranchesOpen(false)}>
        <ScrollView style={{flexGrow:0}} contentContainerStyle={{gap:10,paddingBottom:4}}>
          {activeConversation?.story?.branches.map(b=><TouchableOpacity key={b.id} disabled={isStreaming}
            style={{padding:14,backgroundColor:colors.surfaceSecondary,borderWidth:1,borderColor:colors.separator,borderRadius:14}}
            onPress={()=>AppAlert.alert('恢复这条剧情？','当前对话也会保留为历史剧情；自动记忆随所选剧情恢复，手动确认记忆保持。',[{text:'取消',style:'cancel'},{text:'恢复',onPress:()=>{void restoreBranch(b.id,true).then(()=>setBranchesOpen(false)).catch(storyError);}}])}>
            <Text style={{color:colors.text}}>{b.label}</Text><Text style={{color:colors.textSecondary,fontSize:12,marginTop:6}}>{b.messages.length} 条消息</Text>
          </TouchableOpacity>)}
        </ScrollView>
      </ThemedSheet>
      {/* 内容区 + 输入栏 — KAV 整体上移（键盘弹起输入栏可见） */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
        <View style={styles.contentArea}>
        {/* ✅ 聊天记录搜索面板 */}
        {searchOpen && (
          <View style={[styles.searchPanel, {
            backgroundColor: isDark ? 'rgba(20,20,20,0.92)' : 'rgba(250,250,250,0.92)',
            borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
          }]}>
            {/* 搜索输入行 */}
            <View style={styles.searchRow}>
              <View style={[styles.searchInputWrap, {
                backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
                borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
              }]}>
                <Text style={styles.searchIcon}>🔍</Text>
                <TextInput
                  ref={searchInputRef}
                  style={[styles.searchInput, { color: navColor }]}
                  value={searchText}
                  onChangeText={setSearchText}
                  placeholder="搜索聊天记录..."
                  placeholderTextColor={isDark ? '#666' : '#999'}
                  autoFocus
                  returnKeyType="search"
                />
                {searchText.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchText('')} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                    <Text style={{ color: isDark ? '#888' : '#AAA', fontSize: 16 }}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity
                onPress={() => { setSearchOpen(false); setSearchText(''); Keyboard.dismiss(); }}
                style={[styles.searchCloseBtn, {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
                }]}>
                <Text style={{ color: isDark ? '#AAA' : '#888', fontSize: 16 }}>✕</Text>
              </TouchableOpacity>
            </View>
            {/* 搜索结果列表 */}
            {searchText.trim() && (
              <ScrollView
                style={[styles.searchResults, {
                  backgroundColor: isDark ? 'rgba(30,30,30,0.85)' : 'rgba(255,255,255,0.85)',
                  borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
                }]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={true}>
                {searchResults.length === 0 ? (
                  <Text style={[styles.searchEmpty, { color: isDark ? '#888' : '#999' }]}>未找到相关消息</Text>
                ) : (
                  searchResults.slice(0, 30).map(({ item, index }) => (
                    <TouchableOpacity
                      key={item.id}
                      onPress={() => jumpToMessage(index, item.id)}
                      style={[styles.searchResultItem, {
                        borderBottomColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
                      }]}>
                      <Text style={[styles.searchResultRole, { color: item.role === 'user' ? (isDark ? '#6DB3F2' : '#4A90D9') : (isDark ? '#C4B5D0' : '#9A8AA8') }]}>
                        {item.role === 'user' ? '我' : (activeConversation?.name || 'AI')}
                      </Text>
                      <Text style={[styles.searchResultPreview, { color: isDark ? '#CCC' : '#555' }]} numberOfLines={2}>
                        {item.content}
                      </Text>
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            )}
          </View>
        )}
        {messages.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>💬</Text>
            <Text style={[styles.emptyTitle, { color: navColor }]}>开始对话</Text>
            <Text style={styles.emptySubtitle}>在这里，AI是你的陪伴者{'\n'}说出你想说的任何话</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={invertedData}
            renderItem={renderMessage}
            inverted
            keyExtractor={(i) => i.id}
            extraData={extraDataRef}
            style={styles.list}
            contentContainerStyle={[styles.listContent, { paddingTop: 8 }]}
            onScrollToIndexFailed={(info) => {
              if (scrollAttemptsRef.current >= 2 || !rowsRef.current[info.index]) return;
              scrollAttemptsRef.current++;
              const targetId = rowsRef.current[info.index].id;
              flatListRef.current?.scrollToOffset({ offset: Math.max(0, info.index * (info.averageItemLength || 80)), animated: false });
              if (scrollRetryRef.current) clearTimeout(scrollRetryRef.current);
              scrollRetryRef.current = setTimeout(() => {
                if (!mountedRef.current) return;
                const index = rowsRef.current.findIndex(m => m.id === targetId);
                if (index >= 0) flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
              }, 300);
            }}
            onScroll={handleScroll}
            onLayout={handleFlatListLayout}
            onScrollBeginDrag={() => { userDraggingRef.current = true; }}
            onScrollEndDrag={() => { userDraggingRef.current = false; }}
            onContentSizeChange={handleContentSizeChange}
            removeClippedSubviews={false}
            maxToRenderPerBatch={10}
            windowSize={11}
            initialNumToRender={30}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
          />
        )}
        </View>

      {/* 扩展面板 */}
      {toolPanelOpen && (
        <Animated.View style={[
          styles.toolPanel,
          {
            backgroundColor: isDark ? 'rgba(30,30,30,0.97)' : 'rgba(255,255,255,0.97)',
            opacity: panelOpacity,
            transform: [{ translateY: panelTranslate }],
          },
        ]}>
          <View style={styles.toolGrid}>
            {tools.map((t, i) => (
              <TouchableOpacity key={i} style={styles.toolItem} onPress={() => {
                if (t.action) {
                  setToolPanelOpen(false);
                  setTimeout(() => t.action!(), 100);
                } else {
                  toggleToolPanel();
                  setToastMsg('小宝，暂未开放'); setToastVisible(true);
                }
              }} activeOpacity={0.6}>
                <View style={[styles.toolIcon, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                  <Text style={{ fontSize: 22 }}>{t.icon}</Text>
                </View>
                <Text style={[styles.toolLabel, { color: isDark ? '#E0E0E0' : '#1A1A1A' }]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Animated.View>
      )}

      {/* 输入栏 */}
      <Animated.View style={styles.inputBarOuter}>
        {/* ↓ 滚动到底 — 绝对定位浮在输入栏上方，不占布局空间 */}
        {showScrollDown && !msgSelectionMode && messages.length > 0 && (
          <TouchableOpacity
            onPress={scrollToBottom}
            activeOpacity={0.7}
            style={[styles.scrollDownBtn, {
              position: 'absolute',
              bottom: '100%',
              right: 12,
              marginBottom: 4,
              backgroundColor: isDark ? 'rgba(40,40,40,0.85)' : 'rgba(255,255,255,0.85)',
              borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
            }]}>
            <Text style={{ fontSize: 16, color: isDark ? '#DDD' : '#555' }}>↓</Text>
          </TouchableOpacity>
        )}
        <Animated.View style={[
          styles.inputBar,
          {
            backgroundColor: keyboardVisible
              ? (isDark ? 'rgba(20,20,20,0.95)' : 'rgba(250,250,250,0.95)')
              : (isDark ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.45)'),
            borderTopColor: 'transparent',
            paddingBottom: expandAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [insets.bottom || 8, (insets.bottom || 8) + 64],
              extrapolate: 'clamp',
            }),
          },
          msgSelectionMode && { backgroundColor: '#E0606015' },
        ]}>
        {msgSelectionMode ? (
          <View style={{ justifyContent: 'center', alignItems: 'center', flex: 1 }}>
            <TouchableOpacity onPress={() => {
              deleteMessages(msgSelectedIds);
              setMsgSelectedIds(new Set());
              setMsgSelectionMode(false);
              setText(draftRef.current);
            }} style={{ paddingVertical: 10 }} activeOpacity={0.7}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: msgSelectedIds.size > 0 ? '#E06060' : '#999' }}>
                删除 {msgSelectedIds.size} 条消息
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.inputRow}>
            <TouchableOpacity onPress={toggleToolPanel} style={[styles.plusBtn, toolPanelOpen && styles.plusBtnActive]} activeOpacity={0.6}>
              <Text style={[styles.plusText, { color: isDark ? '#AAA' : '#888' }, toolPanelOpen && { transform: [{ rotate: '45deg' }] }]}>+</Text>
            </TouchableOpacity>
            <TextInput
              style={[styles.textInput, { backgroundColor: 'transparent', color: navColor, maxHeight: inputExpanded ? 180 : 120 }]}
              value={text}
              onChangeText={setText}
              placeholder="说点什么..."
              placeholderTextColor="#999"
              maxLength={2000}
              multiline
              numberOfLines={inputExpanded ? 8 : 4}
              editable={true}
              returnKeyType="default"
              blurOnSubmit={false}
            />
            <TouchableOpacity accessibilityLabel={isStreaming ? '停止生成' : '发送消息'} onPress={isStreaming ? stopMessage : handleSend} style={[styles.sendBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.06)' }, canSend && { backgroundColor: colors.primary }]} activeOpacity={0.6}>
              <Text style={[styles.sendText, { color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.2)' }, canSend && styles.sendTextActive]}>{isStreaming ? '■' : '↑'}</Text>
            </TouchableOpacity>
          </View>
        )}
        </Animated.View>
      </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );

  return (
    <>
      {backgroundImage ? (
        <ImageBackground source={{ uri: backgroundImage }} style={styles.container} imageStyle={{ opacity: bgOpacity }}>
          {inner}
        </ImageBackground>
      ) : (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
          {inner}
        </View>
      )}
      <Toast visible={toastVisible} message={toastMsg} type="warning" onDismiss={() => setToastVisible(false)} />
      <GlassModal visible={showDeleteMsgModal} icon="🗑" title="删除这条消息？" message="删除后无法恢复，仅从本地移除" confirmText="确认删除" cancelText="取消"
        onConfirm={() => { if (deleteMsgTarget) deleteMessage(deleteMsgTarget); setShowDeleteMsgModal(false); }}
        onCancel={() => setShowDeleteMsgModal(false)} />

      {/* 游戏选择 */}
      <Modal visible={showGamePicker} transparent animationType="fade" onRequestClose={()=>setShowGamePicker(false)}>
        <TouchableOpacity style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.overlay }} activeOpacity={1} onPress={() => setShowGamePicker(false)}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 20, width: '82%', maxWidth: 340 }}>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600', textAlign: 'center', marginBottom: 18 }}>🎮 选择游戏</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
              {[
                { n: '猜数字', icon: '🔢', g: 'guess', desc: 'AI想数字，你来猜' },
                { n: '成语接龙', icon: '📝', g: 'chengyu', desc: '和AI轮流接成语' },
                { n: '二十问', icon: '❓', g: '20q', desc: '20个问题猜出答案' },
                { n: '五子棋', icon: '⚫⚪', g: 'gomoku', desc: '对战AI五子棋' },
              ].map(g => (
                <TouchableOpacity key={g.g} onPress={() => navigateToGame(g.g)} activeOpacity={0.7}
                  style={{ width: '45%', backgroundColor: isDark ? '#2A2A2A' : '#F5F5F5', borderRadius: 12, paddingVertical: 16, paddingHorizontal: 10, alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontSize: 32 }}>{g.icon}</Text>
                  <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>{g.n}</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 11, textAlign: 'center' }}>{g.desc}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity onPress={() => setShowGamePicker(false)} style={{ marginTop: 16, alignItems: 'center' }}>
              <Text style={{ color: colors.textSecondary, fontSize: 14 }}>取消</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  inner: { flex: 1, overflow: 'hidden' },
  contentArea: { flex: 1 },
  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10,
  },
  navBtn: { padding: 4 },
  navIcon: { fontSize: 20 },
  title: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '600', marginHorizontal: 8 },
  navRight: { flexDirection: 'row', gap: 8 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: '#999', textAlign: 'center', lineHeight: 22 },
  list: { flex: 1 },
  listContent: { paddingVertical: 8, paddingBottom: 4 },
  inputBar: {
    borderTopWidth: 0.5,
  },
  inputBarOuter: {},
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 12, paddingVertical: 8,
  },
  textInput: { flex: 1, maxHeight: 120, fontSize: 15, lineHeight: 20, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginRight: 8 },
  sendBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  sendText: { fontSize: 18, fontWeight: '600' },
  sendTextActive: { color: '#FFF' },
  plusBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginRight: 6 },
  plusBtnActive: {},
  plusText: { fontSize: 24, fontWeight: '300' },
  toolPanel: {
    paddingTop: 16, paddingBottom: 20,
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    position: 'absolute', bottom: 0, left: 0, right: 0,
  },
  toolGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', paddingHorizontal: 8 },
  toolItem: { width: '23%', alignItems: 'center', marginBottom: 16 },
  toolIcon: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  toolLabel: { fontSize: 11, textAlign: 'center' },
  scrollDownBtn: {
    width: 32, height: 32, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 0.5,
    zIndex: 5,
  },
  // ============================================================
  // 搜索面板样式
  // ============================================================
  searchPanel: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    borderBottomWidth: 0.5,
    paddingTop: 8, paddingBottom: 8, paddingHorizontal: 12,
  },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  searchInputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    borderRadius: 10, borderWidth: 0.5,
    paddingHorizontal: 10, height: 36,
  },
  searchIcon: { fontSize: 14, marginRight: 6 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  searchCloseBtn: {
    width: 32, height: 32, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center',
  },
  searchResults: {
    marginTop: 6, borderRadius: 10, borderWidth: 0.5,
    maxHeight: 420,
  },
  searchResultItem: {
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 0.5,
  },
  searchResultRole: { fontSize: 12, fontWeight: '600', marginBottom: 2 },
  searchResultPreview: { fontSize: 14, lineHeight: 20 },
  searchEmpty: { textAlign: 'center', paddingVertical: 24, fontSize: 14 },
});
