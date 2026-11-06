import type { MemoryNode } from '../types/memory';
import { semanticText } from './memoryIdentity';
import { MEMORY_RECALL_CHAR_BUDGET, selectCoreMemories, memoryCharCount } from './memoryPolicy';
export function normalizeMemory(text: string) { return text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, ''); }
function terms(text: string): Set<string> {
  const s = semanticText(text), result = new Set<string>();
  (text.toLowerCase().match(/[a-z0-9]{2,}/g) || []).forEach(t => result.add(t));
  for (let i = 0; i < s.length - 1; i++) result.add(s.slice(i, i + 2));
  return result;
}
/** Relevant recall, not a fixed slice of all facts. The old numeric weights never change with usage. */
export function recallMemories(query: string, memories: MemoryNode[], maxResults = 12, characterId?: string, charBudget = MEMORY_RECALL_CHAR_BUDGET): MemoryNode[] {
  const normalizedQuery=query.replace(/我叫什么|我叫啥|我的名字|我的姓名|我是谁/g,'用户姓名').replace(/我住哪|我在哪里住|我住在什么地方|我现在住在哪|我住在哪/g,'用户居住城市');
  const q = terms(normalizedQuery);
  const explicitRecall=/(?:你(?:还)?记(?:得|不记得)|还记得(?:我|我们|之前|以前|上次)|你的记忆|记忆里|你记住了|你对我.*了解|我(?:之前|以前|上次).*说|我们.*(?:约定|经历))/.test(query);
  const available=memories.filter(m=>m && !m.inactive && m.content && (!m.source || !characterId || m.source.characterId===characterId));
  const core=selectCoreMemories(available.filter(m=>m.core===true||m.core!==false&&(m.kind==='relationship'||m.kind==='agreement')));
  const scored = available.map(m => {
    const key=m.factKey?.toLowerCase()||'';
    const identityHint=/^user\.(name|real_name|nickname)$/.test(key)?'用户姓名':/^user\.(home_city|city|residence|living_city)$/.test(key)?'用户居住城市':'';
    const content=m.content.replace(/用户(?:的)?(?:名字|姓名)/g,'用户姓名').replace(/用户(?:叫做|名叫|叫)/g,'用户姓名');
    const mt = terms(content + ' ' + (m.tags || []).join(' ')+' '+identityHint);
    let hits = 0; for (const term of q) if (mt.has(term)) hits++;
    const relevant = hits > 0 || explicitRecall;
    const ageDays = Math.max(0, (Date.now() - (m.updatedAt || m.timestamp)) / 86400000);
    const kindBonus = m.kind === 'agreement' ? 3 : m.kind === 'fact' || m.isFact || m.tags?.includes('事实') ? 2 : 1;
    return { m, relevant, score: hits * 5 + (relevant ? kindBonus : 0) + (relevant ? 1 / (1 + ageDays / 30) : 0) };
  }).filter(x => x.relevant).sort((a, b) => b.score - a.score || (b.m.updatedAt || b.m.timestamp) - (a.m.updatedAt || a.m.timestamp));
  const result: MemoryNode[] = []; const seen = new Set<string>(); let chars = 0;
  for (const m of [...core,...scored.map(x=>x.m)]) {
    const category=m.kind==='fiction'?'fiction':['event','agreement','relationship'].includes(m.kind||'')?m.kind:'fact';
    const key = `${category}:${m.factKey || normalizeMemory(m.content)}`; if (seen.has(key)) continue;
    if (result.length >= maxResults || chars + memoryCharCount(m.content) > charBudget) continue;
    seen.add(key); result.push(m); chars += memoryCharCount(m.content);
  }
  return result;
}
/** Compatibility helpers: no keyword extraction, no age/interaction decay or FIFO fact removal. */
export function pruneMemories(memories: MemoryNode[]) { const seen = new Set<string>(); return memories.filter(m => { const key = m.id; if (seen.has(key)) return false; seen.add(key); return true; }); }
