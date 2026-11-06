import { fetch } from 'expo/fetch';
import { abortable, abortError, cancelReader } from './abortable';
// ============================================================
// llmProviders — 多供应商 / 自定义模型 统一接入层
//
// 设计目标：
// - 所有 AI 请求只有一个入口（postChat / getLLMConfig），不再硬编码 baseURL；
// - 每个供应商独立保存 Key 与模型选择（互不干扰）；
// - 各家协议差异（thinking 参数形态、max_tokens 上限）集中在 caps 里；
// - 遇到 400 时自动降级重试一次（去掉 thinking 参数），保证换模型后"思绪通道"
//   不会因为参数不被支持而直接失败；
// - 旧版（仅 DeepSeek）的 Key/模型偏好自动迁移，老用户零感知。
// ============================================================
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------- 类型 ----------------

export type ProviderId = 'deepseek' | 'kimi' | 'qwen' | 'zhipu' | 'custom';

export interface ProviderModel {
  id: string;
  label: string;
  kind?: 'chat' | 'fast' | 'vision';
}

/** 思考参数形态：各家不同，不能一把梭 */
export type ThinkingParamStyle =
  | 'thinking'          // DeepSeek / 智谱：body.thinking = { type: 'enabled' }
  | 'enable_thinking'   // 千问（OpenAI 兼容模式）：body.enable_thinking = true
  | 'none';             // 自定义端点默认不发，避免 400

export interface ProviderCaps {
  thinkingParam: ThinkingParamStyle;
  /** 服务端 max_tokens 上限（超出会被拒），发送前取 min */
  maxTokensCap: number;
  maxTokensField: 'max_tokens' | 'max_completion_tokens';
  /** 是否支持图片输入（决定朋友圈图片识别能否用当前供应商） */
  vision: boolean;
}

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  shortLabel: string;
  baseUrl: string;
  /** 获取 Key 的地址（展示用） */
  keyUrl: string;
  keyHint: string;
  models: ProviderModel[];
  caps: ProviderCaps;
  note?: string;
}

export interface CustomProviderConfig {
  name: string;
  baseUrl: string;
  model: string;
  contextWindow?: number;
}

export interface LLMConfig {
  provider: ProviderId;
  label: string;
  baseUrl: string;
  model: string;
  apiKey: string | null;
  caps: ProviderCaps;
  /** 该供应商下可作为视觉用途的模型（无则 null） */
  visionModel: string | null;
  contextWindow?: number;
}
export function contextWindowBudget(config: LLMConfig): number {
  return Math.max(8192, Math.min(1048576, config.contextWindow || (config.provider === 'custom' ? 8192 : 65536)));
}

