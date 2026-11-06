import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AgentSoulMessage } from '../types/agentsoul';
import { assertRecoveryReady } from './recoveryGuard';
import { SnapshotStore } from './snapshotStore';
const PREFIX = '@soulmate_group_msgs_';
let queue: Promise<unknown> = Promise.resolve();
import { validGroupMessages as valid } from './dataValidation';
export function groupSnapshotNames(id:string){return {key:PREFIX+id+':commit',file:'soulmate_group.'+encodeURIComponent(id)+'.commit.json'};}
export function isGroupSnapshotFile(name:string){return /^soulmate_group\.[A-Za-z0-9_%!~*'().-]+\.commit\.json(?:\.head|\.replica)?$/.test(name);}
const stores=new Map<string,SnapshotStore<AgentSoulMessage[]>>();
function storeFor(id:string){let store=stores.get(id);if(!store){const names=groupSnapshotNames(id);store=new SnapshotStore(names.key,names.file,valid);stores.set(id,store);}return store;}
async function read(id:string):Promise<AgentSoulMessage[]>{
  const committed=await storeFor(id).read();
  if(committed.value!==null)return committed.value;
  if(committed.damaged)throw new Error('群聊记录校验异常或暂不可读，未回退旧副本或覆盖原数据');
  const raw=await AsyncStorage.getItem(PREFIX+id);if(!raw)return [];
  const value=JSON.parse(raw);if(!valid(value))throw new Error('群聊记录格式异常，原数据已保留');return value;
}
export async function loadGroupMessages(id: string): Promise<AgentSoulMessage[]> {
  await queue; await assertRecoveryReady(); return read(id);
}
export function saveGroupMessages(id: string, messages: AgentSoulMessage[]): Promise<AgentSoulMessage[]> {
  const incoming = JSON.parse(JSON.stringify(messages)) as AgentSoulMessage[];
  const result = queue.then(async () => {
    await assertRecoveryReady();
    const current=await read(id);
    const map = new Map(current.map(m => [m.id, m])); incoming.forEach(m => map.set(m.id, m));
    const merged = [...map.values()].sort((a, b) => a.timestamp - b.timestamp);
    if(!valid(merged))throw Error('群聊数据不完整，原记录未覆盖');
    await storeFor(id).write(merged);
    // The legacy array is read-only once a verified snapshot exists.
    return merged;
  });
  queue = result.catch(() => {}); return result;
}
export function appendGroupMessage(id: string, message: AgentSoulMessage) { return saveGroupMessages(id, [message]); }
export function removeGroupMessages(id: string): Promise<void> {
  const result = queue.then(async() => {await assertRecoveryReady();await storeFor(id).write([]);}); queue = result.catch(() => {}); return result;
}
