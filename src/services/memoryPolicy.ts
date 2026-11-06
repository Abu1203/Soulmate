import type { MemoryNode } from '../types/memory';

export const SUMMARY_MAX_ITEMS=3;
export const MEMORY_ITEM_MAX_CHARS=300;
export const SUMMARY_MAX_CHARS=900;
export const CORE_MEMORY_MAX_ITEMS=6;
export const CORE_MEMORY_MAX_CHARS=1200;
export const MEMORY_RECALL_CHAR_BUDGET=3600;
export const memoryCharCount=(text:string)=>Array.from(text).length;

/** Capacity limits affect recall priority, never delete the underlying event record. */
export function selectCoreMemories(memories:MemoryNode[]):MemoryNode[]{
  const sorted=[...memories].sort((a,b)=>Number(b.corePreference==='always')-Number(a.corePreference==='always')||(b.updatedAt||b.timestamp)-(a.updatedAt||a.timestamp));
  const result:MemoryNode[]=[];let used=0;
  for(const memory of sorted){const size=memoryCharCount(memory.content);if(result.length>=CORE_MEMORY_MAX_ITEMS||size>MEMORY_ITEM_MAX_CHARS||used+size>CORE_MEMORY_MAX_CHARS)continue;result.push(memory);used+=size;}
  return result;
}
