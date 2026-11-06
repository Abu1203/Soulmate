import type { AgentSoulMessage } from '../types/agentsoul';
import { stripBracketAnnotations } from './replyParser';
import { selectedVersion } from './storyEngine';
export interface DialogTurn { user: AgentSoulMessage; assistants: AgentSoulMessage[]; excerpt?: string; progress?: {fingerprint:string;offset:number;next:number;total:number} }
export function completeTurns(messages: AgentSoulMessage[]): DialogTurn[] {
  const turns: DialogTurn[] = []; const byUserId = new Map<string, DialogTurn>(); let current: DialogTurn | null = null;
  for (const message of messages) {
    if (message.meta === 'system' || message.content.startsWith('[TRANSFER]') || message.content.startsWith('[SCENARIO')) continue;
    if (message.role === 'user') { current = { user: message, assistants: [] }; turns.push(current); byUserId.set(message.id, current); }
    else if (!message.isStreaming && !message.error && message.content.trim()) {
      const target = message.inReplyTo ? byUserId.get(message.inReplyTo) : current;
      target?.assistants.push(message);
    }
  }
  return turns.filter(t => t.assistants.length > 0);
}
export function estimateTokens(text: string): number {
  const han = (text.match(/[\u3400-\u9fff]/g) || []).length;
  return han + Math.ceil((text.length - han) / 3) + 8;
}
export function messageContent(message: AgentSoulMessage): string {
  if(message.replyVersions)return selectedVersion(message).content;
  const total = (message.versions?.length || 0) + 1;
  return message.versionIndex && message.versionIndex < total ? message.versions?.[message.versionIndex - 1]?.content ?? message.content : message.content;
}
/** Keep complete exchanges, bounded by a conservative model budget. Never split a round. */
export function recentDialog(messages: AgentSoulMessage[], tokenBudget: number, targetTurns = 40, selfId?: string, pureTextMode = false) {
  const turns = completeTurns(messages), selected: DialogTurn[] = []; let used = 0;
  for (let i = turns.length - 1; i >= 0 && selected.length < Math.min(50, Math.max(30, targetTurns)); i--) {
    const turn = turns[i];
    const tokens = [turn.user, ...turn.assistants].reduce((n, m) => n + estimateTokens(messageContent(m)), 0);
    if (used + tokens > tokenBudget) break;
    used += tokens; selected.unshift(turn);
  }
  return selected.flatMap(t => [t.user, ...t.assistants]).map(m => ({
    role: m.role === 'assistant' && (!selfId || !m.senderId || m.senderId === selfId) ? 'assistant' : 'user',
    content: m.senderName ? `${m.senderName}：${pureTextMode&&m.role==='assistant'?stripBracketAnnotations(messageContent(m)):messageContent(m)}` : pureTextMode&&m.role==='assistant'?stripBracketAnnotations(messageContent(m)):messageContent(m),
  }));
}