// ---------------- 预设（2026-09 核对官方文档） ----------------

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    shortLabel: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    keyUrl: 'platform.deepseek.com',
    keyHint: 'sk-...',
    models: [
      { id: 'deepseek-flash', label: 'V4.1 Flash（快速·省钱）', kind: 'fast' },
      { id: 'deepseek-v4-pro', label: 'V4 Pro（高精度）', kind: 'chat' },
    ],
    caps: { thinkingParam: 'thinking', maxTokensCap: 16384, maxTokensField: 'max_tokens', vision: true },
    note: '旧名 deepseek-v4-flash 仍可用（模型已退役，由 V4.1-Flash 接管）',
  },
  {
    id: 'kimi',
    label: 'Kimi（月之暗面）',
    shortLabel: 'Kimi',
    baseUrl: 'https://api.moonshot.ai/v1',
    keyUrl: 'platform.kimi.ai',
    keyHint: 'sk-...',
    models: [
      { id: 'kimi-k3', label: 'K3（旗舰·1M 上下文）', kind: 'chat' },
      { id: 'kimi-k2.6', label: 'K2.6（多模态）', kind: 'chat' },
      { id: 'kimi-k2.7-code-highspeed', label: 'K2.7 Code 高速版', kind: 'fast' },
    ],
    caps: { thinkingParam: 'thinking', maxTokensCap: 8192, maxTokensField: 'max_tokens', vision: true },
    note: 'moonshot-v1-* 与 kimi-k2* 已退役，请用 K3 / K2.6',
  },
  {
    id: 'qwen',
    label: '通义千问（阿里云百炼）',
    shortLabel: '千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    keyUrl: 'bailian.console.aliyun.com',
    keyHint: 'sk-...',
    models: [
      { id: 'qwen3.8-max', label: 'Qwen3.8 Max（旗舰）', kind: 'chat' },
      { id: 'qwen-plus', label: 'Qwen Plus（均衡）', kind: 'chat' },
      { id: 'qwen-turbo', label: 'Qwen Turbo（极速）', kind: 'fast' },
      { id: 'qwen3-vl-plus', label: 'Qwen3-VL Plus（视觉）', kind: 'vision' },
    ],
    caps: { thinkingParam: 'enable_thinking', maxTokensCap: 8192, maxTokensField: 'max_tokens', vision: true },
    note: 'Key 与地域绑定；如需业务空间专属域名可自行填写',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    shortLabel: '智谱',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    keyUrl: 'open.bigmodel.cn',
    keyHint: 'xxx.xxx',
    models: [
      { id: 'glm-5.3', label: 'GLM-5.3（旗舰·1M）', kind: 'chat' },
      { id: 'glm-5.3-flash', label: 'GLM-5.3 Flash（极低价）', kind: 'fast' },
      { id: 'glm-4.7-flashx', label: 'GLM-4.7 FlashX（高速）', kind: 'fast' },
      { id: 'glm-5v-turbo', label: 'GLM-5V Turbo（视觉）', kind: 'vision' },
    ],
    caps: { thinkingParam: 'thinking', maxTokensCap: 8192, maxTokensField: 'max_tokens', vision: true },
    note: '海外用户可改用 https://api.z.ai/api/paas/v4',
  },
  {
    id: 'custom',
    label: '自定义接口',
    shortLabel: '自定义',
    baseUrl: '',
    keyUrl: '',
    keyHint: 'sk-...',
    models: [],
    caps: { thinkingParam: 'thinking', maxTokensCap: 8192, maxTokensField: 'max_tokens', vision: true },
    note: '任何 OpenAI 兼容端点（中转站 / 自建服务）；若模型不支持思考参数会自动降级',
  },
];

export function getPreset(id: ProviderId): ProviderPreset {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
}

// ---------------- 存储 key ----------------

const LEGACY_KEY_STORE = 'agentfile_deepseek_api_key';   // v1 沿用
const LEGACY_MODEL_KEY = 'agentfile_model_preference';   // v1 沿用
const KEY_STORE_PREFIX = 'agentfile_api_key_';           // + providerId
const MODEL_KEY_PREFIX = 'agentfile_model_';             // + providerId
const PROVIDER_KEY = 'agentfile_provider';
const CUSTOM_KEY = 'agentfile_custom_provider';
const NO_THINKING_PREFIX = 'agentfile_nothinking_';      // + providerId：该供应商已确认不支持思考参数
const MIGRATED_KEY = 'agentfile_provider_migrated_v1';

// 内存缓存（SecureStore 有延迟，且请求路径高频读取）
const keyCache: Partial<Record<ProviderId, string | null>> = {};
let activeProviderCache: ProviderId | null = null;
let customCache: CustomProviderConfig | null = null;
const modelCache: Partial<Record<ProviderId, string>> = {};

async function readProviderId(): Promise<ProviderId> {
  if (activeProviderCache) return activeProviderCache;
  try {
    const v = await AsyncStorage.getItem(PROVIDER_KEY);
    if (v && PROVIDERS.some((p) => p.id === v)) {
      activeProviderCache = v as ProviderId;
      return activeProviderCache;
    }
  } catch { throw new Error('AI 服务配置暂不可读，请稍后重试；未切换供应商'); }
  activeProviderCache = 'deepseek';
  return activeProviderCache;
}

