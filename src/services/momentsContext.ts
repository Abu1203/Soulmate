import type { Moment } from '../types/moments';
import type { AgentSoulMessage } from '../types/agentsoul';
import { visibleMoments } from './visibility';

/** Stable message IDs let a character summarize its own social exchanges incrementally. */
export function momentDialogForCharacter(moments: Moment[], characterId: string): AgentSoulMessage[] {
  const messages: AgentSoulMessage[] = [];
  for (const moment of visibleMoments(moments, characterId)) {
    if (!moment.authorConvId) messages.push({ id: moment.id, role: 'user', content: moment.content, timestamp: moment.timestamp });
    // Another character's fictional post is scene data, not something the user said.
    else messages.push({ id: moment.id, role: 'user', meta: 'system', content: `朋友圈动态（${moment.aiName || '角色'}）：${moment.content}`, timestamp: moment.timestamp });
    let lastUserId: string | undefined = !moment.authorConvId ? moment.id : undefined;
    for (const comment of [...moment.comments].sort((a,b) => a.timestamp-b.timestamp)) {
      const user = comment.aiConvId === '__user__';
      if (user) lastUserId = comment.id;
      if (user || comment.aiConvId === characterId) messages.push({ id: comment.id, role: user ? 'user' : 'assistant', inReplyTo: user ? undefined : comment.replyToId || lastUserId, content: comment.content, timestamp: comment.timestamp, senderId: user ? undefined : characterId, senderName: comment.aiName });
    }
  }
  return messages.sort((a,b) => a.timestamp - b.timestamp);
}
