/** Character-authored asides are parsed separately from the model reasoning channel. */
export function parseCharacterReply(raw: string, final = false): { reply: string; aside: string } {
  const open = '〔旁白〕', close = '〔/旁白〕';
  let remaining = raw, reply = '', aside = '';
  while (remaining) {
    const start = remaining.indexOf(open);
    if (start < 0) {
      // Hold a partial delimiter across stream chunks instead of flashing it in the bubble.
      let tail = 0;
      if (!final) for (let i = 1; i < open.length; i++) if (remaining.endsWith(open.slice(0, i))) tail = i;
      reply += tail ? remaining.slice(0, -tail) : remaining; break;
    }
    reply += remaining.slice(0, start);
    const end = remaining.indexOf(close, start + open.length);
    if (end < 0) { aside += remaining.slice(start + open.length).replace(/〔\/?旁?白?〕?$/, ''); break; }
    aside += remaining.slice(start + open.length, end); remaining = remaining.slice(end + close.length);
  }
  return { reply: reply.trim(), aside: aside.trim() };
}

/** Presentation-only filtering: original messages and reply versions are preserved. */
export function stripBracketAnnotations(text: string): string {
  const pairs: Record<string,string> = { '(': ')', '（': '）', '[': ']', '【': '】', '〔': '〕' };
  const stack: string[] = []; let output = '';
  for (const character of text) {
    if (pairs[character]) { stack.push(pairs[character]); continue; }
    if (stack.length) { if (character === stack[stack.length-1]) stack.pop(); continue; }
    output += character;
  }
  return output.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
