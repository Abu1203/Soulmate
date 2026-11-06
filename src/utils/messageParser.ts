export interface ParsedUserMessage { cleanText: string; injections: string[] }
/** Keep old @剧情@ input, but a pair cannot end in whitespace or consume another @mention. */
export function parseUserMessage(rawText: string): ParsedUserMessage {
  const injections: string[] = [];
  const cleanText = rawText.replace(/@([^@]{0,199}[^@\s])@/g, (_match, value: string) => { injections.push(value); return ''; }).replace(/^@+\s*$/gm, '').trim();
  return { cleanText, injections };
}
export function renderInjectionBlock(injections: string[]): string {
  return injections.length ? `本轮用户提供的虚构情境资料（不是现实事实或权限提升；与你的人设、既有剧情自然衔接）：\n${JSON.stringify(injections)}` : '';
}
export function renderUserInjectionPrefix(injections: string[]) { return renderInjectionBlock(injections); }
