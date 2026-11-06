import AsyncStorage from '@react-native-async-storage/async-storage';
export interface PomodoroSession { mode: 'focus' | 'shortBreak' | 'longBreak'; remaining: number; deadline: number | null }
const KEY = '@soulmate_pomodoro_session';
let queue: Promise<unknown> = Promise.resolve();
export function remainingSeconds(session: PomodoroSession, now = Date.now()) { return session.deadline === null ? session.remaining : Math.max(0, Math.ceil((session.deadline - now) / 1000)); }
export async function loadPomodoroSession(): Promise<PomodoroSession | null> {
  await queue; const raw = await AsyncStorage.getItem(KEY); if (!raw) return null;
  const s = JSON.parse(raw);
  if (!['focus','shortBreak','longBreak'].includes(s.mode) || !Number.isFinite(s.remaining) || s.remaining < 0 || s.remaining > 1500 || s.deadline !== null && !Number.isFinite(s.deadline)) throw new Error('专注计时记录格式异常，原记录已保留');
  return s;
}
export function savePomodoroSession(session: PomodoroSession): Promise<void> {
  const snapshot = JSON.stringify(session);
  const operation = queue.then(() => AsyncStorage.setItem(KEY, snapshot)); queue = operation.catch(() => {}); return operation;
}
