import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { assertRecoveryReady } from './recoveryGuard';
import { recordStorageRead, readFailureReason } from './storageDiagnostics';
interface Commit { format: 'soulmate.snapshot.v1'; revision: number; payload: string; checksum: string }
async function readFileIfPresent(uri: string) { return (await FileSystem.getInfoAsync(uri)).exists ? FileSystem.readAsStringAsync(uri) : null; }
export function checksum(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
/** Same checksum/format, yielding between chunks so streaming and taps can run. */
export async function checksumCooperatively(text: string): Promise<string> {
  let hash = 2166136261, sliceStarted = Date.now();
  for (let start = 0; start < text.length; start += 32768) {
    const end = Math.min(text.length, start + 32768);
    for (let i = start; i < end; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    if (end < text.length && Date.now() - sliceStarted >= 8) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      sliceStarted = Date.now();
    }
  }
  return (hash >>> 0).toString(16);
}
/** Additive verified commits; legacy arrays never outrank a committed revision. */
export class SnapshotStore<T> {
  private queue: Promise<unknown> = Promise.resolve();
  private revision = 0;
  private committed: string | null = null;
  private healthy = false;
  constructor(private key: string, private fileName: string, private validate: (v: unknown) => v is T, private recoveryWrite=false, private preserveUnreadable=false, private salvage?: (v:unknown)=>T|null, private explainInvalid?:(v:unknown)=>string) {}
  private get uri() { return (FileSystem.documentDirectory || '') + this.fileName; }
  private parse(raw: string | null): Commit | null {
    if (!raw) return null;
    try {
      const c = JSON.parse(raw);
      if (c.format !== 'soulmate.snapshot.v1' || !Number.isSafeInteger(c.revision) || c.revision < 1 || typeof c.payload !== 'string' || checksum(c.payload) !== c.checksum) return null;
      JSON.parse(c.payload);
      return c;
    } catch { return null; }
  }
  async read(): Promise<{ value: T | null; damaged: boolean; available?: T; unreadableOnly?: boolean; partial?: boolean }> {
    await this.queue;
    if(!this.recoveryWrite){try{await assertRecoveryReady();}catch(e){recordStorageRead(this.key,'RECOVERY_GUARD / '+readFailureReason(e));return {value:null,damaged:true};}}
    const readFile=async(uri:string)=>(await FileSystem.getInfoAsync(uri)).exists ? FileSystem.readAsStringAsync(uri) : null;
    const results = await Promise.allSettled([AsyncStorage.getItem(this.key),readFile(this.uri),AsyncStorage.getItem(this.key+':head'),readFile(this.uri+'.head'),readFile(this.uri+'.replica')]);
    const parsed = new Map<string, Commit | null>();
    const parse = (raw: string | null) => { if(raw === null)return null; if(!parsed.has(raw))parsed.set(raw,this.parse(raw)); return parsed.get(raw)!; };
    const bodies=new Map<string,{value:unknown;valid:boolean}>();
    const body=(c:Commit)=>{let entry=bodies.get(c.payload);if(!entry){const value=JSON.parse(c.payload);entry={value,valid:this.validate(value)};bodies.set(c.payload,entry);}return entry;};
    const usable=(c:Commit):T|null=>{const b=body(c);return b.valid?b.value as T:this.salvage?.(b.value)??null;};
    const labels=[this.key,this.fileName,this.key+':head',this.fileName+'.head',this.fileName+'.replica'];
    results.forEach((r,i)=>{
      if(r.status==='rejected'){recordStorageRead(labels[i],readFailureReason(r.reason));return;}
      if(r.value===null){recordStorageRead(labels[i],'MISSING');return;}
      let status='INVALID_JSON';
      try{const c=JSON.parse(r.value),commit=i===2||i===3?null:parse(r.value);status=i===2||i===3 ? `HEAD revision=${c?.revision}` : !commit ? 'INVALID_ENVELOPE_OR_CHECKSUM' : body(commit).valid ? `VALID revision=${c.revision}` : 'INVALID_BUSINESS_DATA '+(this.explainInvalid?.(body(commit).value)||'');}catch{}
      recordStorageRead(labels[i],status+' chars='+r.value.length);
    });
    // A temporarily unreadable engine may contain a newer deletion commit. Wait
    // for it to become readable instead of presenting an unverified older copy.
    const readFailed = results.some(r => r.status === 'rejected');
    const raws = [results[0],results[1],results[4]].map(r => r.status === 'fulfilled' ? r.value : null);
    const heads=results.slice(2,4).map(r=>r.status==='fulfilled'?r.value:null);
    let witnessed=0; const receipts:Array<{revision:number;checksum:string}>=[];
    for(const raw of heads){if(raw===null)continue;try{const h=JSON.parse(raw);if(!Number.isSafeInteger(h.revision)||h.revision<1||typeof h.checksum!=='string')throw Error();witnessed=Math.max(witnessed,h.revision);receipts.push(h);}catch{return {value:null,damaged:true};}}
    const candidates = raws.map(parse).filter((c): c is Commit => !!c).sort((a, b) => b.revision - a.revision);
    // This is a preview for an isolated continuation, never permission to replace
    // a damaged original. Both receipts must attest exactly the same candidate.
    const protectedResult = (): { value: null; damaged: true; available?: T; unreadableOnly?: boolean; partial?: boolean } => {
      const latest = candidates[0];
      const newer = latest && raws.some(raw => { try { const c = JSON.parse(raw || 'null'); return c?.revision > latest.revision || c?.revision === latest.revision && typeof c.payload === 'string' && c.payload !== latest.payload; } catch { return false; } });
      const knownHeads = results.slice(2,4).every(r => r.status === 'fulfilled');
      const attested = latest && !newer && knownHeads && (
        receipts.length === 2 && receipts.every(h => h.revision === latest.revision && h.checksum === latest.checksum) ||
        readFailed && receipts.some(h => h.revision === latest.revision && h.checksum === latest.checksum) && receipts.every(h => h.revision <= latest.revision && (h.revision !== latest.revision || h.checksum === latest.checksum))
      );
      const available=attested?usable(latest):null;
      return { value: null, damaged: true, ...(available!==null ? { available, partial:!body(latest).valid, unreadableOnly: readFailed && body(latest).valid && raws.every(raw=>raw===null||!!parse(raw)) } : {}) };
    };
    if (readFailed) return protectedResult();
    // An unparseable replica has unknown age. Preserve it instead of repairing it.
    if(raws.some(raw=>raw!==null&&!parse(raw)))return protectedResult();
    if (!candidates.length) return { value: null, damaged: witnessed>0 || raws.some(Boolean) };
    if(witnessed>candidates[0].revision)return {value:null,damaged:true};
    if(receipts.some(h=>h.revision===candidates[0].revision&&h.checksum!==candidates[0].checksum))return {value:null,damaged:true};
    // A broken newer replica must not let an older snapshot resurrect deleted data.
    const invalidNewer = raws.some(raw => { if (!raw || parse(raw)) return false; try { const c = JSON.parse(raw); return c.format === 'soulmate.snapshot.v1' && c.revision > candidates[0].revision; } catch { return false; } });
    if (invalidNewer) return { value: null, damaged: true };
    if (candidates.some(c=>c.revision===candidates[0].revision&&c.payload!==candidates[0].payload)) return { value: null, damaged: true };
    if(!body(candidates[0]).valid){const available=usable(candidates[0]);return {value:null,damaged:true,partial:true,...(available!==null?{available}:{})};}
    this.revision = candidates[0].revision; this.committed = candidates[0].payload;
    this.healthy = candidates.length >= 2 && candidates.every(c => c.payload === this.committed && c.revision === this.revision)&&receipts.length===2&&receipts.every(h=>h.revision===this.revision&&h.checksum===candidates[0].checksum);
    return { value: JSON.parse(candidates[0].payload), damaged: false };
  }
  write(value: T): Promise<void> {
    return this.writeSerialized(JSON.stringify(value));
  }
  /** Already serialized by the save queue: validate once, without cloning the full history again. */
  writeSerialized(payload: string): Promise<void> {
    const result = this.queue.then(async () => {
      if(!this.recoveryWrite)await assertRecoveryReady();
      if (payload === this.committed && this.healthy) return;
      if (!this.validate(JSON.parse(payload))) throw new Error('数据格式异常，已停止保存以保护历史记录');
      const headRevisions=await Promise.all([AsyncStorage.getItem(this.key+':head'),(async()=>(await FileSystem.getInfoAsync(this.uri+'.head')).exists?FileSystem.readAsStringAsync(this.uri+'.head'):null)()].map(p=>p.then(raw=>{try{const n=JSON.parse(raw||'null')?.revision;return Number.isSafeInteger(n)?n:0;}catch{return 0;}}).catch(()=>0)));
      const revision = Math.max(this.revision + 1, Date.now() * 1000,...headRevisions.map(n=>n+1));
      const digest=await checksumCooperatively(payload);
      const raw = JSON.stringify({ format: 'soulmate.snapshot.v1', revision, payload, checksum: digest } satisfies Commit);
      const head=JSON.stringify({revision,checksum:digest});
      // Android's legacy SQLite reader cannot reliably read a multi-megabyte row.
      // Keep the previous KV body unchanged once history is large. The existing
      // full-format files provide independent verified copies; only then may a
      // small receipt advance. No migration, truncation or deletion of old KV.
      const large=raw.length>262144;
      const replicaWrite=large?(async()=>{
        const uri=this.uri+'.replica';if(this.preserveUnreadable)await readFileIfPresent(uri);
        const temp=uri+'.pending';await FileSystem.writeAsStringAsync(temp,raw);if(await FileSystem.readAsStringAsync(temp)!==raw)throw Error('第二文件副本校验失败');
        await FileSystem.moveAsync({from:temp,to:uri});if(await FileSystem.readAsStringAsync(uri)!==raw)throw Error('第二文件副本提交失败');
      })():null;
      const fileWrite = (async () => { if (this.preserveUnreadable) await Promise.all([readFileIfPresent(this.uri), readFileIfPresent(this.uri+'.head')]); const temp = this.uri + '.pending'; await FileSystem.writeAsStringAsync(temp, raw); if (await FileSystem.readAsStringAsync(temp) !== raw) throw new Error('文件校验失败'); await FileSystem.moveAsync({ from: temp, to: this.uri }); if (await FileSystem.readAsStringAsync(this.uri) !== raw) throw new Error('文件提交校验失败');await FileSystem.writeAsStringAsync(this.uri+'.head',head);if(await FileSystem.readAsStringAsync(this.uri+'.head')!==head)throw Error('文件提交凭据未保存'); })();
      const writes = await Promise.allSettled([
        (async () => {
          if(large){await Promise.any([fileWrite,replicaWrite!]);await AsyncStorage.getItem(this.key+':head');}
          else {if (this.preserveUnreadable) await Promise.all([AsyncStorage.getItem(this.key), AsyncStorage.getItem(this.key+':head')]);await AsyncStorage.setItem(this.key, raw);if (await AsyncStorage.getItem(this.key) !== raw) throw new Error('存储校验失败');}
          await AsyncStorage.setItem(this.key+':head',head);if(await AsyncStorage.getItem(this.key+':head')!==head)throw Error('提交凭据未保存');
        })(),
        fileWrite,
        ...(replicaWrite?[replicaWrite]:[]),
      ]);
      if (writes.slice(0,2).every(w => w.status === 'rejected')) throw new Error('数据尚未保存：设备存储写入失败，请保留当前页面并重试');
      this.revision = revision; this.committed = payload;
      this.healthy = writes.every(w => w.status === 'fulfilled');
    });
    this.queue = result.catch(() => {}); return result;
  }
}
