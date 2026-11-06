// ============================================================
// Soulmate — AI 服务设置（多供应商 / 自定义模型）
//
// 支持：DeepSeek / Kimi / 通义千问 / 智谱 GLM / 自定义接口
// - 每个供应商独立保存 Key 与模型，切换互不影响
// - 模型可下拉选择，也可手动填写（应对厂商上新/退役）
// - 测试连接：一次最小请求暴露 Key / 地址 / 模型 三类错误
// - 视觉能力统一用主供应商（不再单独配置"图片识别 Key"）
// ============================================================
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, StatusBar, ActivityIndicator,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useAgentSoul } from '../contexts/AgentSoulContext';
import Toast from '../components/Toast';
import GlassModal from '../components/GlassModal';
import {
  PROVIDERS, getPreset, getProviderId, saveProviderId,
  getProviderKey, saveProviderKey, deleteProviderKey,
  getModelForProvider, saveModelForProvider,
  getCustomProvider, saveCustomProvider,
  resetThinkingSupport, testConnection,
  type ProviderId, type CustomProviderConfig,
} from '../services/llmProviders';

export default function ApiKeyScreen({ navigation }: any) {
  const { colors, isDark } = useTheme();
  const { checkApiKey } = useAgentSoul();

  const [provider, setProvider] = useState<ProviderId>('deepseek');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [selectedModel, setSelectedModel] = useState('');
  const [custom, setCustom] = useState<CustomProviderConfig>({ name: '自定义', baseUrl: '', model: '' });
  const [switching, setSwitching] = useState(true);
  const switchingRef = useRef(true);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const mountedRef=useRef(true),returnTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>()=>{mountedRef.current=false;if(returnTimerRef.current)clearTimeout(returnTimerRef.current);},[]);
  const [isTesting, setIsTesting] = useState(false);
  const testRef=useRef<{id:number;controller:AbortController}|null>(null);
  const testSequence=useRef(0);
  const [testResult,setTestResult]=useState<{ok:boolean;message:string}|null>(null);
  useEffect(()=>{testSequence.current++;testRef.current?.controller.abort();testRef.current=null;setIsTesting(false);setTestResult(null);},[provider,apiKey,selectedModel,custom.baseUrl,custom.model]);
  useEffect(()=>()=>{testSequence.current++;testRef.current?.controller.abort();testRef.current=null;},[]);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const showToast = (msg: string) => { setToastMsg(msg); setToastVisible(true); };

  const preset = getPreset(provider);

  useEffect(() => { void init().catch((e) => showToast(e.message || '设置读取失败')).finally(() => { switchingRef.current = false; setSwitching(false); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const init = async () => {
    const p = await getProviderId();
    setProvider(p);
    const cfg = p==='custom'?await getCustomProvider():undefined;
    if(cfg)setCustom(cfg);
    await loadForProvider(p, cfg);
  };

  const loadForProvider = async (p: ProviderId, cfg?: CustomProviderConfig) => {
    const key = await getProviderKey(p);
    setApiKey(key || '');
    setHasExistingKey(!!key);
    if (p === 'custom') {
      const c = cfg || (await getCustomProvider());
      setSelectedModel(c.model || '');
    } else {
      setSelectedModel(await getModelForProvider(p));
    }
  };

  const handleProviderSelect = async (p: ProviderId) => {
    if (p === provider || switchingRef.current || savingRef.current || testRef.current) return;
    switchingRef.current = true; setSwitching(true);
    try {
      const key = await getProviderKey(p);
      const cfg = p === 'custom' ? await getCustomProvider() : undefined;
      const model = cfg ? cfg.model : await getModelForProvider(p);
      await saveProviderId(p);
      setProvider(p); setApiKey(key || ''); setHasExistingKey(!!key); setSelectedModel(model);
      if (cfg) setCustom(cfg);
      await checkApiKey(); showToast(`已切换到 ${getPreset(p).label}`);
    } catch (e) { showToast(e instanceof Error ? e.message : '切换失败，保留原设置'); }
    finally { switchingRef.current = false; setSwitching(false); }
  };

  /** 当前编辑中的完整配置（用于保存与测试） */
  const currentBaseUrl = provider === 'custom' ? custom.baseUrl.trim() : preset.baseUrl;
  const currentModel = provider === 'custom' ? (custom.model || '').trim() : selectedModel.trim();

  const handleSave = useCallback(async () => {
    if (switchingRef.current || savingRef.current || testRef.current) return;
    const trimmed = apiKey.trim();
    if (!trimmed) { showToast('API Key 不能为空'); return; }
    if (provider === 'custom') {
      if (!/^https:\/\//i.test(custom.baseUrl.trim())) { showToast('接口地址需使用 HTTPS'); return; }
      if (!custom.model.trim()) { showToast('请填写模型 ID'); return; }
      if (custom.contextWindow !== undefined && (!Number.isFinite(custom.contextWindow) || custom.contextWindow < 8192 || custom.contextWindow > 1048576)) { showToast('上下文预算需在8192至1048576之间'); return; }
    } else if (!selectedModel.trim()) {
      showToast('请选择或填写模型');
      return;
    }
    savingRef.current = true; setIsSaving(true);
    try {
      await saveProviderKey(provider, trimmed);
      if (provider === 'custom') {
        await saveCustomProvider({ ...custom, baseUrl: custom.baseUrl.trim(), model: custom.model.trim() });
        await saveModelForProvider('custom', custom.model.trim());
      } else {
        await saveModelForProvider(provider, selectedModel.trim());
      }
      // 换了 Key/地址/模型后，之前的"不支持思考参数"结论作废，允许重新探测
      await resetThinkingSupport(provider);
      await checkApiKey();
      showToast('已保存');
      if(returnTimerRef.current)clearTimeout(returnTimerRef.current);
      if(mountedRef.current)returnTimerRef.current=setTimeout(() => {if(mountedRef.current&&navigation.isFocused?.()!==false)navigation.goBack();}, 1200);
    } catch (e: any) {
      showToast(e?.message || '保存失败');
    } finally {
      savingRef.current = false; setIsSaving(false);
    }
  }, [apiKey, provider, custom, selectedModel, checkApiKey, navigation]);

  const handleTest = useCallback(async () => {
    if(testRef.current||switchingRef.current||savingRef.current)return;
    const id=++testSequence.current,controller=new AbortController();testRef.current={id,controller};
    setIsTesting(true);setTestResult(null);
    try{
      const result=await testConnection({provider,baseUrl:currentBaseUrl,model:currentModel,apiKey:apiKey.trim()},controller.signal);
      if(id===testSequence.current&&!controller.signal.aborted)setTestResult(result);
    }catch(e:any){if(id===testSequence.current)setTestResult({ok:false,message:e.message||'测试失败'});}
    finally{if(id===testSequence.current){testRef.current=null;setIsTesting(false);}}
  },[provider,currentBaseUrl,currentModel,apiKey,isSaving]);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
        {/* 标题 */}
        <View style={styles.headerSection}>
          <Text style={styles.keyIcon}>🔑</Text>
          <Text style={[styles.title, { color: colors.text }]}>AI 服务设置</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            密钥保存在本机安全存储，请求时发送给选定的接口{'\n'}
            聊天内容、评论及记忆总结会交由该接口处理
          </Text>
        </View>

        {/* 供应商选择 */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.separator }]}>
          <Text style={[styles.modelLabel, { color: colors.text }]}>选择服务商</Text>
          <View style={styles.providerWrap}>
            {PROVIDERS.map((p) => {
              const active = p.id === provider;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[
                    styles.providerChip,
                    {
                      backgroundColor: active ? colors.primary : colors.surfaceSecondary,
                      borderColor: active ? colors.primary : colors.separator,
                    },
                  ]}
                  disabled={switching || isSaving || isTesting}
                  onPress={() => handleProviderSelect(p.id)}
                  activeOpacity={0.7}>
                  <Text style={[styles.providerChipText, { color: active ? '#FFFFFF' : colors.text }]}>
                    {p.shortLabel}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* 当前供应商信息 */}
          <View style={[styles.infoRow, { borderColor: colors.separator }]}>
            <Text style={[styles.infoText, { color: colors.textSecondary }]}>
              {provider === 'custom'
                ? '自定义 OpenAI 兼容接口'
                : `接口地址：${preset.baseUrl}`}
            </Text>
            {preset.keyUrl ? (
              <Text style={[styles.infoHint, { color: colors.textTertiary }]}>
                获取 Key：{preset.keyUrl}
              </Text>
            ) : null}
            {preset.note ? (
              <Text style={[styles.infoHint, { color: colors.textTertiary }]}>{preset.note}</Text>
            ) : null}
          </View>

          {/* 自定义供应商表单 */}
          {provider === 'custom' ? (
            <View style={{ marginBottom: 4 }}>
              <Text style={[styles.fieldLabel, { color: colors.text }]}>名称（随意）</Text>
              <View style={[styles.inputWrapper, { borderColor: colors.inputBorder }]}>
                <TextInput
                  style={[styles.input, { color: colors.text }]}
                  value={custom.name}
                  onChangeText={(t) => setCustom((c) => ({ ...c, name: t }))}
                  placeholder="我的中转"
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="none"
                />
              </View>

              <Text style={[styles.fieldLabel, { color: colors.text }]}>接口地址 Base URL</Text>
              <View style={[styles.inputWrapper, { borderColor: colors.inputBorder }]}>
                <TextInput
                  style={[styles.input, { color: colors.text }]}
                  value={custom.baseUrl}
                  onChangeText={(t) => setCustom((c) => ({ ...c, baseUrl: t }))}
                  placeholder="https://api.example.com/v1"
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
              </View>

              <Text style={[styles.fieldLabel, { color: colors.text }]}>模型 ID</Text>
              <View style={[styles.inputWrapper, { borderColor: colors.inputBorder }]}>
                <TextInput
                  style={[styles.input, { color: colors.text }]}
                  value={custom.model}
                  onChangeText={(t) => setCustom((c) => ({ ...c, model: t }))}
                  placeholder="gpt-4o / deepseek-chat ..."
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <Text style={[styles.fieldLabel, { color: colors.text }]}>接口上下文预算（Token）</Text>
              <TextInput keyboardType="number-pad" placeholder="8192" style={[styles.input, { color: colors.text }]} value={custom.contextWindow === undefined ? '' : String(custom.contextWindow)} onChangeText={text => { const digits = text.replace(/\D/g, ''); setCustom(c => ({ ...c, contextWindow: digits ? Number(digits) : undefined })); }} />
              <Text style={[styles.infoHint, { color: colors.textTertiary }]}>未知接口默认8192；确认模型支持更大窗口后再提高。近期上下文会在完整轮次边界内适配预算。</Text>
            </View>
          ) : null}

          {/* API Key */}
          <Text style={[styles.fieldLabel, { color: colors.text }]}>API Key</Text>
          <View style={[styles.inputWrapper, { borderColor: colors.inputBorder }]}>
            <TextInput
              style={[styles.input, { color: colors.text }]}
              value={apiKey}
              onChangeText={setApiKey}
              placeholder={preset.keyHint || 'sk-...'}
              placeholderTextColor={colors.textTertiary}
              secureTextEntry={!showKey}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
            />
            <TouchableOpacity onPress={() => setShowKey(!showKey)} style={styles.eyeBtn} activeOpacity={0.6}>
              <Text style={styles.eyeIcon}>{showKey ? '🙈' : '👁️'}</Text>
            </TouchableOpacity>
          </View>

          {/* 模型选择（预设供应商） */}
          {provider !== 'custom' ? (
            <>
              <Text style={[styles.fieldLabel, { color: colors.text }]}>模型</Text>
              <View style={styles.modelWrap}>
                {preset.models.map((m) => {
                  const active = selectedModel === m.id;
                  return (
                    <TouchableOpacity
                      key={m.id}
                      style={[
                        styles.modelChip,
                        {
                          backgroundColor: active ? colors.primary : colors.surfaceSecondary,
                          borderColor: active ? colors.primary : colors.separator,
                        },
                      ]}
                      onPress={() => setSelectedModel(m.id)}
                      activeOpacity={0.7}>
                      <Text style={[styles.modelChipText, { color: active ? '#FFFFFF' : colors.text }]}>
                        {m.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={[styles.inputWrapper, { borderColor: colors.inputBorder }]}>
                <TextInput
                  style={[styles.input, { color: colors.text }]}
                  value={selectedModel}
                  onChangeText={setSelectedModel}
                  placeholder="也可手动填写模型 ID"
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            </>
          ) : null}

          {/* 操作按钮 */}
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.testBtn, { borderColor: colors.primary }]}
              onPress={handleTest}
              disabled={isTesting || isSaving || switching}
              activeOpacity={0.8}>
              {isTesting
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Text style={[styles.testBtnText, { color: colors.primary }]}>测试连接</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtnInline, { backgroundColor: apiKey.trim() ? colors.primary : colors.surfaceSecondary }]}
              onPress={handleSave}
              disabled={isSaving || isTesting || !apiKey.trim()}
              activeOpacity={0.8}>
              <Text style={[styles.saveBtnText, { color: apiKey.trim() ? '#FFFFFF' : colors.textTertiary }]}>
                {isSaving ? '保存中...' : '保存并连接'}
              </Text>
            </TouchableOpacity>
          </View>

          {(isTesting||testResult) && <Text accessibilityLiveRegion="polite" style={{color:isTesting?colors.textSecondary:testResult?.ok?colors.success:colors.error,marginTop:10}}>{isTesting?'测试中…':testResult?.message}</Text>}
          {hasExistingKey ? (
            <TouchableOpacity
              style={[styles.deleteBtn, { borderColor: colors.error }]}
              disabled={switching||isSaving||isTesting}
              onPress={() => setShowDeleteModal(true)}
              activeOpacity={0.6}>
              <Text style={[styles.deleteBtnText, { color: colors.error }]}>
                删除 {preset.shortLabel} 的 API Key
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* 状态 */}
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: hasExistingKey ? colors.success : colors.textTertiary }]} />
          <Text style={[styles.statusText, { color: colors.textSecondary }]}>
            {hasExistingKey
              ? `● ${preset.shortLabel} · ${currentModel || '未选模型'}`
              : `● ${preset.shortLabel} 未设置`}
          </Text>
        </View>

        {/* 说明 */}
        <View style={[styles.guideCard, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[styles.guideTitle, { color: colors.text }]}>说明</Text>
          <Text style={[styles.guideText, { color: colors.textSecondary }]}>
            • 各服务商独立保存 Key，切换不会丢失{'\n'}
            • 模型可下拉选择或手动填写，厂商上新/退役无需等更新{'\n'}
            • 若某模型不支持思考参数，App 会自动降级重试（不影响正常对话）{'\n'}
            • 朋友圈图片识别使用当前服务商的视觉能力，不支持时会自动跳过
          </Text>
        </View>
      </ScrollView>

      <Toast visible={toastVisible} message={toastMsg} type="info" onDismiss={() => setToastVisible(false)} />
      <GlassModal
        visible={showDeleteModal}
        icon="🗑"
        title="删除 API Key"
        message={`确定删除 ${preset.shortLabel} 的 API Key 吗？删除后需重新填写才能使用。`}
        confirmText="删除"
        cancelText="取消"
        busy={isSaving}
        onConfirm={async () => {
          if(savingRef.current||switchingRef.current||testRef.current)return;
          savingRef.current=true;setIsSaving(true);
          try{
            await deleteProviderKey(provider);await checkApiKey();
            if(mountedRef.current){setShowDeleteModal(false);setApiKey('');setHasExistingKey(false);showToast('已删除');}
          }catch(e){if(mountedRef.current)showToast(e instanceof Error?e.message:'删除失败，请重试');}
          finally{savingRef.current=false;if(mountedRef.current)setIsSaving(false);}
        }}
        onCancel={() => setShowDeleteModal(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },
  headerSection: { alignItems: 'center', marginBottom: 20 },
  keyIcon: { fontSize: 44, marginBottom: 10 },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 16 },
  providerWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  providerChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1.5 },
  providerChipText: { fontSize: 13, fontWeight: '600' },
  infoRow: { borderTopWidth: 1, paddingTop: 10, marginBottom: 6 },
  infoText: { fontSize: 12, lineHeight: 17 },
  infoHint: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  fieldLabel: { fontSize: 13, fontWeight: '600', marginBottom: 6, marginTop: 8 },
  modelLabel: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderRadius: 12, marginBottom: 4, overflow: 'hidden',
  },
  input: {
    flex: 1, fontSize: 15, paddingHorizontal: 14, paddingVertical: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  eyeBtn: { paddingHorizontal: 14, paddingVertical: 12 },
  eyeIcon: { fontSize: 18 },
  modelWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  modelChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5 },
  modelChipText: { fontSize: 12, fontWeight: '600' },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 14, marginBottom: 10 },
  testBtn: {
    flex: 1, borderRadius: 12, borderWidth: 1.5, paddingVertical: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  testBtnText: { fontSize: 15, fontWeight: '600' },
  saveBtnInline: { flex: 1.4, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  saveBtnText: { fontSize: 15, fontWeight: '600' },
  deleteBtn: { borderRadius: 12, borderWidth: 1, paddingVertical: 11, alignItems: 'center', marginTop: 2 },
  deleteBtnText: { fontSize: 13, fontWeight: '500' },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  statusText: { fontSize: 13, fontWeight: '500' },
  guideCard: { borderRadius: 12, padding: 14 },
  guideTitle: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  guideText: { fontSize: 12, lineHeight: 20 },
});
