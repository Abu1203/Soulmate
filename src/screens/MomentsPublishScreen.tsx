// ============================================================
// Soulmate v2 — 朋友圈发布编辑页
// ============================================================
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { AppAlert } from '../services/appDialog';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GlassModal from '../components/GlassModal';
import { useTheme } from '../contexts/ThemeContext';
import { useAgentSoul } from '../contexts/AgentSoulContext';
import type { MomentComment, Moment } from '../types/moments';
import { generateMomentId } from '../types/moments';
import { addMoment, addComment, saveDraft, loadDraft, clearDraft, loadMoments, updateMoment } from '../services/momentsStorage';
import { persistImageUri } from '../services/imageStore';
import { generateAIMomentsComments } from '../services/momentsAI';
import { describeImages } from '../services/momentsAI';
import { momentRequestTasks } from '../services/requestTask';
import { momentDialogForCharacter } from '../services/momentsContext';
import { createGroupMsgsLoader } from '../services/contextBundle';

export default function MomentsPublishScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { colors, isDark, customTheme } = useTheme();
  const isEmotion = customTheme === 'emotion';
  const { conversations, prepareMemoryScope, summarizeConversation } = useAgentSoul();

  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [selectedAiIds, setSelectedAiIds] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);
  const postingRef = useRef(false), publishedRef = useRef(false);
  const draftWritableRef=useRef(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  // ✅ 全部朋友圈动态（供统一上下文包注入"之前朋友圈互动"）
  const allMomentsRef = useRef<Moment[]>([]);
  useEffect(() => {
    loadMoments().then((m) => { allMomentsRef.current = m || []; }).catch(() => {});
  }, []);
  // ✅ 群消息加载器（供统一上下文包注入"之前群聊互动"）
  const groupMsgsLoaderRef = useRef(createGroupMsgsLoader());

  const navColor = isDark || isEmotion ? '#FFFFFF' : '#1A1A1A';

  // 恢复草稿
  const [draftState, setDraftState] = useState<{ checked: boolean; hadDraft: boolean }>({ checked: false, hadDraft: false });
  const userTouchedAiRef = useRef(false);
  useEffect(() => {
    loadDraft().then((d) => {
      draftWritableRef.current=true;
      if (d) {
        setText(d.content || '');
        setImages(d.images || []);
        setSelectedAiIds(d.aiIds || []);
      }
      // ✅ 用 state 而非 ref：触发重渲染，让"默认全选"effect 在草稿判定完成后真正执行
      setDraftState({ checked: true, hadDraft: !!d });
    }).catch(e => {setDraftState({checked:true,hadDraft:true});AppAlert.alert('草稿恢复失败',e.message+'。原草稿已保留，仍可编辑并发布新动态。');});
  }, []);

  // 自动保存草稿
  useEffect(() => {
    if (draftState.checked && draftWritableRef.current && !postingRef.current && !publishedRef.current) {
      const operation = text || images.length ? saveDraft({ content: text, images, imageDescriptions: [], aiIds: selectedAiIds }) : clearDraft();
      operation.catch(e => AppAlert.alert('草稿未保存', e.message));
    }
  }, [text, images, selectedAiIds, draftState.checked]);

  const pickImage = useCallback(async () => {
    if (images.length >= 9) return;
    try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (!result.canceled && result.assets.length > 0) {
      // ✅ 修复(动态配图丢失)：持久化到应用目录，临时缓存 URI 会被系统清理
      const persisted = await persistImageUri(result.assets[0].uri);
      setImages((prev) => prev.length < 9 ? [...prev, persisted] : prev);
    }
    } catch (e) { AppAlert.alert('图片未添加', e instanceof Error ? e.message : '请重试'); }
  }, [images.length]);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // 可选 AI 列表（所有对话）
  const availableAIs = conversations
    .filter(c => !c.type || c.type === 'private')
    .map((c) => ({
      convId: c.id,
      name: c.name || '新对话',
      avatar: c.avatar,
      background: c.settings.background?.trim() || '',
      systemPrompt: c.settings.systemPrompt?.trim() || '',
      // ✅ 结构化记忆（统一上下文包的数据源，不再单独维护旧 memory 字符串）
      memories: (c.memories || []) as any,
      conversationMode: c.settings.conversationMode || 'light',
      pureTextMode: c.settings.pureTextMode,
      advanced: c.settings.advanced,
      // ✅ 传入最近对话 + 全部朋友圈 + 群聊数据，供统一上下文包注入
      dialogMessages: c.messages || [],
      allMoments: allMomentsRef.current,
      allConversations: conversations,
      loadGroupMsgs: groupMsgsLoaderRef.current,
    }));

  // ✅ 修复(用户发朋友圈AI不评论)：仅在"无草稿"时默认全选所有 AI（等 conversations 加载完），
  //    用户直接发布即可收到 AI 评论；有草稿（含 aiIds 被清空的草稿）或用户手动操作后不再干预
  useEffect(() => {
    if (!draftState.checked || draftState.hadDraft || userTouchedAiRef.current) return;
    if (availableAIs.length > 0 && selectedAiIds.length === 0) {
      setSelectedAiIds(availableAIs.map((a) => a.convId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftState, conversations, selectedAiIds]);

  const toggleAi = useCallback((convId: string) => {
    userTouchedAiRef.current = true; // ✅ 用户手动勾选后，不再自动全选
    setSelectedAiIds((prev) =>
      prev.includes(convId) ? prev.filter((id) => id !== convId) : [...prev, convId],
    );
  }, []);

  const selectAll = useCallback(() => {
    userTouchedAiRef.current = true;
    setSelectedAiIds(availableAIs.map((a) => a.convId));
  }, [availableAIs]);

  const clearAll = useCallback(() => {
    userTouchedAiRef.current = true;
    setSelectedAiIds([]);
  }, []);

  const handleCancel = () => {
    if (text || images.length > 0) {
      // ✅ 修复：用应用主题确认弹窗（GlassModal），不再用系统 Alert
      setShowExitConfirm(true);
    } else {
      navigation.goBack();
    }
  };

  const handlePublish = async () => {
    if (!text.trim()) return;
    if (postingRef.current || publishedRef.current || !draftState.checked) return;
    postingRef.current = true; setPosting(true);

    const momentId = generateMomentId();
    const summaryReady=new Set<string>();

    try {
      const previous = await loadMoments();
      let preparationError:unknown;
      for(const id of selectedAiIds)try{await prepareMemoryScope(id,momentDialogForCharacter(previous,id),'moments:'+id);summaryReady.add(id);}catch(e){preparationError=e;}
      if(preparationError)AppAlert.alert('记忆准备未完成，动态仍可发布',preparationError instanceof Error?preparationError.message:'记忆可稍后重试');
      // ✅ 修复(发圈慢)：先立即发布（空评论），图片识别和 AI 评论后台异步生成后再追加
      await addMoment({
        id: momentId,
        content: text.trim(),
        images,
        imageDescriptions: [],
        aiIds: selectedAiIds,
        timestamp: Date.now(),
        comments: [],
      });

      publishedRef.current = true;
      try { if(draftWritableRef.current)await clearDraft(); } catch (e) { AppAlert.alert('动态已发布，草稿未清除', '请勿重复发布。' + (e instanceof Error ? e.message : '')); }
      route.params?.onDone?.();
      navigation.goBack();
    } catch (e: any) {
      // ✅ 修复(发布中卡死)：失败时复位 posting + 提示，保留草稿
      AppAlert.alert('发布未完全完成', e?.message || '请重试');
      return;
    } finally {
      postingRef.current = false; setPosting(false);
    }

    // 后台任务：图片识别 + AI 评论（不阻塞发布，发布秒成）
    (async () => {
      const controller = momentRequestTasks.begin(momentId);
      try {
        const content = text.trim();
        let imageDescriptions: string[] = [];
        if (images.length > 0) {
          try { imageDescriptions = await describeImages(images, controller.signal); } catch {}
        }
        if (controller.signal.aborted) return;
        const descText = imageDescriptions.filter(Boolean).map((d) => `[图片：${d}]`).join(' ');
        const contentForAI = descText ? `${content}\n${descText}` : content;
        let selectedAIs = availableAIs.filter((a) => selectedAiIds.includes(a.convId));
        if (imageDescriptions.length) await updateMoment(momentId, { imageDescriptions });
        let comments: MomentComment[] = [];
        let failure: unknown;
        try { comments = await generateAIMomentsComments(contentForAI, selectedAIs, '用户', [], controller.signal); }
        catch (e) { failure = e; comments = (e as any).comments || []; }
        if (controller.signal.aborted) return;
        for (const c of comments) await addComment(momentId, { ...c, replyToId: momentId });
        const updated = await loadMoments();
        for(const c of comments)if(summaryReady.has(c.aiConvId))void summarizeConversation(c.aiConvId,momentDialogForCharacter(updated,c.aiConvId),'moments:'+c.aiConvId,'moments').catch(e=>AppAlert.alert('记忆总结未完成',e.message||'请稍后重试'));
        if (failure) throw failure;
      } catch (e) { if (!controller.signal.aborted) AppAlert.alert('动态已发布，部分 AI 评论未完成', e instanceof Error ? e.message : '请稍后重试'); }
      finally { momentRequestTasks.end(momentId, controller); }

    })();
  };

  // ✅ 修复：未选任何 AI 也能发布（AI 不评论）；选了 AI 才会生成评论
  const canPost = draftState.checked && text.trim().length > 0 && !posting && !publishedRef.current;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* 导航栏 */}
      <View style={[styles.nav, { paddingTop: insets.top + 8, borderBottomColor: colors.separator }]}>
        <TouchableOpacity onPress={handleCancel} style={styles.navBtn}>
          <Text style={[styles.navText, { color: colors.textSecondary }]}>取消</Text>
        </TouchableOpacity>
        <Text style={[styles.navTitle, { color: navColor }]}>发布</Text>
        <TouchableOpacity
          onPress={handlePublish}
          disabled={!canPost}
          style={[styles.navBtn, canPost && { opacity: 1 }]}>
          <Text style={[styles.publishBtn, { color: canPost ? colors.primary : colors.textTertiary }]}>
            {posting ? '发布中...' : '发布'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* 文字输入 */}
        <TextInput
          style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.separator }]}
          value={text}
          editable={draftState.checked && !posting && !publishedRef.current}
          onChangeText={setText}
          placeholder="分享这一刻的想法..."
          placeholderTextColor={colors.textTertiary}
          maxLength={500}
          multiline
          textAlignVertical="top"
        />
        <Text style={[styles.count, { color: colors.textTertiary }]}>{text.length}/500</Text>

        {/* 图片选择 */}
        <ScrollView horizontal style={styles.imgScroll} contentContainerStyle={{ gap: 8 }}>
          {images.map((uri, i) => (
            <TouchableOpacity key={i} onPress={() => removeImage(i)} style={styles.imgWrapper}>
              <Image source={{ uri }} style={styles.imgThumb} />
              <View style={styles.imgRemove}><Text style={{ color: '#FFF', fontSize: 12 }}>✕</Text></View>
            </TouchableOpacity>
          ))}
          {images.length < 9 && (
            <TouchableOpacity onPress={pickImage} style={[styles.addImg, { backgroundColor: colors.surfaceSecondary, borderColor: colors.separator }]}>
              <Text style={{ fontSize: 28, color: colors.textTertiary }}>+</Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        {/* AI 选择 */}
        <View style={[styles.aiCard, { backgroundColor: colors.surface, borderColor: colors.separator }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
            <Text style={[styles.aiTitle, { color: colors.text }]}>
              谁可看 <Text style={{ color: colors.primary }}>{selectedAiIds.length}/{availableAIs.length} 个AI</Text>
            </Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity onPress={selectAll}><Text style={{ color: colors.primary, fontSize: 13 }}>全选</Text></TouchableOpacity>
              <TouchableOpacity onPress={clearAll}><Text style={{ color: colors.textTertiary, fontSize: 13 }}>清空</Text></TouchableOpacity>
            </View>
          </View>
          {availableAIs.map((ai) => (
            <TouchableOpacity
              key={ai.convId}
              onPress={() => toggleAi(ai.convId)}
              style={[styles.aiRow, { borderTopColor: colors.separator }]}>
              <Text style={[styles.aiCheck, { color: selectedAiIds.includes(ai.convId) ? colors.primary : colors.textTertiary }]}>
                {selectedAiIds.includes(ai.convId) ? '✅' : '○'}
              </Text>
              <Text style={[styles.aiName, { color: colors.text }]}>{ai.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* ✅ 修复：应用主题的退出确认弹窗（不再用系统 Alert） */}
      <GlassModal
        visible={showExitConfirm}
        icon="📝"
        title="保存草稿？"
        message="退出后内容会保存为草稿，下次打开自动恢复。"
        confirmText="保存"
        cancelText="不保存"
        onConfirm={async () => {
          if(!draftWritableRef.current){AppAlert.alert('草稿尚未保存','原草稿仍不可读，未覆盖它。请保留当前页面，或选择不保存这次新编辑。');return;}
          try{await saveDraft({content:text,images,imageDescriptions:[],aiIds:selectedAiIds});setShowExitConfirm(false);navigation.goBack();}
          catch(e){AppAlert.alert('草稿未保存',e instanceof Error?e.message:'请重试');}
        }}
        onCancel={async () => {
          try{if(draftWritableRef.current)await clearDraft();setShowExitConfirm(false);navigation.goBack();}
          catch(e){AppAlert.alert('退出未完成',e instanceof Error?e.message:'草稿未删除，请重试');}
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
  },
  navBtn: { padding: 4 },
  navText: { fontSize: 14 },
  navTitle: { fontSize: 16, fontWeight: '600' },
  publishBtn: { fontSize: 14, fontWeight: '600' },
  body: { flex: 1, padding: 16 },
  input: {
    fontSize: 16,
    lineHeight: 24,
    minHeight: 120,
    padding: 14,
    borderRadius: 12,
    borderWidth: 0.5,
    textAlignVertical: 'top',
  },
  count: { fontSize: 12, textAlign: 'right', marginTop: 6, marginBottom: 16 },
  imgScroll: { marginBottom: 16 },
  imgWrapper: { position: 'relative' },
  imgThumb: { width: 80, height: 80, borderRadius: 8 },
  imgRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addImg: {
    width: 80,
    height: 80,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  aiCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 0.5,
  },
  aiTitle: { fontSize: 15, fontWeight: '500' },
  aiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 0.5,
  },
  aiCheck: { fontSize: 16, marginRight: 10 },
  aiName: { fontSize: 15, fontWeight: '500', marginRight: 8 },
  aiDesc: { fontSize: 12, flex: 1 },
});
