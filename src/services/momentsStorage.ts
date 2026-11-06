import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Moment, MomentsDraft } from '../types/moments';
import { momentRequestTasks } from './requestTask';
import { SnapshotStore } from './snapshotStore';
const KEY = '@soulmate_moments', DRAFT = '@soulmate_moments_draft';
import { validMoments as valid } from './dataValidation';
const store = new SnapshotStore<Moment[]>('@soulmate_moments_commit_v1', 'soulmate_moments.commit.json', valid);
let queue: Promise<unknown> = Promise.resolve();
async function read(): Promise<Moment[]> {
  const committed = await store.read();
  if (committed.value !== null) return committed.value;
  if (committed.damaged) throw new Error('朋友圈记录损坏或暂不可读，原数据已保留');
  const raw = await AsyncStorage.getItem(KEY); if (!raw) return [];
  const value = JSON.parse(raw); if (!valid(value)) throw new Error('朋友圈数据格式异常，未覆盖原记录'); return value;
}
export async function loadMoments(): Promise<Moment[]> { await queue; return read(); }
function change(fn: (v: Moment[]) => Moment[]): Promise<void> {
  const result = queue.then(async () => { await store.write(fn(await read())); }); queue = result.catch(() => {}); return result;
}
export function saveMoments(moments: Moment[]): Promise<void> { const snapshot = JSON.parse(JSON.stringify(moments)); return change(() => snapshot); }
export function addMoment(moment: Moment): Promise<void> { return change(v => v.some(m => m.id === moment.id) ? v : [moment, ...v]); }
export function addComment(id: string, comment: Moment['comments'][0]): Promise<void> { return change(v => {
  if (!v.some(m => m.id === id)) throw new Error('动态已删除或不存在，评论未保存');
  return v.map(m => m.id !== id || m.comments.some(c => c.id === comment.id) ? m : { ...m, comments: [...m.comments, comment] });
}); }
export function removeMoment(id: string): Promise<void> { momentRequestTasks.cancel(id); return change(v => v.filter(m => m.id !== id)); }
export async function updateMoment(id: string, patch: Partial<Moment>) { return change(v => v.map(m => m.id === id ? { ...m, ...patch } : m)); }
let draftQueue: Promise<unknown> = Promise.resolve();
function draftChange(action: () => Promise<void>): Promise<void> {
  const result = draftQueue.then(action); draftQueue = result.catch(() => {}); return result;
}
export function saveDraft(draft: MomentsDraft): Promise<void> {
  const json = JSON.stringify(draft); return draftChange(() => AsyncStorage.setItem(DRAFT, json));
}
export async function loadDraft(): Promise<MomentsDraft | null> {
  await draftQueue; const raw = await AsyncStorage.getItem(DRAFT); if (!raw) return null;
  const value = JSON.parse(raw);
  if (!value || typeof value.content !== 'string' || !Array.isArray(value.images) || !value.images.every((v:unknown)=>typeof v==='string') || !Array.isArray(value.aiIds) || !value.aiIds.every((v:unknown)=>typeof v==='string')) throw new Error('草稿格式异常，原数据已保留');
  return value;
}
export function clearDraft(): Promise<void> { return draftChange(() => AsyncStorage.removeItem(DRAFT)); }