export async function saveProviderId(id: ProviderId): Promise<void> {
  await AsyncStorage.setItem(PROVIDER_KEY, id);
  activeProviderCache = id;
}

export async function getProviderId(): Promise<ProviderId> {
  await ensureMigrated();
  return readProviderId();
}

/** 旧版本（只有 DeepSeek）数据迁移：老用户升级后无需重新填 Key */
async function ensureMigrated(): Promise<void> {
  try {
    if (await AsyncStorage.getItem(MIGRATED_KEY)) return;
    // Key
    const legacyKey = await SecureStore.getItemAsync(LEGACY_KEY_STORE);
    if (legacyKey) {
      const cur = await SecureStore.getItemAsync(KEY_STORE_PREFIX + 'deepseek');
      if (!cur) await SecureStore.setItemAsync(KEY_STORE_PREFIX + 'deepseek', legacyKey);
    }
    // 模型偏好
    const legacyModel = await AsyncStorage.getItem(LEGACY_MODEL_KEY);
    if (legacyModel) {
      const mapped = legacyModel === 'deepseek-v4-pro' || legacyModel === 'deepseek-reasoner'
        ? 'deepseek-v4-pro'
        : 'deepseek-flash';
      const cur = await AsyncStorage.getItem(MODEL_KEY_PREFIX + 'deepseek');
      if (!cur) await AsyncStorage.setItem(MODEL_KEY_PREFIX + 'deepseek', mapped);
    }
    await AsyncStorage.setItem(MIGRATED_KEY, '1');
  } catch { /* 迁移失败不阻塞主流程 */ }
}

// ---------------- Key ----------------

export async function saveProviderKey(id: ProviderId, key: string): Promise<void> {
  await SecureStore.setItemAsync(KEY_STORE_PREFIX + id, key);
  keyCache[id] = key;
  // 兼容旧字段：默认供应商保持旧 key 同步，防止其他未改造路径读不到
  if (id === 'deepseek') {
    await SecureStore.setItemAsync(LEGACY_KEY_STORE, key).catch(() => {});
  }
}

export async function getProviderKey(id: ProviderId): Promise<string | null> {
  if (keyCache[id] !== undefined) return keyCache[id] ?? null;
  await ensureMigrated();
  try {
    const key = await SecureStore.getItemAsync(KEY_STORE_PREFIX + id);
    keyCache[id] = key || null;
    return key || null;
  } catch { throw new Error('安全存储暂不可读，请稍后重试；原密钥未修改'); }
}

export async function deleteProviderKey(id: ProviderId): Promise<void> {
  if (id === 'deepseek') {
    await SecureStore.deleteItemAsync(LEGACY_KEY_STORE);
  }
  await SecureStore.deleteItemAsync(KEY_STORE_PREFIX + id);
  keyCache[id] = null;
}

// ---------------- 模型选择 ----------------

export async function saveModelForProvider(id: ProviderId, model: string): Promise<void> {
  await AsyncStorage.setItem(MODEL_KEY_PREFIX + id, model);
  modelCache[id] = model;
  if (id === 'deepseek') {
    // 兼容旧字段
    await AsyncStorage.setItem(LEGACY_MODEL_KEY, model).catch(() => {});
  }
}

export async function getModelForProvider(id: ProviderId): Promise<string> {
  if (modelCache[id]) return modelCache[id] as string;
  await ensureMigrated();
  try {
    const v = await AsyncStorage.getItem(MODEL_KEY_PREFIX + id);
    if (v) { modelCache[id] = v; return v; }
  } catch { throw new Error('模型选择暂不可读，请稍后重试；未改用默认模型'); }
  const fallback = getPreset(id).models[0]?.id || '';
  modelCache[id] = fallback;
  return fallback;
}

