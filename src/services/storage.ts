// ============================================================
// Soulmate - 存储服务 (API Key + 模型偏好)
//
// v2：多供应商支持。本文件保留旧函数名（getApiKey / getModelPreference 等），
// 内部全部委托给 llmProviders，作用于"当前选中的供应商"，
// 这样所有未改造的调用点语义不变、行为自动跟随用户在设置页选的供应商。
// ============================================================
import {
  getLLMConfig,
  getProviderId,
  saveProviderKey,
  deleteProviderKey,
  getModelForProvider,
  saveModelForProvider,
} from './llmProviders';

// --- API Key（当前供应商）---

export async function saveApiKey(key: string): Promise<void> {
  const provider = await getProviderId();
  await saveProviderKey(provider, key);
}

export async function getApiKey(): Promise<string | null> {
  const config = await getLLMConfig();
  return config.apiKey;
}

export async function deleteApiKey(): Promise<void> {
  const provider = await getProviderId();
  await deleteProviderKey(provider);
}

export async function hasApiKey(): Promise<boolean> {
  const key = await getApiKey();
  return key !== null && key.length > 0;
}

// --- 模型偏好（当前供应商）---

/** 兼容旧类型：现在模型 ID 为任意字符串（各供应商自定义模型名） */
export type ModelType = string;

export async function saveModelPreference(model: ModelType): Promise<void> {
  const provider = await getProviderId();
  await saveModelForProvider(provider, model);
}

export async function getModelPreference(): Promise<ModelType> {
  const provider = await getProviderId();
  return getModelForProvider(provider);
}
