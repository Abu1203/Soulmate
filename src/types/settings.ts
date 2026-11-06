/** Values are expression preferences, never relationship scores. Old field names remain storage-compatible. */
export interface AdvancedSettings {
  thoughtBaseline: '极少' | '中等' | '较多' | '极多';
  trustSpeed: number;   // legacy key: 情感表达强度
  defenseLevel: number; // legacy key: 亲密表达的克制程度
  initiative: number;   // 话题主动程度, expressed through the prompt, not random triggering
}
export const DEFAULT_ADVANCED: AdvancedSettings = { thoughtBaseline: '中等', trustSpeed: 50, defenseLevel: 30, initiative: 20 };
export function expressionPreference(advanced?: Partial<AdvancedSettings>): string {
  const a = { ...DEFAULT_ADVANCED, ...advanced };
  const intensity = a.trustSpeed >= 65 ? '情感表达鲜明直接' : a.trustSpeed <= 35 ? '情感表达含蓄克制' : '情感表达适中';
  const closeness = a.defenseLevel >= 65 ? '亲密表达更重视距离与边界' : a.defenseLevel <= 35 ? '双方关系允许时，可自然直接表达亲近' : '亲密表达循序渐进，尊重双方意愿';
  const initiative = a.initiative >= 65 ? '适时主动分享、接续共同话题' : a.initiative <= 35 ? '主要跟随当前话题，不为延长对话而频繁追问' : '自然接话，必要时主动分享';
  const description = { '极少': '主要用对话表达，极少动作或心理旁白', '中等': '有需要时加入简短动作或心理旁白', '较多': '可适当描写动作与心理旁白，但不挤占交流', '极多': '情境适合时可以细腻描写动作与心理旁白，日常仍保持自然' }[a.thoughtBaseline];
  return `${intensity}；${closeness}；${initiative}；${description}。这些偏好服从具体角色性格和经历，不代表关系阶段或用户事实。`;
}
