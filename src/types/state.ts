/** Legacy archive shape only. No state calculator or numerical relationship control uses it. */
export interface SoulState {
  // === 核心状态张量（0–100） ===
  trust: number;      // 信任度：深度交流 +5，被伤害 -15
  defense: number;    // 防御值：被伤害 +10，被温和对待 -5
  energy: number;     // 情绪能量：被关心 +5，被冷漠 -3，24小时 +2
  intimacy: number;   // 亲密度：深度交流 +2，长期沉默 -1/天

  // === 情绪基调 ===
  currentMood: '极度低落' | '低落' | '平淡' | '好' | '极好';

  // === 防御状态（滞后环控制） ===
  isDefensive: boolean;

  // === 离线时间线 ===
  offlineStatus: {
    activity: string;
    startedAt: number;
    endedAt: number;
  };

  // === 元数据 ===
  lastInteraction: number;
  totalInteractions: number;
  positiveInteractions: number;
  negativeInteractions: number;
  isFirstInteraction: boolean;  // ⭐补丁3
}

