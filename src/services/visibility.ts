import type { Moment } from '../types/moments';
/** Missing aiIds is legacy public data. Explicit [] grants no other character access. */
export function canSeeMoment(moment: Moment, characterId: string): boolean {
  if (moment.authorConvId === characterId) return true;
  return !Array.isArray(moment.aiIds) || moment.aiIds.includes(characterId);
}
export function visibleMoments(moments: Moment[], characterId?: string): Moment[] { return characterId ? moments.filter(m => canSeeMoment(m, characterId)) : []; }
