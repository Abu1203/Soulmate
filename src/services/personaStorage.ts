import AsyncStorage from '@react-native-async-storage/async-storage';
import { validMemory } from './dataValidation';
import type { AgentSoulPersona } from '../types/persona';
/** Read-only legacy archive. New role memories are committed with their conversation. */
export async function loadPersonas(): Promise<Record<string, AgentSoulPersona>> {
  const raw = await AsyncStorage.getItem('@soulmate_ai_personas'); if (!raw) return {};
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some((p: any) => !p || typeof p.id !== 'string' || p.memories !== undefined && (!Array.isArray(p.memories) || p.memories.some((m: any) => !validMemory(m))))) throw new Error('旧角色副本暂不可读，原副本已保留');
  return value;
}
