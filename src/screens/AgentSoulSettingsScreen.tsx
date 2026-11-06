// ============================================================
// AgentSoul - 对话设置页面
// 修改：名称、系统提示、温度、TopP、背景图、头像
// ============================================================
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  StyleSheet,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { DrawerActions } from '@react-navigation/native';
import { useAgentSoul } from '../contexts/AgentSoulContext';
import { useTheme } from '../contexts/ThemeContext';
import AgentSoulSlider from '../components/AgentSoulSlider';
import AgentSoulBackgroundPicker from '../components/AgentSoulBackgroundPicker';
import MemoryRecallSettings from '../components/MemoryRecallSettings';
import Toast, { ToastType } from '../components/Toast';
import { DEFAULT_ADVANCED } from '../types/settings';
import type { AdvancedSettings } from '../types/settings';
import { persistImageUri } from '../services/imageStore';
import { extractDocxText } from '../services/docxParser';
import { ROLE_TEXT_CHAR_LIMIT } from '../services/roleBudget';
import { File } from 'expo-file-system';

export default function AgentSoulSettingsScreen({ navigation, route }: any) {
  const { activeConversation, updateConversation, createNew, conversations, selectConversation } = useAgentSoul();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const routeConvId = route.params?.convId;
  // ✅ 修复：routeConvId 找不到时不再静默回退 activeConversation（避免改错对象）
  const targetConv = routeConvId
    ? conversations.find(c => c.id === routeConvId) || null
    : activeConversation;
  // routeConvId 指定但找不到 → 提示并返回（冷启动竞态等场景）
  const [targetMissing, setTargetMissing] = useState(false);
  useEffect(() => {
    setTargetMissing(!!routeConvId && !targetConv);
  }, [routeConvId, targetConv]);

  const [name, setName] = useState(targetConv?.name || '新对话');
  const [systemPrompt, setSystemPrompt] = useState(
    targetConv?.settings?.systemPrompt || '',
  );
  const [temperature, setTemperature] = useState(
    targetConv?.settings?.temperature ?? 0.7,
  );
  const [topP, setTopP] = useState(targetConv?.settings?.topP ?? 0.9);
  const [avatar, setAvatar] = useState(targetConv?.avatar);
  const [userAvatar, setUserAvatar] = useState(targetConv?.userAvatar);
  const [backgroundImage, setBackgroundImage] = useState(
    targetConv?.backgroundImage,
  );
  const [background, setBackground] = useState(
    targetConv?.settings?.background || '',
  );
  const [pureTextMode, setPureTextMode] = useState(
    targetConv?.settings?.pureTextMode ?? false,
  );
  const [conversationMode, setConversationMode] = useState<'light' | 'advanced'>(
    targetConv?.settings?.conversationMode ?? 'light',
  );
  const [splitMessages, setSplitMessages] = useState(
    targetConv?.settings?.splitMessages ?? false,
  );
  const [advanced, setAdvanced] = useState<AdvancedSettings>(
    { ...DEFAULT_ADVANCED, ...targetConv?.settings?.advanced },
  );
  const [memoryRecall, setMemoryRecall] = useState(targetConv?.settings.memoryRecall || { enabled: true, interval: 10 });
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [toastType, setToastType] = useState<ToastType>('info');
  const showToast = (msg: string, type: ToastType = 'info') => { setToastMsg(msg); setToastType(type); setToastVisible(true); };

  // 聚焦时加载（首次挂载 + 从其他页面返回）
  const loadedTargetRef = useRef<string | null>(null);
  useEffect(() => {
    const load = () => {
      if (targetConv) {
        setName(targetConv.name);
        setSystemPrompt(targetConv.settings?.systemPrompt || '');
        setTemperature(targetConv.settings?.temperature ?? 0.7);
        setTopP(targetConv.settings?.topP ?? 0.9);
        setAvatar(targetConv.avatar);
        setUserAvatar(targetConv.userAvatar);
        setBackgroundImage(targetConv.backgroundImage);
        setBackground(targetConv.settings?.background || '');
        setPureTextMode(targetConv.settings?.pureTextMode ?? false);
        setConversationMode(targetConv.settings?.conversationMode ?? 'light');
        setSplitMessages(targetConv.settings?.splitMessages ?? false);
        setAdvanced({ ...DEFAULT_ADVANCED, ...targetConv.settings?.advanced });
        setMemoryRecall(targetConv.settings?.memoryRecall || { enabled: true, interval: 10 });
      }
    };
    if (targetConv && loadedTargetRef.current !== targetConv.id) { load(); loadedTargetRef.current = targetConv.id; }
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, targetConv]);

  // ✅ 人设修改确认 — 检测角色设定是否被修改
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const originalPrompt = targetConv?.settings?.systemPrompt || '';

  const reaction = { title: '更新角色设定？', text: '新设定会用于之后的交流。历史聊天与已保存记忆将保留，记忆可在下方单独编辑。', cancel: '继续编辑', confirm: '保存设定' };

  const savingRef = useRef(false);
  const mountedRef=useRef(true),returnTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>()=>{mountedRef.current=false;if(returnTimerRef.current)clearTimeout(returnTimerRef.current);},[]);
  const doSave = async (cid: string) => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const isGroup = targetConv?.type === 'group';
      // ✅ 修复(群聊保存清空设定)：群聊类型不写入人设/模式字段（UI 已隐藏这些输入，避免空值覆盖）
      await updateConversation(cid, isGroup ? {
        name: name.trim() || '新对话',
        avatar: avatar || undefined,
        userAvatar: userAvatar || undefined,
        backgroundImage: backgroundImage || undefined,
        settings: { ...targetConv!.settings, pureTextMode, splitMessages },
      } : {
        name: name.trim() || '新对话',
        avatar: avatar || undefined,
        userAvatar: userAvatar || undefined,
        backgroundImage: backgroundImage || undefined,
        settings: { ...targetConv?.settings, systemPrompt: systemPrompt.trim(), background: background.trim(), temperature, topP, pureTextMode, conversationMode, splitMessages, advanced, memoryRecall },
      });
      setShowConfirmModal(false);
      // ✅ 修复：先显示 Toast 再返回（组件卸载后 setState 无效）
      showToast('对话设置已更新', 'success');
      try { navigation.dispatch(DrawerActions.closeDrawer()); } catch {}
      if(returnTimerRef.current)clearTimeout(returnTimerRef.current);
      if(mountedRef.current)returnTimerRef.current=setTimeout(() => {if(mountedRef.current&&navigation.isFocused?.()!==false)navigation.goBack();}, 100);
    } catch (e: any) { showToast(e.message || '保存失败', 'error'); }
    finally { savingRef.current = false; }
  };

  const preparingSaveRef = useRef(false);
  const handleSave = async () => {
    if (preparingSaveRef.current || savingRef.current) return;
    if (systemPrompt.trim() !== originalPrompt.trim() && systemPrompt.trim().length > 0) {
      setShowConfirmModal(true); return;
    }
    await confirmSave();
  };
  const confirmSave = async () => {
    if (preparingSaveRef.current || savingRef.current) return;
    preparingSaveRef.current = true;
    try {
      if (routeConvId && !targetConv) throw new Error('目标对话尚未加载或已删除，请返回重试');
      const cid = targetConv?.id || await createNew();
      if (!cid) throw new Error('请先创建对话');
      await doSave(cid);
    } catch (e: any) { showToast(e.message || '保存失败', 'error'); }
    finally { preparingSaveRef.current = false; }
  };

  const handlePickAvatar = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { showToast('需要相册权限', 'warning'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsEditing: true,
        aspect: [1, 1],
      });
      if (!result.canceled && result.assets?.[0]) {
        // ✅ 修复(头像丢失)：持久化到应用目录后再设置，临时缓存 URI 会被系统清理
        setAvatar(await persistImageUri(result.assets[0].uri));
      }
    } catch (e: any) {
      showToast(e.message || '选择失败', 'error');
    }
  };

  const handlePickUserAvatar = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { showToast('需要相册权限', 'warning'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsEditing: true,
        aspect: [1, 1],
      });
      if (!result.canceled && result.assets?.[0]) {
        // ✅ 修复(头像丢失)：持久化到应用目录后再设置，临时缓存 URI 会被系统清理
        setUserAvatar(await persistImageUri(result.assets[0].uri));
      }
    } catch (e: any) {
      showToast(e.message || '选择失败', 'error');
    }
  };

  // ✅ 功能：上传 Word (.docx) 人设文档，识别文字后追加到角色设定输入框
  const [importingDoc, setImportingDoc] = useState(false);
  const handleImportDocx = async () => {
    try {
      const picked = await File.pickFileAsync({
        mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      });
      if (!picked || picked.canceled || !picked.result) return; // 用户取消
      setImportingDoc(true);
      const text = await extractDocxText(picked.result.uri);
      if (!text.trim()) { showToast('未识别到文字内容', 'warning'); return; }
      // 追加到现有角色设定（用户可继续手动编辑）
      setSystemPrompt((prev) => {
        const base = (prev || '').trim();
        return base ? `${base}\n\n【从Word文档导入】\n${text}` : text;
      });
      showToast(`已从 Word 导入 ${text.length} 字`, 'success');
    } catch (e: any) {
      showToast(e?.message || '导入失败，请确认文件是 .docx 格式', 'error');
    } finally {
      setImportingDoc(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      {targetMissing ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>🤔</Text>
          <Text style={{ color: colors.text, fontSize: 16, textAlign: 'center', marginBottom: 16 }}>
            没有找到这个对话，可能已被删除。
          </Text>
          <TouchableOpacity
            onPress={() => { try { navigation.dispatch(DrawerActions.closeDrawer()); } catch {} navigation.goBack(); }}
            style={{ paddingHorizontal: 32, paddingVertical: 12, borderRadius: 20, backgroundColor: colors.primary }}>
            <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '600' }}>返回</Text>
          </TouchableOpacity>
        </View>
      ) : (
      <>
      <View style={[styles.nav, { borderBottomColor: colors.separator }]}>
        <TouchableOpacity onPress={() => {
          try { navigation.dispatch(DrawerActions.closeDrawer()); } catch {}
          navigation.goBack();
        }} style={styles.navBtn}>
          <Text style={[styles.navBtnText, { color: colors.primary }]}>← 返回</Text>
        </TouchableOpacity>
        <Text style={[styles.navTitle, { color: colors.text }]}>对话设置</Text>
        <View style={styles.navBtn} />
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {/* 头像 */}
        <View style={styles.avatarSection}>
          <TouchableOpacity onPress={handlePickAvatar} activeOpacity={0.7}>
            {avatar ? (
              <Image source={{ uri: avatar }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.defaultAvatar]}>
                <Text style={styles.avatarText}>AI</Text>
              </View>
            )}
          </TouchableOpacity>
          <Text style={styles.avatarHint}>点击更换AI头像</Text>
        </View>

        {/* 用户头像 */}
        <View style={styles.avatarSection}>
          <TouchableOpacity onPress={handlePickUserAvatar} activeOpacity={0.7}>
            {userAvatar ? (
              <Image source={{ uri: userAvatar }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.userAvatarPlaceholder]}>
                <Text style={styles.avatarText}>我</Text>
              </View>
            )}
          </TouchableOpacity>
          <Text style={styles.avatarHint}>点击更换我的头像</Text>
        </View>

        {/* 对话名称 */}
        <Text style={[styles.fieldLabel, { color: colors.text }]}>对话名称</Text>
        <TextInput
          style={[styles.input, { backgroundColor: isDark ? 'rgba(42,42,42,0.6)' : 'rgba(255,255,255,0.7)', color: colors.text, borderColor: colors.separator }]}
          value={name}
          onChangeText={setName}
          placeholder="新对话"
          placeholderTextColor={colors.textTertiary}
        />

        {/* 系统提示 — 群聊隐藏 */}
        {targetConv?.type !== 'group' && (<>
        <Text style={[styles.fieldLabel, { color: colors.text }]}>⭐ 角色设定</Text>
        <TextInput
          style={[styles.input, styles.multiline, { backgroundColor: isDark ? 'rgba(42,42,42,0.6)' : 'rgba(255,255,255,0.7)', color: colors.text, borderColor: colors.separator }]}
          value={systemPrompt}
          onChangeText={setSystemPrompt}
          placeholder="例如：你是一个性格孤傲的女孩，实际上喜欢我..."
          placeholderTextColor={colors.textTertiary}
          multiline
          textAlignVertical="top"
        />
        <Text style={styles.hint}>保留角色的性格、世界观和互动风格；关系由真实经历自然发展。</Text>
        {systemPrompt.trim().length > ROLE_TEXT_CHAR_LIMIT && (
          <Text style={[styles.hint, { color: '#E6A23C', marginTop: 4 }]}>
            ⚠️ 人设已超过 {ROLE_TEXT_CHAR_LIMIT.toLocaleString()} 字（无上限保存，完整内容不会丢失），发送时会检查上下文预算；超出当前接口预算会提示调整，不会静默截断人设。
          </Text>
        )}

        {/* ✅ 功能：上传 Word 人设文档（.docx），识别文字追加到角色设定 */}
        <TouchableOpacity
          style={[styles.importDocxBtn, { backgroundColor: isDark ? 'rgba(74,144,217,0.18)' : 'rgba(74,144,217,0.1)', borderColor: isDark ? 'rgba(74,144,217,0.4)' : 'rgba(74,144,217,0.35)' }]}
          onPress={handleImportDocx}
          disabled={importingDoc}
          activeOpacity={0.6}
        >
          <Text style={{ fontSize: 14, color: colors.primary, fontWeight: '500' }}>
            {importingDoc ? '⏳ 正在识别 Word 文档…' : '📄 上传 Word 人设文档（.docx）'}
          </Text>
        </TouchableOpacity>
        <Text style={[styles.hint, { marginTop: 4 }]}>支持 .docx 格式，识别出的文字会追加到上方"角色设定"中，可继续手动编辑。</Text>

        {/* 背景 */}
        <Text style={[styles.fieldLabel, { color: colors.text }]}>📖 背景（可选）</Text>
        <TextInput
          style={[styles.input, styles.multiline, { backgroundColor: isDark ? 'rgba(42,42,42,0.6)' : 'rgba(255,255,255,0.7)', color: colors.text, borderColor: colors.separator }]}
          value={background}
          onChangeText={setBackground}
          placeholder={'用"用户"指代用户，用"你"指代角色自己\n示例：你和用户是大学同学，毕业后用户去了外地，最近联系变少了。'}
          placeholderTextColor={colors.textTertiary}
          multiline textAlignVertical="top"
        />
        </>)}

        {/* 对话模式 — 群聊隐藏 */}
        {targetConv?.type !== 'group' && (<>
        <View style={[styles.modeSection, { borderColor: colors.separator }]}>
          <TouchableOpacity style={[styles.modeCard, conversationMode === 'light' && { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : '#EBF3FC', borderColor: colors.primary }]}
            onPress={() => setConversationMode('light')} activeOpacity={0.7}>
            <Text style={[styles.modeIcon]}>{conversationMode === 'light' ? '●' : '○'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.modeTitle, { color: colors.text }]}>🎯 普通模式</Text>
              <Text style={[styles.modeDesc, { color: colors.textSecondary }]}>按角色设定自然交流</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.modeCard, conversationMode === 'advanced' && { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : '#EBF3FC', borderColor: colors.primary }]}
            onPress={() => setConversationMode('advanced')} activeOpacity={0.7}>
            <Text style={[styles.modeIcon]}>{conversationMode === 'advanced' ? '●' : '○'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.modeTitle, { color: colors.text }]}>💗 高级模式</Text>
              <Text style={[styles.modeDesc, { color: colors.textSecondary }]}>在角色设定基础上调整表达偏好</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* 仅高级模式显示和应用表达偏好 */}
        {conversationMode === 'advanced' && <View>
        <TouchableOpacity
          style={[styles.advancedHeader, { borderColor: colors.separator }]}
          onPress={() => setAdvancedExpanded(!advancedExpanded)}
          activeOpacity={0.6}>
          <Text style={[styles.advancedHeaderText, { color: colors.textSecondary }]}>⚙️ 角色表达偏好</Text>
          <Text style={[styles.advancedToggle, { color: colors.primary }]}>{advancedExpanded ? '收起 ▴' : '展开 ▸'}</Text>
        </TouchableOpacity>

        {advancedExpanded && (
          <View style={[styles.advancedPanel, { backgroundColor: isDark ? 'rgba(42,42,42,0.3)' : 'rgba(0,0,0,0.03)', borderColor: colors.separator }]}>
            {/* 思绪量 */}
            <Text style={[styles.advancedLabel, { color: colors.text }]}>旁白与动作描写量</Text>
            <View style={styles.optionRow}>
              {(['极少', '中等', '较多', '极多'] as AdvancedSettings['thoughtBaseline'][]).map((opt) => (
                <TouchableOpacity key={opt}
                  style={[styles.optionBtn, { backgroundColor: advanced.thoughtBaseline === opt ? colors.primary : (isDark ? 'rgba(255,255,255,0.08)' : '#F0F0F5') }]}
                  onPress={() => setAdvanced({ ...advanced, thoughtBaseline: opt })}>
                  <Text style={[styles.optionText, { color: advanced.thoughtBaseline === opt ? '#FFF' : colors.textSecondary }]}>{opt}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.advancedHint, { color: colors.textTertiary }]}>影响角色创作旁白和动作的多少；不是模型推理过程</Text>

            {/* 信任速度 */}
            <Text style={[styles.advancedLabel, { color: colors.text }]}>情感表达强度</Text>
            <AgentSoulSlider
              label=""
              value={advanced.trustSpeed / 100}
              onValueChange={(v) => setAdvanced({ ...advanced, trustSpeed: Math.round(v * 100) })}
              leftLabel="含蓄"
              rightLabel="鲜明"
              minimumValue={0.2}
              maximumValue={0.8}
            />
            <Text style={[styles.advancedHint, { color: colors.textTertiary }]}>控制表达的含蓄或鲜明程度（当前: {advanced.trustSpeed}）</Text>

            {/* 防御值 */}
            <Text style={[styles.advancedLabel, { color: colors.text }]}>亲密互动风格</Text>
            <AgentSoulSlider
              label=""
              value={advanced.defenseLevel / 100}
              onValueChange={(v) => setAdvanced({ ...advanced, defenseLevel: Math.round(v * 100) })}
              leftLabel="亲近"
              rightLabel="克制"
              minimumValue={0.2}
              maximumValue={0.8}
            />
            <Text style={[styles.advancedHint, { color: colors.textTertiary }]}>低值倾向亲近直接，高值倾向克制、尊重边界（当前: {advanced.defenseLevel}）</Text>

            {/* 主动性 */}
            <Text style={[styles.advancedLabel, { color: colors.text }]}>主动性</Text>
            <AgentSoulSlider
              label=""
              value={advanced.initiative / 100}
              onValueChange={(v) => setAdvanced({ ...advanced, initiative: Math.round(v * 100) })}
              leftLabel="20%"
              rightLabel="80%"
              minimumValue={0.2}
              maximumValue={0.8}
            />
            <Text style={[styles.advancedHint, { color: colors.textTertiary }]}>影响主动延展话题的倾向，不会在后台自动发送消息（当前: {advanced.initiative}%）</Text>

            <Text style={[styles.advancedFooter, { color: colors.textTertiary }]}>💡 这些偏好会传入角色提示词，关系发展仍以对话和共同经历为依据</Text>
          </View>
        )}
        </View>}

        <MemoryRecallSettings conversationId={targetConv?.id} value={memoryRecall} onChange={setMemoryRecall} />

        {/* 温度 */}
        <AgentSoulSlider
          label="温度 (Temperature)"
          value={temperature}
          onValueChange={setTemperature}
          leftLabel="0 精确"
          rightLabel="1 创意"
        />
        <Text style={styles.hint} numberOfLines={1} adjustsFontSizeToFit>随机性，建议0.7；部分模型固定。</Text>

        {/* TopP */}
        <AgentSoulSlider
          label="Top P（核采样）"
          value={topP}
          onValueChange={setTopP}
          leftLabel="0 集中"
          rightLabel="1 多样"
        />
        <Text style={styles.hint} numberOfLines={1} adjustsFontSizeToFit>低值聚焦，高值多样。</Text>

        {/* 分隔线 */}
        <View style={styles.divider} />

        {/* 联网搜索（全局同步） */}
        </>)}

        {/* 分隔线 */}
        <View style={styles.divider} />

        {/* 纯净对话模式 */}
        <TouchableOpacity
          style={[styles.pureToggle, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#F5F5F7' }, pureTextMode && { backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : '#EBF3FC' }]}
          onPress={() => setPureTextMode(!pureTextMode)}
          activeOpacity={0.7}>
          <Text style={styles.pureIcon}>🌿</Text>
          <View style={styles.pureInfo}>
            <Text style={[styles.pureLabel, { color: isDark ? '#C8C8C8' : '#1A1A1A' }]}>纯净对话模式</Text>
            <Text style={[styles.pureStatus, { color: isDark ? '#888' : '#999' }]}>{pureTextMode ? '● 开启' : '○ 关闭'}</Text>
          </View>
          <View style={[styles.pureSwitch, { backgroundColor: pureTextMode ? colors.primary : (isDark ? 'rgba(255,255,255,0.15)' : '#D0D0D5') }]}>
            <View style={[styles.pureSwitchDot, { backgroundColor: isDark ? 'rgba(255,255,255,0.5)' : '#FFF' }, pureTextMode && styles.pureSwitchDotOn]} />
          </View>
        </TouchableOpacity>

        {/* 分隔线 */}
        <View style={styles.divider} />

        {/* 分条发送 */}
        <TouchableOpacity
          style={[styles.pureToggle, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#F5F5F7' }, splitMessages && { backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : '#EBF3FC' }]}
          onPress={() => setSplitMessages(!splitMessages)}
          activeOpacity={0.7}>
          <Text style={styles.pureIcon}>🎵</Text>
          <View style={styles.pureInfo}>
            <Text style={[styles.pureLabel, { color: isDark ? '#C8C8C8' : '#1A1A1A' }]}>Cadence</Text>
            <Text style={[styles.pureStatus, { color: isDark ? '#888' : '#999' }]}>{splitMessages ? '● 新回复按句分条 · 历史不变' : '○ 新回复整段显示 · 历史不变'}</Text>
          </View>
          <View style={[styles.pureSwitch, { backgroundColor: splitMessages ? colors.primary : (isDark ? 'rgba(255,255,255,0.15)' : '#D0D0D5') }]}>
            <View style={[styles.pureSwitchDot, { backgroundColor: isDark ? 'rgba(255,255,255,0.5)' : '#FFF' }, splitMessages && styles.pureSwitchDotOn]} />
          </View>
        </TouchableOpacity>

        {/* 分隔线 */}
        <View style={styles.divider} />

        {/* 背景图片 */}
        <AgentSoulBackgroundPicker
          imageUri={backgroundImage}
          onImageChange={setBackgroundImage}
        />

        {/* @...@ 用法说明 */}
        <Text style={styles.atHint}>
          💡 聊天中可用 @内容@ 描述当前状态/动作/背景{'\n'}
          如 @刚下班累瘫了@ 今天工作好多啊，AI 能感知你的状态
        </Text>

        {/* 保存按钮 */}
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.7}>
          <Text style={styles.saveText}>保存设置</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* 人设修改确认弹窗 */}
      <Modal visible={showConfirmModal} transparent animationType="fade" onRequestClose={() => setShowConfirmModal(false)}>        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            {avatar ? <Image source={{ uri: avatar }} style={styles.modalAvatar} /> : (
              <View style={[styles.modalAvatar, { backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' }]}>
                <Text style={{ color: colors.textInverse, fontSize: 24 }}>AI</Text>
              </View>
            )}
            <Text style={[styles.modalTitle, { color: colors.text }]}>💭 {reaction.title}</Text>
            <Text style={[styles.modalText, { color: colors.textSecondary }]}>"{reaction.text}"</Text>
            <View style={styles.modalBtns}>
              <TouchableOpacity style={[styles.modalBtnCancel, { backgroundColor: colors.surfaceSecondary }]} onPress={() => setShowConfirmModal(false)}>
                <Text style={[styles.modalBtnCancelText, { color: colors.textSecondary }]}>{reaction.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtnConfirm, { backgroundColor: colors.primary }]} onPress={confirmSave}>
                <Text style={[styles.modalBtnConfirmText, { color: colors.textInverse }]}>{reaction.confirm}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Toast visible={toastVisible} message={toastMsg} type={toastType} onDismiss={() => setToastVisible(false)} />
      </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E0E0E0',
  },
  navBtn: {
    width: 60,
  },
  navBtnText: {
    fontSize: 15,
    color: '#4A90D9',
  },
  navTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: 20,
    paddingBottom: 40,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  defaultAvatar: {
    backgroundColor: '#4A90D9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  userAvatarPlaceholder: {
    backgroundColor: '#34C759',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '600',
  },
  avatarHint: {
    fontSize: 12,
    color: '#999',
    marginTop: 6,
  },
  importDocxBtn: {
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  fieldLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1A1A1A',
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#1A1A1A',
    backgroundColor: '#FAFAFA',
  },
  multiline: {
    height: 110,
    textAlignVertical: 'top',
  },
  hint: {
    fontSize: 12,
    color: '#E06060',
    marginTop: 4,
    lineHeight: 18,
  },
  divider: {
    height: 0.5,
    backgroundColor: '#E0E0E0',
    marginVertical: 16,
  },
  atHint: {
    fontSize: 12,
    color: '#4A90D9',
    marginTop: 12,
    marginBottom: 4,
    lineHeight: 18,
    textAlign: 'center',
  },
  saveBtn: {
    marginTop: 24,
    backgroundColor: '#4A90D9',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  // --- 纯净对话模式开关 ---
  pureToggle: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#F5F5F7' },
  pureToggleActive: { backgroundColor: '#EBF3FC' },
  pureIcon: { fontSize: 24, marginRight: 10 },
  pureInfo: { flex: 1 },
  pureLabel: { fontSize: 15, fontWeight: '500', color: '#1A1A1A' },
  pureStatus: { fontSize: 12, color: '#999', marginTop: 2 },
  pureSwitch: { width: 44, height: 26, borderRadius: 13, backgroundColor: '#D0D0D5', justifyContent: 'center', paddingHorizontal: 3 },
  pureSwitchOn: { backgroundColor: '#34C759' },
  pureSwitchDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFF', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.15, shadowRadius: 1, elevation: 1 },
  pureSwitchDotOn: { alignSelf: 'flex-end' },
  modalOverlay: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    backgroundColor: '#FFF', borderRadius: 16, padding: 24,
    marginHorizontal: 32, alignItems: 'center',
  },
  modalAvatar: {
    width: 60, height: 60, borderRadius: 30, marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18, fontWeight: '700', color: '#1A1A1A', textAlign: 'center', marginBottom: 8,
  },
  modalText: {
    fontSize: 15, color: '#666', textAlign: 'center', lineHeight: 22, marginBottom: 24, fontStyle: 'italic',
  },
  modalBtns: {
    flexDirection: 'row', gap: 12,
  },
  modalBtnCancel: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    backgroundColor: '#F0F0F5', alignItems: 'center',
  },
  modalBtnCancelText: {
    fontSize: 15, color: '#666', fontWeight: '600',
  },
  modalBtnConfirm: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    backgroundColor: '#4A90D9', alignItems: 'center',
  },
  modalBtnConfirmText: {
    fontSize: 15, color: '#FFF', fontWeight: '600',
  },
  // --- 对话模式 ---
  modeSection: { gap: 8, marginBottom: 12 },
  modeCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 2, borderColor: 'transparent' },
  modeIcon: { fontSize: 16, marginRight: 10 },
  modeTitle: { fontSize: 14, fontWeight: '600' },
  modeDesc: { fontSize: 12, marginTop: 2 },
  // --- 高级选项面板 ---
  advancedHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4, borderTopWidth: 0.5, marginTop: 16 },
  advancedHeaderText: { fontSize: 14, fontWeight: '500' },
  advancedToggle: { fontSize: 13, fontWeight: '600' },
  advancedPanel: { paddingHorizontal: 12, paddingVertical: 14, borderRadius: 10, borderWidth: 0.5, marginBottom: 12 },
  advancedLabel: { fontSize: 13, fontWeight: '600', marginBottom: 6, marginTop: 10 },
  optionRow: { flexDirection: 'row', gap: 6, marginBottom: 2 },
  optionBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  optionText: { fontSize: 12, fontWeight: '500' },
  advancedHint: { fontSize: 11, marginBottom: 4 },
  advancedFooter: { fontSize: 11, textAlign: 'center', marginTop: 10 },
});
