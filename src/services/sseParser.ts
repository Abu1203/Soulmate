export class SSEParser {
  private buffer = ''; private data: string[] = []; private ended = false; private event = '';
  constructor(private onData: (data: string, event?: string) => void) {}
  push(text: string) {
    if (this.ended) return; this.buffer += text; let index: number;
    while ((index = this.buffer.indexOf('\n')) >= 0) { const line = this.buffer.slice(0, index).replace(/\r$/, ''); this.buffer = this.buffer.slice(index + 1); this.line(line); if (this.ended) break; }
  }
  private line(line: string) { if (!line) { this.dispatch(); return; } if (line.startsWith('event:')) this.event = line.slice(6).trim(); if (line.startsWith('data:')) this.data.push(line.slice(5).replace(/^ /, '')); }
  private dispatch() { if (!this.data.length) { this.event = ''; return; } const data = this.data.join('\n'), event = this.event; this.data = []; this.event = ''; if (data === '[DONE]') this.ended = true; this.onData(data, event); }
  finish() { if (!this.ended) { if (this.buffer) this.line(this.buffer.replace(/\r$/, '')); this.buffer = ''; this.dispatch(); } }
  get done() { return this.ended; }
}
export function parseSSE(raw: string): string | null {
  let value: string | null = null;
  const parser = new SSEParser(data => { if (data === '[DONE]') { value = data; return; } const json = JSON.parse(data); if (json.error) throw new Error(json.error.message || '模型服务流式返回错误'); value = json.choices?.[0]?.delta?.content ?? null; });
  parser.push(raw); parser.finish(); return value;
}
