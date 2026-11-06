// ============================================================
// Soulmate v2 — 朋友圈 Feed 页（完整交互版）
// ============================================================
import React, { useCallback, useEffect, useState, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Image, Modal,
  StyleSheet, Dimensions, TextInput,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import AgentSoulSlider from '../components/AgentSoulSlider';
import GlassModal from '../components/GlassModal';
import Toast from '../components/Toast';
import type { Moment, MomentComment } from '../types/moments';
import { generateMomentId } from '../types/moments';
import { loadMoments, saveMoments, addComment, removeMoment } from '../services/momentsStorage';
import { persistImageUri } from '../services/imageStore';
import { generateAIReply } from '../services/momentsAI';
import { canSeeMoment } from '../services/visibility';
import { momentRequestTasks } from '../services/requestTask';
import { momentDialogForCharacter } from '../services/momentsContext';
import { createGroupMsgsLoader } from '../services/contextBundle';

const { width: SW } = Dimensions.get('window');
const PROFILE_KEY = '@soulmate_profile';

interface UserProfile { avatar: string; nickname: string; bgOpacity: number; bgImage: string; }

import { useAgentSoul } from '../contexts/AgentSoulContext';

export default function MomentsFeedScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { colors, isDark, customTheme } = useTheme();
  const { conversations, prepareMemoryScope, summarizeConversation,deleteMomentAndMemories } = useAgentSoul();
  const isEmotion = customTheme === 'emotion';

  const [moments, setMoments] = useState<Moment[]>([]);
  const [profile, setProfile] = useState<UserProfile>({ avatar: '', nickname: '我', bgOpacity: 10, bgImage: '' });
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [showBgModal, setShowBgModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const showToast = (msg: string) => { setToastMsg(msg); setToastVisible(true); };
  const [tempNickname, setTempNickname] = useState('');
  const [tempBgOpacity, setTempBgOpacity] = useState(10);
  // 评论区
  const [commentTarget, setCommentTarget] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [replyTo, setReplyTo] = useState<{ name: string; id: string; convId?: string; aiBg?: string; aiSystemPrompt?: string; parentContent?: string } | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(PROFILE_KEY).then((v) => {
      if (v) {
        const p = JSON.parse(v) as UserProfile;
        if (!p || typeof p.avatar !== 'string' || typeof p.nickname !== 'string' || typeof p.bgImage !== 'string' || !Number.isFinite(p.bgOpacity)) throw new Error('个人资料格式异常');
        profileRef.current = p; setProfile(p);
        if (p.bgImage) setBgImage(p.bgImage);
      }
      profileReadyRef.current = true;
    }).catch(() => showToast('个人资料读取失败，已保留原数据'));
    refresh();
    // ✅ 修复：返回 Feed 时刷新，后台追加的 AI 评论能陆续出现
    const unsub = navigation.addListener('focus', refresh);
    return unsub;
  }, []);

  const profileRef = useRef(profile);
  const profileReadyRef = useRef(false);
  const profileQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const saveProfile = (patch: Partial<UserProfile>): Promise<boolean> => {
    const operation = profileQueueRef.current.then(async () => {
      if (!profileReadyRef.current) throw new Error('个人资料尚未读取成功，原数据未覆盖');
      const next = { ...profileRef.current, ...patch };
      await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(next));
      profileRef.current = next; setProfile(next); setBgImage(next.bgImage || null); return true;
    }).catch(e => { showToast(e instanceof Error ? e.message : '个人资料保存失败'); return false; });
    profileQueueRef.current = operation; return operation;
  };

  const refresh = useCallback(async () => {
    let all: Moment[];
    try { all = await loadMoments(); } catch (e) { showToast(e instanceof Error ? e.message : '朋友圈读取失败'); return; }
    // ✅ 优化：数据无变化时不触发 setState（轮询每 3s 调用，避免无谓重渲染）
    setMoments((prev) => {
      if (prev.length === all.length && JSON.stringify(prev) === JSON.stringify(all)) return prev;
      return all;
    });
  }, []);

  // ✅ 修复(用户发朋友圈AI不评论的观感)：AI 评论是发布后后台逐条生成的
  //    （每个 AI 一次 API 调用，最长 30s/个），Feed 页 focus 期间每 3s 轻量轮询刷新，
  //    让陆续生成的 AI 评论自动出现，无需退出重进
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => { refresh(); }, 3000);
    };
    const stop = () => {
      if (timer) { clearInterval(timer); timer = null; }
    };
    const focusUnsub = navigation.addListener('focus', start);
    const blurUnsub = navigation.addListener('blur', stop);
    start();
    return () => { stop(); focusUnsub(); blurUnsub(); };
  }, [navigation, refresh]);

  const glassNavBg = isEmotion ? 'rgba(20,20,20,0.55)' : 'rgba(255,255,255,0.55)';
  const glassCardBg = isEmotion ? 'rgba(20,20,20,0.45)' : 'rgba(255,255,255,0.65)';
  const glassCardBorder = isEmotion ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const navColor = isDark || isEmotion ? '#FFFFFF' : '#1A1A1A';

  const handlePickAvatar = async () => {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: true, aspect: [1, 1] });
      if (!r.canceled && r.assets.length > 0) {
        // ✅ 修复(头像丢失)：持久化到应用目录后再保存，临时缓存 URI 会被系统清理
        await saveProfile({ avatar: await persistImageUri(r.assets[0].uri, 'profile_avatar') });
      }
    } catch (e) { showToast(e instanceof Error ? e.message : '图片加载失败'); }
  };
  const handlePickBg = async () => {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!r.canceled && r.assets.length > 0) {
        const persisted = await persistImageUri(r.assets[0].uri, 'profile_bg');
        await saveProfile({ bgImage: persisted });
      }
    } catch (e) { showToast(e instanceof Error ? e.message : '图片加载失败'); }
  };

  const confirmDeleteMoment = async () => {
    if (!deleteTargetId) return;
    // ✅ 修复(竞态)：原子删除，避免与并发写入互吞
    try { await deleteMomentAndMemories(deleteTargetId); } catch (e) { showToast(e instanceof Error ? e.message : '删除失败'); return; }
    const all = await loadMoments();
    setMoments(all);
    setShowDeleteModal(false);
    setDeleteTargetId(null);
  };

  const openComment = (momentId: string, reply?: { name: string; id: string; convId?: string; aiBg?: string; aiSystemPrompt?: string; parentContent?: string }) => {
    setCommentTarget(momentId);
    setReplyTo(reply || null);
    setCommentText('');
  };

  const submitComment = async () => {
    // ✅ 修复：replyTo 存在但正文为空时，禁止提交空 @评论
    if (!commentTarget || !commentText.trim()) return;
    const taskId = commentTarget; let controller: AbortController;
    try { controller = momentRequestTasks.begin(taskId); } catch { showToast('这条动态的 AI 回复仍在生成，请稍候'); return; }
    try {
    const content = replyTo ? `@${replyTo.name} ${commentText.trim()}` : commentText.trim();
    if (!content) return;
    const comment: MomentComment = {
      id: generateMomentId(),
      aiConvId: '__user__',
      aiName: profile.nickname,
      content,
      timestamp: Date.now(),
    };
    const before = await loadMoments().catch(() => null);
    if (!before) { showToast('历史动态不可读，评论尚未提交'); return; }
    const targetMoment = before.find(m => m.id === commentTarget);
    const targetId = replyTo?.convId || targetMoment?.authorConvId;
    let summaryReady=true;
    if (targetId && targetId !== '__user__') {
      try { await prepareMemoryScope(targetId, momentDialogForCharacter(before, targetId), 'moments:' + targetId); } catch (e) { summaryReady=false;showToast('记忆准备未完成，评论仍可发送：'+(e instanceof Error ? e.message : '请重试')); }
    }
    // ✅ 修复(竞态)：原子追加评论（队列内 read-modify-write），再重读更新 UI
    try { await addComment(commentTarget, comment); } catch (e) { showToast(e instanceof Error ? e.message : '评论未保存'); return; }
    setCommentTarget(null);
    setCommentText('');
    setReplyTo(null);
    const all = await loadMoments();
    setMoments(all);

    // ✅ 修复(AI发朋友圈不回复)：确定 AI 回复目标
    //   1) 用户回复了某条 AI 的评论 → 该 AI 回复（原有逻辑）
    //   2) 用户直接评论 AI 发的动态（replyTo 为空）→ 动态作者 AI 回复（新增）
    const moment = all.find((m) => m.id === commentTarget);
    const authorConvId = moment?.authorConvId;
    const aiTarget: {
      name: string;
      convId: string;
      aiBg: string;
      aiSystemPrompt: string;
      parentContent?: string;
      viaReply: boolean;
    } | null = (replyTo && replyTo.convId && replyTo.convId !== '__user__')
      ? {
          name: replyTo.name,
          convId: replyTo.convId,
          aiBg: replyTo.aiBg || '',
          aiSystemPrompt: replyTo.aiSystemPrompt || '',
          parentContent: replyTo.parentContent,
          viaReply: true,
        }
      : (!replyTo && authorConvId
          ? {
              name: moment?.aiName || 'AI',
              convId: authorConvId,
              aiBg: '',
              aiSystemPrompt: '',
              viaReply: false,
            }
          : null);

    if (aiTarget) {
      const conv = conversations.find((c) => c.id === aiTarget.convId);
      if (!conv || !moment || !canSeeMoment(moment, conv.id)) { showToast('该角色无权查看此动态，未发送 AI 请求'); return; }
      // AI 再回复（支持多轮对话循环）
      const systemPrompt = conv.settings.systemPrompt || '';
      const aiBackground = conv.settings.background || '';
      await generateAIReply(
        conv.name,
        aiBackground,
        commentText.trim(),
        undefined,
        systemPrompt,
        aiTarget.parentContent,  // ✅ 传递父评论内容，AI 知道自己在回复什么
        // ✅ 统一上下文：记忆 + 最近对话 + 全部朋友圈 + 群聊互动
        { memories: (conv?.memories || []) as any, dialogMessages: conv?.messages || [], allMoments: all, aiConvId: aiTarget.convId, allConversations: conversations, advanced: conv.settings.advanced, conversationMode: conv.settings.conversationMode, pureTextMode: conv.settings.pureTextMode, momentContent: moment.content, signal: controller.signal, loadGroupMsgs: createGroupMsgsLoader() },
      ).then(async replyContent => {
        if (controller.signal.aborted) return;
        // ✅ 修复(竞态)：AI 再回复用原子 addComment，再重读更新 UI
        await addComment(commentTarget, {
          id: generateMomentId(),
          aiConvId: aiTarget.convId,
          aiName: aiTarget.name,
          content: replyContent,
          replyToId: comment.id,
          timestamp: Date.now(),
        }).then(() => {
          return loadMoments();
        }).then(updated => {
          setMoments(updated);
          if(summaryReady)void summarizeConversation(aiTarget.convId, momentDialogForCharacter(updated, aiTarget.convId), 'moments:' + aiTarget.convId, 'moments').catch(e=>showToast(e.message||'记忆总结未完成'));
          showToast(`${aiTarget.name}回复了你的评论`);
        }).catch(e => showToast(e.message || 'AI 评论未保存'));
      }).catch((e) => { if (!controller.signal.aborted) showToast(e.message || 'AI 回复失败，请稍后重试'); });
    }
    } catch (e) { if (!controller.signal.aborted) showToast(e instanceof Error ? e.message : '评论未完成'); }
    finally { momentRequestTasks.end(taskId, controller); }
  };

  const formatTime = (ts: number) => {
    const diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
    return `${Math.floor(diff / 86400000)}天前`;
  };

  const renderImages = (images: string[], cardWidth: number) => {
    if (!images.length) return null;
    const gap = 4;
    const contentWidth = cardWidth - 28; // card padding 14×2
    const imgW = Math.floor((contentWidth - gap * 2) / 3);
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: gap }}>
        {images.slice(0, 9).map((uri, i) => (
          <Image key={i} source={{ uri }} style={{ width: imgW, height: imgW, borderRadius: 6 }} resizeMode="cover" />
        ))}
      </View>
    );
  };

  const renderMoment = useCallback(({ item }: { item: Moment }) => {
    const cardWidth = SW - 32;
    return (
      <View style={[styles.card, { backgroundColor: glassCardBg, borderColor: glassCardBorder }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          {item.aiName ? (
            item.aiAvatar ? (
              <Image source={{ uri: item.aiAvatar }} style={styles.userAvatar} />
            ) : (
              <View style={[styles.userAvatar, { backgroundColor: colors.primary }]}>
                <Text style={{ color: '#FFF', fontSize: 16 }}>{item.aiName[0]}</Text>
              </View>
            )
          ) : profile.avatar ? (
            <Image source={{ uri: profile.avatar }} style={styles.userAvatar} />
          ) : (
            <View style={[styles.userAvatar, { backgroundColor: colors.primary }]}>
              <Text style={{ color: '#FFF', fontSize: 16 }}>我</Text>
            </View>
          )}
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={[styles.userName, { color: colors.text }]}>{item.aiName || profile.nickname}</Text>
            <Text style={[styles.time, { color: colors.textTertiary }]}>{formatTime(item.timestamp)}</Text>
          </View>
          <TouchableOpacity onPress={() => { setDeleteTargetId(item.id); setShowDeleteModal(true); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ fontSize: 16, color: colors.textTertiary }}>🗑</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.content, { color: colors.text }]}>{item.content}</Text>
        {renderImages(item.images, cardWidth)}

        {/* 右下角评论按钮 — 评论区上方 */}
        <TouchableOpacity onPress={() => openComment(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ alignSelf: 'flex-end', marginTop: 8 }}>
          <Text style={{ fontSize: 18, color: colors.textTertiary }}>···</Text>
        </TouchableOpacity>

        {item.comments.length > 0 && (
          <View style={[styles.commentSection, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8F8F8' }]}>
            {item.comments.map((c) => (
              <TouchableOpacity key={c.id} onPress={() => openComment(item.id, { name: c.aiName, id: c.id, convId: c.aiConvId, aiBg: c.aiBackground, aiSystemPrompt: c.aiSystemPrompt, parentContent: c.content })} activeOpacity={0.6}>
                <View style={styles.commentRow}>
                  <Text style={[styles.commentName, { color: c.aiConvId === '__user__' ? colors.primary : colors.text }]}>
                    {c.aiName}
                  </Text>
                  <Text style={[styles.commentText, { color: colors.textSecondary }]}>：{c.content}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

      </View>
    );
  }, [colors, isDark, profile]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {bgImage && (
        <Image source={{ uri: bgImage }} style={[StyleSheet.absoluteFill, { opacity: (profile.bgOpacity || 10) / 100 }]} />
      )}

      <View style={[styles.nav, { paddingTop: insets.top + 8, backgroundColor: glassNavBg, borderBottomColor: glassCardBorder }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.navBtn}>
          <Text style={[styles.navBack, { color: navColor }]}>◀ 返回</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setShowProfileModal(true); setTempNickname(profile.nickname); }}>
          <Text style={[styles.navTitle, { color: navColor }]}>{profile.nickname}</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity onPress={() => { setTempBgOpacity(profile.bgOpacity); setShowBgModal(true); }} style={styles.navBtn}>
            <Text style={[styles.navPublish, { color: navColor }]}>💭背景</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('MomentsPublish', { onDone: refresh })} style={styles.navBtn}>
            <Text style={[styles.navPublish, { color: colors.primary }]}>🗯发布</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={moments}
        renderItem={renderMoment}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🌐</Text>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>还没有动态</Text>
            <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>发布第一条，让 AI 们来评论吧</Text>
          </View>
        }
      />

      {/* 评论输入弹窗 */}
      <Modal visible={!!commentTarget} transparent animationType="fade" onRequestClose={() => setCommentTarget(null)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setCommentTarget(null)}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {replyTo ? '回复评论' : '评论'}
            </Text>
            {replyTo && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <View style={[styles.replyTag, { backgroundColor: colors.surfaceSecondary }]}>
                  <Text style={[styles.replyTagText, { color: colors.textTertiary }]}>@{replyTo.name}</Text>
                </View>
                <TouchableOpacity onPress={() => { setReplyTo(null); setCommentText(''); }}>
                  <Text style={{ color: colors.textTertiary, fontSize: 18, marginLeft: 6 }}>✕</Text>
                </TouchableOpacity>
              </View>
            )}
            <TextInput
              style={[styles.commentInput, { color: colors.text, borderColor: colors.separator, backgroundColor: colors.surfaceSecondary }]}
              value={commentText}
              onChangeText={setCommentText}
              placeholder={replyTo ? '输入回复...' : '说点什么...'}
              placeholderTextColor={colors.textTertiary}
              autoFocus
              multiline
              maxLength={200}
            />
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.surfaceSecondary }]} onPress={() => setCommentTarget(null)}>
                <Text style={{ color: colors.text }}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.primary }]} onPress={submitComment}>
                <Text style={{ color: '#FFF', fontWeight: '600' }}>发送</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 背景设置弹窗 */}
      <Modal visible={showBgModal} transparent animationType="fade" onRequestClose={() => setShowBgModal(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowBgModal(false)}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>背景设置</Text>
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.primary }]} onPress={handlePickBg}>
                <Text style={{ color: '#FFF', fontWeight: '600' }}>上传</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.surfaceSecondary }]} onPress={() => setShowBgModal(false)}>
                <Text style={{ color: colors.text }}>取消</Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.sliderLabel, { color: colors.textSecondary }]}>透明度</Text>
            <AgentSoulSlider label="" leftLabel="透明" rightLabel="浓" value={tempBgOpacity} onValueChange={setTempBgOpacity} minimumValue={5} maximumValue={80} />
            <TouchableOpacity style={{ backgroundColor: colors.primary, paddingVertical: 12, borderRadius: 10, alignItems: 'center', paddingHorizontal: 40, alignSelf: 'center', marginTop: 12 }} onPress={async () => {
              if (!await saveProfile({ bgOpacity: tempBgOpacity })) return;
              setShowBgModal(false);
              showToast('背景已保存');
            }}>
              <Text style={{ color: '#FFF', fontWeight: '600', fontSize: 15 }}>确定</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 头像昵称编辑弹窗 */}
      <Modal visible={showProfileModal} transparent animationType="fade" onRequestClose={() => setShowProfileModal(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowProfileModal(false)}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>编辑个人信息</Text>
            <TouchableOpacity onPress={handlePickAvatar} style={{ alignSelf: 'center', marginBottom: 14 }}>
              {profile.avatar ? (
                <Image source={{ uri: profile.avatar }} style={{ width: 64, height: 64, borderRadius: 32 }} />
              ) : (
                <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: '#FFF', fontSize: 24 }}>我</Text>
                </View>
              )}
            </TouchableOpacity>
            <TextInput
              style={[styles.nickInput, { color: colors.text, borderColor: colors.separator, backgroundColor: colors.surfaceSecondary }]}
              value={tempNickname}
              onChangeText={setTempNickname}
              placeholder="昵称"
              placeholderTextColor={colors.textTertiary}
              maxLength={12}
            />
            <TouchableOpacity style={{ backgroundColor: colors.primary, paddingVertical: 12, borderRadius: 10, alignItems: 'center', paddingHorizontal: 40, alignSelf: 'center', marginTop: 12 }} onPress={async () => {
              if (!await saveProfile({ nickname: tempNickname.trim() || '我' })) return;
              setShowProfileModal(false);
              showToast('信息已保存');
            }}>
              <Text style={{ color: '#FFF', fontWeight: '600', fontSize: 15 }}>保存</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 删除确认弹窗 */}
      <GlassModal
        visible={showDeleteModal}
        icon="🗑"
        title="删除动态"
        message="确定要删除这条动态吗？"
        confirmText="确定"
        cancelText="取消"
        onConfirm={confirmDeleteMoment}
        onCancel={() => { setShowDeleteModal(false); setDeleteTargetId(null); }}
      />
      <Toast visible={toastVisible} message={toastMsg} type="info" onDismiss={() => setToastVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 0.5 },
  navBtn: { padding: 4 },
  navBack: { fontSize: 14, fontWeight: '500' },
  navTitle: { fontSize: 18, fontWeight: '600' },
  navPublish: { fontSize: 14, fontWeight: '500' },
  card: { marginBottom: 12, padding: 14, borderRadius: 12, borderWidth: 0.5 },
  userAvatar: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  userName: { fontSize: 14, fontWeight: '600' },
  time: { fontSize: 12, marginTop: 1 },
  content: { fontSize: 15, lineHeight: 22 },
  commentSection: { marginTop: 10, padding: 10, borderRadius: 8 },
  commentRow: { flexDirection: 'row', marginBottom: 4, flexWrap: 'wrap' },
  commentName: { fontSize: 14, fontWeight: '500', minWidth: 50 },
  commentText: { fontSize: 14, flexShrink: 1 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '500' },
  emptyHint: { fontSize: 13, marginTop: 6 },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalCard: { width: SW * 0.8, borderRadius: 16, padding: 20 },
  modalTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center', marginBottom: 12 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  sliderLabel: { fontSize: 13, marginBottom: 6 },
  nickInput: { borderWidth: 1, borderRadius: 10, padding: 10, fontSize: 15, textAlign: 'center' },
  commentInput: { borderWidth: 1, borderRadius: 10, padding: 10, fontSize: 15, minHeight: 60, textAlignVertical: 'top' },
  replyTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  replyTagText: { fontSize: 13, fontWeight: '500' },
});