// ---------------- 自定义供应商 ----------------

export async function saveCustomProvider(cfg: CustomProviderConfig): Promise<void> {
  await AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify(cfg));
  customCache = cfg;
}

export async function getCustomProvider(): Promise<CustomProviderConfig> {
  if (customCache) return customCache;
  try {
    const raw = await AsyncStorage.getItem(CUSTOM_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||['name','baseUrl','model'].some(k=>parsed[k]!==undefined&&typeof parsed[k]!=='string'))throw new Error('invalid custom configuration');
      customCache = {
        name: String(parsed?.name || '自定义'),
        baseUrl: String(parsed?.baseUrl || ''),
        model: String(parsed?.model || ''),
        contextWindow: Number.isFinite(parsed?.contextWindow) ? parsed.contextWindow : 8192,
      };
      return customCache;
    }
  } catch { throw new Error('自定义接口配置暂不可读，请稍后重试；原配置未修改'); }
  customCache = { name: '自定义', baseUrl: '', model: '' };
  return customCache;
}

// ---------------- 思考参数降级标记（按 供应商+模型 粒度，避免误伤同厂商其他模型） ----------------

function noThinkingKey(id: ProviderId, model: string): string {
  return `${NO_THINKING_PREFIX}${id}_${model}`;
}

async function isThinkingDisabled(id: ProviderId, model: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(noThinkingKey(id, model))) === '1';
  } catch {
    return false;
  }
}

export async function markThinkingUnsupported(id: ProviderId, model: string): Promise<void> {
  try { await AsyncStorage.setItem(noThinkingKey(id, model), '1'); } catch {}
}

/** 清掉该供应商下所有模型的降级标记（换了 Key/地址后重新探测） */
export async function resetThinkingSupport(id: ProviderId): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const targets = keys.filter((k) => k.startsWith(`${NO_THINKING_PREFIX}${id}_`));
    if (targets.length > 0) await AsyncStorage.removeMany(targets);
  } catch {}
}

// ---------------- 配置解析 ----------------

function pickVisionModel(preset: ProviderPreset, model: string): string | null {
  if (!preset.caps.vision) return null;
  const vision = preset.models.find((m) => m.kind === 'vision');
  if (vision) return vision.id;
  // 没有单独视觉型号时：当前模型本身即可（DeepSeek/Kimi 主模型支持视觉）
  return model || preset.models[0]?.id || null;
}

/** 当前生效的完整配置（所有 AI 请求的唯一来源） */
export async function getLLMConfig(): Promise<LLMConfig> {
  const provider = await getProviderId();
  const preset = getPreset(provider);

  if (provider === 'custom') {
    const custom = await getCustomProvider();
    const apiKey = await getProviderKey('custom');
    const model = custom.model || '';
    return {
      provider,
      label: custom.name || '自定义',
      baseUrl: custom.baseUrl,
      model,
      apiKey,
      caps: preset.caps,
      contextWindow: custom.contextWindow || 8192,
      visionModel: preset.caps.vision ? model : null,
    };
  }

  const [apiKey, model] = await Promise.all([
    getProviderKey(provider),
    getModelForProvider(provider),
  ]);
  return {
    provider,
    label: preset.label,
    baseUrl: preset.baseUrl,
    model,
    apiKey,
    caps: preset.caps,
    visionModel: pickVisionModel(preset, model),
  };
}

// ---------------- 请求构造与发送 ----------------

export interface ChatBuildOptions {
  messages: Array<Record<string, any>>;
  stream?: boolean;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  json?: boolean;
  /** 是否希望开启思考通道（默认 true；false 则绝不发送思考参数） */
  thinking?: boolean;
  model?: string;
  config?: LLMConfig;
  timeoutMs?: number;
}

export interface BuiltChatRequest {
  config: LLMConfig;
  url: string;
  headers: Record<string, string>;
  body: Record<string, any>;
}

