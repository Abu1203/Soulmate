// Metadata only: no messages, role prompts, memories, API keys or full raw values.
const observations = new Map<string, string>();
export function recordStorageRead(source: string, status: string) { observations.set(source, status); }
export function storageReadReport() {
  return ['Soulmate storage reader v2', ...Array.from(observations, ([source, status]) => `${source}: ${status}`)].join('\n');
}
export function readFailureReason(error: unknown) {
  const value = String((error as any)?.message || error);
  if (/CursorWindow|row too big|blob too big/i.test(value)) return 'ANDROID_ROW_TOO_LARGE';
  if (/disk.*full|no space|SQLITE_FULL/i.test(value)) return 'STORAGE_FULL';
  if (/malformed|corrupt|SQLITE_CORRUPT/i.test(value)) return 'DATABASE_CORRUPT';
  if (/permission|denied/i.test(value)) return 'READ_PERMISSION';
  return 'READ_FAILED';
}
