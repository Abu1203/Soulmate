// ============================================================
// AgentSoul - 侧边栏 v2（对话列表 + 角色摘要 + 卡片式底部）
// ============================================================
import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { AppAlert } from '../services/appDialog';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAgentSoul } from '../contexts/AgentSoulContext';
import { useTheme } from '../contexts/ThemeContext';
import GlassModal from '../components/GlassModal';
import * as Clipboard from 'expo-clipboard';

interface AgentSoulSidebarProps {
  onApiKeySettings?: () => void;
  onMoments?: () => void;
  onCloseDrawer?: () => void;
  onGroupChat?: () => void;
  onOpenGroupChat?: (convId: string) => void;
}

export default function AgentSoulSidebar({
  onApiKeySettings,
  onMoments,
  onCloseDrawer,
  onGroupChat,
  onOpenGroupChat,
}: AgentSoulSidebarProps) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const {
    conversations,
    activeConversation,
    createNew,
    selectConversation,
    deleteConversation,
    updateConversation,
    togglePin,
    toggleThinkingMode,
    thinkingMode,
    storageWarning,
    dismissStorageWarning,
    retryPendingSave, loadList,
    storageUncertain,
    inspectHistoryRecovery, recoverHistoryCopies,
  } = useAgentSoul();

  const settings = activeConversation?.settings;
  const rereading=useRef(false);
  const [readingHistory,setReadingHistory]=useState(false);
  const rereadHistory=async()=>{
    if(rereading.current)return;
    rereading.current=true;setReadingHistory(true);
    try{
      await loadList();
      const preview=await inspectHistoryRecovery();
      const copy={text:'复制诊断',onPress:async()=>{await Clipboard.setStringAsync(preview.diagnostic);AppAlert.alert('已复制','诊断仅含读取状态，不含聊天正文、记忆或 API Key。');}};
      if(preview.count)AppAlert.alert('找到历史记录',`找到 ${preview.count} 个历史会话，包含 ${preview.messages} 条私聊消息。确认后另存为带“找回”标记的独立会话，保留当前聊天。旧副本可能包含以前手动删除的内容。`,[{text:'取消',style:'cancel'},copy,{text:'找回记录',onPress:async()=>{const n=await recoverHistoryCopies(preview.token);AppAlert.alert('找回结果',n?`已保存 ${n} 个历史会话，可在侧边栏打开。`:'没有新增记录，请重新读取查看。');}}]);
      else AppAlert.alert('读取检查', '已重新检查原历史库。当前没有找到可确认并独立恢复的旧会话；如果记录仍不见，请复制诊断提供给开发者，勿清除应用数据。',[{text:'关闭',style:'cancel'},copy]);
    }catch(e){AppAlert.alert('读取未完成',e instanceof Error?e.message:'原记录未修改，请重试');}
    finally{rereading.current=false;setReadingHistory(false);}
  };

  const handleDelete = useCallback(
    (id: string, name: string) => {
      setDeleteTarget({ id, name });
      setShowDeleteModal(true);
    },
    [],
  );

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  // 长按操作面板
  const [actionTarget, setActionTarget] = useState<any>(null);
  const [renameText, setRenameText] = useState('');
  const [renameId, setRenameId] = useState<string | null>(null);

  const handleLongPress = (item: any) => setActionTarget(item);

  const handleRenameStart = () => {
    setRenameId(actionTarget.id);
    setRenameText(actionTarget.name);
    setActionTarget(null);
  };

  // 分离置顶和普通对话，按 updatedAt 倒序
  const pinnedConvs = conversations
    .filter((c) => c.isPinned)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const normalConvs = conversations
    .filter((c) => !c.isPinned)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const getSummary = (item: any): string => {
    const sp = item.settings?.systemPrompt;
    if (sp && sp.trim()) return sp.trim().substring(0, 30);
    const lastMsg = item.messages?.slice(-1)?.[0];
    if (lastMsg?.content) return lastMsg.content.substring(0, 30);
    return '新对话';
  };

  const renderItem = useCallback(({ item }: { item: any }) => {
    const isPinned = item._isPinned;
    const isActive = item.id === activeConversation?.id;
    const summary = getSummary(item);
    return (
      <TouchableOpacity
        style={[styles.item, isActive && styles.itemActive, isPinned && styles.itemPinned]}
        onPress={() => {
          // ✅ 群聊直接导航，绕过 AgentSoulChatScreen 竞态窗口
          if (item.type === 'group') {
            onOpenGroupChat?.(item.id);
            return;
          }
          // ✅ 修复(点击无效)：先关 Drawer 再切换对话（避免重渲染竞态），加兜底确保关闭
          try { onCloseDrawer?.(); } catch {}
          selectConversation(item.id);
          setTimeout(() => { try { onCloseDrawer?.(); } catch {} }, 150);
        }}
        onLongPress={() => handleLongPress(item)}
        activeOpacity={0.6}>
        <TouchableOpacity
          onPress={() => togglePin(item.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.starBtn}>
          <Text style={styles.starIcon}>{item.isPinned ? '⭐' : '☆'}</Text>
        </TouchableOpacity>
        <View style={styles.itemContent}>
          <Text style={[styles.itemName, { color: colors.text }, isActive && styles.itemNameActive]} numberOfLines={1}>
            {item.name}{item.recoveredFrom?' · 找回':''}
          </Text>
          <Text style={[styles.itemSummary, { color: colors.textSecondary }]} numberOfLines={1}>
            {summary}
          </Text>
        </View>
        <Text style={[styles.itemTime, { color: colors.textTertiary }]}>{formatTime(item.updatedAt)}</Text>
      </TouchableOpacity>
    );
  }, [activeConversation?.id, togglePin, selectConversation, colors.text, colors.textSecondary, colors.textTertiary, handleLongPress]);

  return (
    <>
      <View style={[styles.container, { paddingTop: insets.top + 20, backgroundColor: colors.background }]}>
      <View style={[styles.brandHeader, { borderBottomColor: colors.separator }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={styles.brandIcon}>✨</Text>
            <Text style={[styles.brandName, { color: colors.text }]}>Soulmate</Text>
          </View>
          <TouchableOpacity
            onPress={async () => {
              try {
                const v = await AsyncStorage.getItem('@soulmate_input_expanded');
                await AsyncStorage.setItem('@soulmate_input_expanded', v === '1' ? '0' : '1');
              } catch {}
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ fontSize: 18, color: colors.textSecondary }}>⇅</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityLabel="关闭侧边栏" onPress={onCloseDrawer} hitSlop={{top:10,bottom:10,left:10,right:10}}>
            <Text style={{fontSize:20,color:colors.textSecondary}}>✕</Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.brandSubtitle, { color: colors.textSecondary }]}>有温度的AI陪伴</Text>
      </View>

      {/* ✅ 存储健康提示：数据损坏/自动恢复时显示，可一键恢复备份 */}
      {storageWarning ? (
        <View style={[styles.warnBanner, { backgroundColor: isDark ? 'rgba(245,166,35,0.15)' : '#FFF7E6', borderColor: isDark ? 'rgba(245,166,35,0.4)' : '#F5A623' }]}>
          <Text style={[styles.warnText, { color: colors.text }]} numberOfLines={2}>⚠️ {storageWarning}</Text>
          <View style={styles.warnBtns}>
            {storageUncertain ? (
              <>
                <TouchableOpacity disabled={readingHistory} onPress={rereadHistory}>
                  <Text style={styles.warnAction}>{readingHistory?'读取中…':'重新读取'}</Text>
                </TouchableOpacity>

              </>
            ) : (
              <TouchableOpacity onPress={async () => { const ok = await retryPendingSave(); if (!ok) AppAlert.alert('保存仍未成功', '请保留当前页面并检查设备存储空间。'); }}>
                <Text style={styles.warnAction}>重试保存</Text>
              </TouchableOpacity>
            )}
            {!storageUncertain ? (
              <TouchableOpacity onPress={dismissStorageWarning} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={[styles.warnAction, { color: colors.textSecondary }]}>知道了</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* 对话列表 */}
      <FlatList
        data={[
          ...pinnedConvs.map((c) => ({ ...c, _isPinned: true })),
          ...(pinnedConvs.length > 0 && normalConvs.length > 0
            ? [{ id: '__divider__', _isDivider: true } as any]
            : []),
          ...normalConvs,
        ]}
        renderItem={({ item }) => {
          if (item._isDivider) {
            return <View style={styles.divider} />;
          }
          return renderItem({ item });
        }}
        keyExtractor={(item) => item.id}
        style={styles.list}
        ListEmptyComponent={
          <Text style={styles.emptyText}>{storageUncertain ? '历史会话暂未能读取，请点击重新读取' : '暂无对话，点击下方新建'}</Text>
        }
      />

      <View style={[styles.footer, { borderTopColor: colors.separator, backgroundColor: colors.surface }]}>
        <TouchableOpacity style={[styles.card, { backgroundColor: colors.surfaceSecondary }]} onPress={()=>{void toggleThinkingMode().catch(e=>AppAlert.alert('思绪设置未保存',e.message||'请重试'));}} activeOpacity={0.7}>
          <Text style={styles.cardIcon}>{thinkingMode === 'auto' ? '☁️' : thinkingMode === 'manual' ? '💤' : '🌫️'}</Text>
          <View style={styles.cardInfo}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>思绪</Text>
            <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>{thinkingMode === 'auto' ? '自动展开' : thinkingMode === 'manual' ? '点击展开' : '已关闭'}</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.card, { backgroundColor: colors.surfaceSecondary }]} onPress={onMoments} activeOpacity={0.7}>
          <Text style={styles.cardIcon}>🌐</Text>
          <View style={styles.cardInfo}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>朋友圈</Text>
            <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>看看AI们在聊什么</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.card, { backgroundColor: colors.surfaceSecondary }]} onPress={onGroupChat} activeOpacity={0.7}>
          <Text style={styles.cardIcon}>👥</Text>
          <View style={styles.cardInfo}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>群聊</Text>
            <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>和多个AI一起聊天</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.card, { backgroundColor: colors.surfaceSecondary }]} onPress={() => { onCloseDrawer?.();void createNew().catch(e => AppAlert.alert('新对话未创建', e.message || '请重试')); }} activeOpacity={0.7}>
          <Text style={styles.cardIcon}>💬</Text>
          <View style={styles.cardInfo}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>新建对话</Text>
            <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>开始一段新的陪伴</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.card, { backgroundColor: colors.surfaceSecondary }]} onPress={onApiKeySettings} activeOpacity={0.7}>
          <Text style={styles.cardIcon}>⚙️</Text>
          <View style={styles.cardInfo}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>设置API Key</Text>
            <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>配置 DeepSeek 连接</Text>
          </View>
        </TouchableOpacity>
      </View>
      </View>

    {/* 删除确认弹窗 */}
    <GlassModal
      visible={showDeleteModal}
      icon="🌸"
      title="要告别这段对话吗？"
      message="它会安静地消失，但回忆会留在你心里"
      confirmText="轻轻放手"
      cancelText="让我再想想"
      onConfirm={() => { if (deleteTarget) void deleteConversation(deleteTarget.id).then(() => setShowDeleteModal(false)).catch(e => AppAlert.alert('对话未删除', e.message || '请重试')); }}
      onCancel={() => setShowDeleteModal(false)}
    />

    {/* 长按操作面板 */}
    <Modal visible={!!actionTarget} transparent animationType="fade" onRequestClose={() => setActionTarget(null)}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setActionTarget(null)}>
        <View style={[styles.actionSheet, { backgroundColor: colors.surface }]}>
          <Text style={[styles.actionTitle, { color: colors.text }]}>{actionTarget?.name}</Text>
          <TouchableOpacity style={[styles.actionBtn, { borderTopColor: colors.separator }]} onPress={() => { togglePin(actionTarget.id); setActionTarget(null); }}>
            <Text style={[styles.actionText, { color: colors.text }]}>{actionTarget?.isPinned ? '💛 取消珍藏' : '⭐ 珍藏这段对话'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, { borderTopColor: colors.separator }]} onPress={handleRenameStart}>
            <Text style={[styles.actionText, { color: colors.text }]}>✎ 重命名</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.actionDel, { borderTopColor: colors.separator }]} onPress={() => { handleDelete(actionTarget.id, actionTarget.name); setActionTarget(null); }}>
            <Text style={[styles.actionText, styles.actionDelText]}>🌸 轻轻离开</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setActionTarget(null)}>
            <Text style={styles.cancelText}>取消</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>

    {/* 重命名对话框 */}
    <Modal visible={!!renameId} transparent animationType="fade" onRequestClose={() => setRenameId(null)}>
      <KeyboardAvoidingView behavior="padding" style={styles.overlay}>
        <View style={[styles.renameModal, { backgroundColor: colors.surface }]}>
          <Text style={[styles.renameTitle, { color: colors.text }]}>重命名对话</Text>
          <TextInput style={[styles.renameInput, { backgroundColor: isDark ? 'rgba(42,42,42,0.6)' : 'rgba(255,255,255,0.7)', color: colors.text, borderColor: colors.separator }]} value={renameText} onChangeText={setRenameText} autoFocus placeholder="输入新名称" placeholderTextColor={colors.textTertiary} />
          <View style={styles.renameBtns}>
            <TouchableOpacity style={styles.renameBtn} onPress={() => setRenameId(null)}>
              <Text style={styles.renameBtnText}>取消</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.renameBtn, styles.renameConfirm]} onPress={async () => {
              try {
                if (renameId && renameText.trim()) await updateConversation(renameId, { name: renameText.trim() });
                setRenameId(null);
              } catch (e) { AppAlert.alert('重命名未保存', e instanceof Error ? e.message : '请重试'); }
            }}>
              <Text style={[styles.renameBtnText, { color: '#FFF' }]}>确定</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
    </>
  );
}

function formatTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  const d = new Date(timestamp);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  brandHeader: {
    paddingHorizontal: 20, paddingBottom: 16,
    borderBottomWidth: 0.5, borderBottomColor: '#E8E8ED',
  },
  brandIcon: { fontSize: 22, marginBottom: 4 },
  brandName: { fontSize: 20, fontWeight: '700', color: '#1A1A1A' },
  brandSubtitle: { fontSize: 13, color: '#888', marginTop: 2 },
  list: { flex: 1 },
  emptyText: { textAlign: 'center', color: '#999', marginTop: 40, fontSize: 14 },
  item: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    marginHorizontal: 8, marginVertical: 2, borderRadius: 10,
  },
  itemActive: { backgroundColor: '#EBF3FC' },
  itemPinned: { borderLeftWidth: 3, borderLeftColor: '#F5A623' },
  starBtn: { paddingRight: 8 },
  starIcon: { fontSize: 16, color: '#F5A623' },
  itemContent: { flex: 1 },
  itemName: { fontSize: 15, fontWeight: '600', color: '#1A1A1A' },
  itemNameActive: { color: '#4A90D9' },
  itemSummary: { fontSize: 12, color: '#888', marginTop: 2 },
  itemTime: { fontSize: 11, color: '#BBB', marginLeft: 6 },
  divider: {
    height: 1, backgroundColor: '#E8E8ED',
    marginHorizontal: 16, marginVertical: 4,
  },
  warnBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 8, marginVertical: 4, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1, gap: 8,
  },
  warnText: { flex: 1, fontSize: 12, lineHeight: 16 },
  warnBtns: { flexDirection: 'row', gap: 10 },
  warnAction: { fontSize: 13, color: '#E8A020', fontWeight: '600' },
  footer: {
    borderTopWidth: 0.5, borderTopColor: '#E8E8ED',
    paddingVertical: 8, paddingHorizontal: 12,
    backgroundColor: '#FFFFFF', gap: 6,
  },
  card: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 12,
    borderRadius: 12, backgroundColor: '#F8F9FA',
  },
  cardIcon: { fontSize: 20, marginRight: 10 },
  cardInfo: { flex: 1 },
  cardTitle: { fontSize: 14, fontWeight: '500', color: '#333' },
  cardDesc: { fontSize: 12, color: '#888', marginTop: 2 },
  toggleIndicator: { fontSize: 16, color: '#4A90D9', fontWeight: '600' },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.3)' },
  actionSheet: { backgroundColor: '#FFF', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20 },
  actionTitle: { fontSize: 16, fontWeight: '600', textAlign: 'center', marginBottom: 12, color: '#333' },
  actionBtn: { paddingVertical: 14, borderTopWidth: 0.5, borderTopColor: '#EEE' },
  actionText: { fontSize: 15, color: '#333', textAlign: 'center' },
  actionDel: {},
  actionDelText: { color: '#E06060' },
  cancelBtn: { marginTop: 8, paddingVertical: 12, alignItems: 'center' },
  cancelText: { fontSize: 14, color: '#999' },
  renameModal: { backgroundColor: '#FFF', margin: 40, borderRadius: 12, padding: 20 },
  renameTitle: { fontSize: 17, fontWeight: '600', marginBottom: 12, textAlign: 'center' },
  renameInput: { borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 8, padding: 10, fontSize: 15, marginBottom: 16 },
  renameBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  renameBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, backgroundColor: '#F0F0F5' },
  renameBtnText: { fontSize: 14, color: '#333' },
  renameConfirm: { backgroundColor: '#4A90D9' },
});