function joinUrl(baseUrl: string): string {
  const base = (baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('未配置接口地址（Base URL）');
  if (!/^https:\/\//i.test(base)) throw new Error('接口地址必须使用 HTTPS，以保护密钥和聊天内容');
  return `${base}/chat/completions`;
}

/** Official DeepSeek requests keep an explicit on/off switch; unsupported models must report an error. */
function isOfficialDeepSeekEndpoint(config:LLMConfig):boolean {
  return /^https:\/\/api\.deepseek\.com(?:\/(?:v1|beta))?\/?$/i.test(config.baseUrl);
}

function buildBody(
  config: LLMConfig,
  opts: ChatBuildOptions,
  withThinking: boolean,
  thinkingDisabled: boolean,
): Record<string, any> {
  const body: Record<string, any> = {
    model: config.model,
    messages: opts.messages,
    stream: !!opts.stream,
  };
  const alwaysThinking = config.provider === 'kimi' && /kimi-k3|kimi-k2\.7/.test(config.model)
    || config.provider === 'zhipu' && /glm-5\.3/.test(config.model);
  const fixedSampling = config.provider === 'kimi' && /kimi-k3|kimi-k2\.7/.test(config.model);
  if (!fixedSampling && opts.temperature !== undefined) body.temperature = opts.temperature;
  if (!fixedSampling && opts.topP !== undefined) body.top_p = Math.max(0.01, Math.min(1, opts.topP));
  const field = config.provider === 'kimi' && /kimi-k3/.test(config.model) ? 'max_completion_tokens' : config.caps.maxTokensField;
  body[field] = Math.min(opts.maxTokens ?? 4096, config.caps.maxTokensCap);
  if(isOfficialDeepSeekEndpoint(config)){
    body.thinking={type:withThinking?'enabled':'disabled'};
    if(withThinking)body.reasoning_effort='high';
  } else if (alwaysThinking) {
    if (/kimi-k3|glm-5\.3/.test(config.model)) body.reasoning_effort = 'low';
  } else if (!thinkingDisabled && config.caps.thinkingParam !== 'none') {
    if (config.caps.thinkingParam === 'enable_thinking') body.enable_thinking = withThinking;
    else body.thinking = { type: withThinking ? 'enabled' : 'disabled' };
  }
  if (opts.json) body.response_format = { type: 'json_object' };
  return body;
}

/** 构造请求（不发送），供需要自定义 fetch 行为的调用方使用 */
export async function buildChatRequest(opts: ChatBuildOptions): Promise<BuiltChatRequest> {
  const selected = opts.config || await getLLMConfig();
  const config = opts.model ? { ...selected, model: opts.model } : selected;
  if (!config.apiKey) throw new Error('请先设置API Key');
  if (!config.model) throw new Error('请先选择或填写模型');
  const thinkingDisabled = !isOfficialDeepSeekEndpoint(config) && await isThinkingDisabled(config.provider, config.model);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
  };
  if (opts.stream) headers.Accept = 'text/event-stream';
  return {
    config,
    url: joinUrl(config.baseUrl),
    headers,
    body: buildBody(config, opts, opts.thinking !== false, thinkingDisabled),
  };
}

/**
 * 统一发送入口（含思考参数自动降级）：
 * 若首次请求因参数不被支持返回 400，则去掉思考参数重试一次，并记住该供应商不支持思考，
 * 之后不再重复踩坑 —— 保证换任何模型都不会"发不出去消息"。
 */
export interface ChatResponse {
  ok: boolean; status: number; headers: Headers; body: ReadableStream<Uint8Array> | null;
  json(): Promise<any>; text(): Promise<string>;
}
function bufferedResponse(resp: Pick<Response, 'status' | 'ok' | 'headers'>, text: string): ChatResponse {
  return { ok: resp.ok, status: resp.status, headers: resp.headers, body: null, text: async () => text, json: async () => JSON.parse(text) };
}
export async function postChat(opts: ChatBuildOptions & { signal?: AbortSignal }): Promise<ChatResponse> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (opts.signal?.aborted) controller.abort();
  opts.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, opts.timeoutMs ?? 120_000);
  const cleanup = () => { clearTimeout(timer); opts.signal?.removeEventListener('abort', abort); };
  try {
    const built = await abortable(buildChatRequest(opts), controller.signal);
    const doFetch = (body: Record<string, any>) => {
      if(controller.signal.aborted)throw abortError();
      const request=fetch(built.url, { method: 'POST', headers: built.headers, body: JSON.stringify(body), signal: controller.signal });
      void request.then(response=>{if(controller.signal.aborted)try{void response.body?.cancel().catch(()=>{});}catch{/* Late native response. */}},()=>{});
      return abortable(request,controller.signal);
    };
    let body = { ...built.body }, resp: Response = await doFetch(body);
    let removedThinking = false;
    for (let attempt = 0; attempt < 2 && [400,422].includes(resp.status); attempt++) {
      const detail = await abortable(resp.text(),controller.signal);
      const unsupported = /(unsupported|not support|unknown|unrecognized|not available|不支持)/i.test(detail);
      const jsonError = unsupported && /(response_format|json_object|json mode)/i.test(detail) && body.response_format;
      const effortError = !jsonError && unsupported && /reasoning_effort/i.test(detail) && body.reasoning_effort;
      const thinkingError = !jsonError && !effortError && unsupported && /(thinking|enable_thinking)/i.test(detail) && (body.thinking || body.enable_thinking !== undefined);
      if (!thinkingError && !jsonError && !effortError) { cleanup(); return bufferedResponse(resp, detail); }
      if(thinkingError&&isOfficialDeepSeekEndpoint(built.config))throw new Error('当前 DeepSeek 接口拒绝思考模式参数；未改变思考模式继续请求，请核对模型和接口。');
      if (thinkingError) { delete body.thinking; delete body.enable_thinking; delete body.reasoning_effort; removedThinking = true; }
      if (effortError) delete body.reasoning_effort;
      if (jsonError) delete body.response_format;
      resp = await doFetch(body);
    }
    // This optional cache must never hold a successful response or its Stop action.
    if (resp.ok && removedThinking) void markThinkingUnsupported(built.config.provider, built.config.model);
    if (!opts.stream || !resp.ok || !resp.body) {
      const text = await abortable(resp.text(),controller.signal);
      cleanup();
      return bufferedResponse(resp, text);
    }
    const reader = resp.body.getReader();
    const stream = new ReadableStream<Uint8Array>({
      async pull(streamController) {
        try { const { done, value } = await abortable(reader.read(),controller.signal); if (done) { cleanup(); reader.releaseLock(); streamController.close(); } else streamController.enqueue(value); }
        catch (e) { cleanup(); cancelReader(reader); streamController.error(e); }
      },
      cancel() { controller.abort(); cleanup(); cancelReader(reader); },
    });
    // RN's global Response constructor cannot wrap a ReadableStream. Keep the native
    // Expo fetch stream and expose the small response contract used by this app.
    return { ok: resp.ok, status: resp.status, headers: resp.headers, body: stream,
      json: async () => { throw new Error('流式响应请通过消息解析器读取'); },
      text: async () => { throw new Error('流式响应请通过消息解析器读取'); } };
  } catch (e) { cleanup(); throw e; }
}

