export type MemoryKind = 'fact' | 'event' | 'agreement' | 'relationship' | 'fiction' | 'unverified';
export interface MemoryNode {
  id: string; content: string; tags: string[]; timestamp: number;
  /** Old values are preserved for compatibility, never used as relationship scores. */
  weight: number; isFlashbulb: boolean; isFact?: boolean; ephemeral?: boolean; emotionTag?: string;
  kind?: MemoryKind; factKey?: string; manualLocked?: boolean;
  source?: { characterId: string; conversationId: string; scene: 'private' | 'group' | 'moments' | 'manual'; messageIds: string[]; replies?: Array<{ messageId: string; versionId: string }> };
  updatedAt?: number;
  core?: boolean;
  corePreference?: 'always'|'topic';
  userConfirmed?: boolean;
  inactive?: boolean;
  history?: Array<{ content: string; at: number; reason: string; source?: MemoryNode['source'] }>;
}
export interface MemoryCursor { lastSuccessAt?: number; lastSavedCount?: number; summaryPromptVersion?:number; lastResult?:'saved'|'empty'|'unchanged'; lastResultNote?:string; throughTimestamp: number; throughIds: string[]; processed?: Record<string, string>; partial?: Record<string, { fingerprint: string; offset: number }> }
export interface MemoryState {
  cursors: Record<string, MemoryCursor>;
  editVersion: number;
  blocked: Array<{ content: string; factKey?: string; messageIds?: string[]; reason?:'edit'|'delete'|'source' }>;
  jobs?: Record<string, { scene: 'private' | 'group' | 'moments'; attempts: number; retryAt: number; lastTrigger?: string; lastError?: string }>;
  edits?: Array<{ memory: MemoryNode; at: number; action: 'edit' | 'delete' | 'unlock' }>;
  invalidSources?: Array<{scope:string;messageIds?:string[]}>;
}
export interface MemoryRecallSettings { enabled: boolean; interval: number }
export const MAX_MEMORIES = 200; // legacy export; no automatic FIFO deletion