/** 把 HTTP 错误转成用户能看懂的中文 */
export function friendlyHttpError(status: number, detail?: string): string {
  const tail = detail ? `（${String(detail).slice(0, 120)}）` : '';
  switch (status) {
    case 400: return `请求被拒绝(400)：可能是模型名不对或参数不支持${tail}`;
    case 401: return 'API Key 无效或与当前接口不匹配(401)，请检查 Key 与供应商是否对应';
    case 402: case 403: return `无权限或余额不足(${status})${tail}`;
    case 404: return `接口地址或模型不存在(404)：请检查 Base URL 与模型名${tail}`;
    case 429: return '请求过于频繁或额度超限(429)，请稍后再试';
    case 500: case 502: case 503: return `服务端暂时不可用(${status})，请稍后重试`;
    default: return `请求失败(${status})${tail}`;
  }
}

// ---------------- 连接测试 ----------------

export interface TestInput {
  provider: ProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface TestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

/** 设置页"测试连接"：发一次最小请求，直接暴露 Key/地址/模型三类错误 */
export async function testConnection(input: TestInput, signal?:AbortSignal, timeoutMs=20_000): Promise<TestResult> {
  const started=Date.now();
  if(!input.apiKey.trim())return {ok:false,message:'请先填写 API Key'};
  if(!input.baseUrl.trim())return {ok:false,message:'请先填写接口地址'};
  if(!input.model.trim())return {ok:false,message:'请先选择或填写模型'};
  try {
    const preset=getPreset(input.provider);
    const config:LLMConfig={provider:input.provider,label:preset.label,baseUrl:input.baseUrl.trim(),model:input.model.trim(),apiKey:input.apiKey.trim(),caps:preset.caps,visionModel:null};
    const response=await postChat({config,messages:[{role:'user',content:'只回复：连接成功'}],stream:false,maxTokens:2048,thinking:false,timeoutMs,signal});
    if(signal?.aborted)return {ok:false,message:'测试已取消'};
    let data:any;
    try{data=await response.json();}catch{return {ok:false,message:response.ok?'响应格式异常：未返回有效 JSON':friendlyHttpError(response.status)};}
    if(!response.ok)return {ok:false,message:friendlyHttpError(response.status,data?.error?.message||data?.message)};
    if(data?.error)return {ok:false,message:'接口返回错误：'+String(data.error.message||'响应异常').slice(0,120)};
    const choice=data?.choices?.[0];
    if(!choice||!choice.message||typeof choice.message.content!=='string')return {ok:false,message:'响应格式异常：缺少对话正文'};
    if(['length','max_tokens'].includes(choice.finish_reason))return {ok:false,message:'回复被截断，未验证成功；请检查模型输出与思考预算'};
    if(choice.finish_reason&&choice.finish_reason!=='stop')return {ok:false,message:'模型未正常完成回复（'+String(choice.finish_reason).slice(0,40)+'）'};
    if(!choice.message.content.trim()||!/[\p{L}\p{N}]/u.test(choice.message.content))return {ok:false,message:'模型没有返回有效正文（只有思考或空回复）'};
    const latencyMs=Date.now()-started;
    return {ok:true,message:`基本聊天连接成功（${latencyMs}ms）；摘要和图片能力尚未验证`,latencyMs};
  }catch(e:any){
    if(signal?.aborted)return {ok:false,message:'测试已取消'};
    if(e?.name==='AbortError'||/abort|timeout/i.test(String(e?.message)))return {ok:false,message:'连接超时，请检查网络或模型响应速度'};
    return {ok:false,message:'连接失败：'+String(e?.message||'网络不可用').slice(0,120)};
  }
}

// ---------------- 视觉（朋友圈图片识别） ----------------

/**
 * 当前供应商可用于图片识别的配置；不可用时返回 null（调用方应跳过图片描述）。
 * 说明：v2 起取消独立的"视觉模型 Key"，统一用主供应商，因为主流模型均已支持视觉。
 */
export async function getVisionLLMConfig(): Promise<LLMConfig | null> {
  const config = await getLLMConfig();
  if (!config.apiKey) return null;
  if (!config.caps.vision) return null;
  const preset = getPreset(config.provider);
  const visionModel = config.visionModel || preset.models.find((m) => m.kind === 'vision')?.id || null;
  if (!visionModel) return null;
  return { ...config, model: visionModel };
}
