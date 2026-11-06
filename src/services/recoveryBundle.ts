import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FS from 'expo-file-system/legacy';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import type { AgentSoulConversation, StoryBranch } from '../types/agentsoul';
import type { Moment } from '../types/moments';
import { generateId } from '../types/agentsoul';
import { loadConversations, CONTINUITY_KEY, CONTINUITY_FILE } from './agentsoulStorage';
import { loadGroupMessages, groupSnapshotNames, isGroupSnapshotFile } from './groupStorage';
import { loadMoments } from './momentsStorage';
import { validConversations, validGroupMessages, validMoments } from './dataValidation';
import { SnapshotStore, checksum } from './snapshotStore';
import { RECOVERY_JOURNAL, assertRecoveryReady } from './recoveryGuard';
import { hydrateStory } from './storyEngine';

interface BundleData { conversations:AgentSoulConversation[]; groups:Record<string,any[]>; moments:Moment[]; preferences:Record<string,string>; media:Array<{uri:string;name:string;base64:string}> }
export interface RecoveryBundle {format:'soulmate.recovery.v1';createdAt:number;data:BundleData;checksum:string}
interface Journal {id:string;target:RecoveryBundle;previous:{keys:Record<string,string|null>;files:Record<string,string|null>}}
const docs=FS.documentDirectory||'';
const files=['soulmate_conversations.commit.json','soulmate_conversations.commit.json.head','soulmate_conversations.commit.json.replica',CONTINUITY_FILE,CONTINUITY_FILE+'.head',CONTINUITY_FILE+'.replica','soulmate_moments.commit.json','soulmate_moments.commit.json.head','soulmate_moments.commit.json.replica'];
const preference=(key:string)=>key.startsWith('@soulmate_')&&!/commit|group_msgs|moments$|recovery_/.test(key)||['@agentsoul_active','@agentsoul_thinking_mode'].includes(key);
const list=(v:any)=>v&&typeof v==='object'&&!Array.isArray(v);
const groupKey=(id:string)=>'@soulmate_group_msgs_'+id;
const isJournalFile=(name:string)=>/^soulmate_recovery_transaction\.[A-Za-z0-9_-]+\.json$/.test(name);
async function journalText(stored:string):Promise<string>{
  let ref:any;try{ref=JSON.parse(stored);}catch{return stored;}
  if(ref?.format!=='soulmate.recovery-journal.file.v1')return stored;
  if(typeof ref.file!=='string'||!isJournalFile(ref.file)||typeof ref.checksum!=='string')throw Error('恢复事务文件引用异常，原记录未修改');
  const raw=await FS.readAsStringAsync(docs+ref.file);if(checksum(raw)!==ref.checksum)throw Error('恢复事务文件校验失败，原记录未修改');return raw;
}
async function prepareJournal(raw:string,id:string){
  let stored=raw;
  if(raw.length>262144){
    const file='soulmate_recovery_transaction.'+id+'.json',uri=docs+file,temp=uri+'.pending';
    await FS.writeAsStringAsync(temp,raw);if(await FS.readAsStringAsync(temp)!==raw)throw Error('恢复事务文件准备失败');
    await FS.moveAsync({from:temp,to:uri});if(await FS.readAsStringAsync(uri)!==raw)throw Error('恢复事务文件提交失败');
    stored=JSON.stringify({format:'soulmate.recovery-journal.file.v1',file,checksum:checksum(raw)});
  }
  await AsyncStorage.setItem(RECOVERY_JOURNAL,stored);if(await AsyncStorage.getItem(RECOVERY_JOURNAL)!==stored)throw Error('恢复事务未能安全准备，未开始覆盖');
}
export function validateBundle(value:any):value is RecoveryBundle {
  if(!value||value.format!=='soulmate.recovery.v1'||!Number.isFinite(value.createdAt)||!list(value.data)||checksum(JSON.stringify(value.data))!==value.checksum)return false;
  const d=value.data;
  return validConversations(d.conversations)&&validMoments(d.moments)&&list(d.groups)&&Object.entries(d.groups).every(([id,msgs])=>d.conversations.some((c:any)=>c.id===id&&c.type==='group')&&validGroupMessages(msgs))&&list(d.preferences)&&Object.entries(d.preferences).every(([key,v])=>preference(key)&&typeof v==='string')&&Array.isArray(d.media)&&d.media.every((m:any)=>m&&typeof m.uri==='string'&&typeof m.name==='string'&&/^[\w.-]+$/.test(m.name)&&m.name!=='.'&&m.name!=='..'&&typeof m.base64==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(m.base64));
}
const envelope=(data:BundleData):RecoveryBundle=>({format:'soulmate.recovery.v1',createdAt:Date.now(),data,checksum:checksum(JSON.stringify(data))});
export async function collectRecoveryBundle():Promise<RecoveryBundle>{
  await assertRecoveryReady();
  const c=await loadConversations();if(c.corrupt)throw Error('当前记录处于保护状态，无法把不完整数据导出为正常备份；请先导出原始记录');
  const groups:Record<string,any[]>={};for(const g of c.conversations.filter(c=>c.type==='group'))groups[g.id]=await loadGroupMessages(g.id);
  const preferences:Record<string,string>={};for(const key of (await AsyncStorage.getAllKeys()).filter(preference)){const raw=await AsyncStorage.getItem(key);if(raw!==null)preferences[key]=raw;}
  const media:BundleData['media']=[],dir=docs+'user-media/';
  if((await FS.getInfoAsync(dir)).exists)for(const name of await FS.readDirectoryAsync(dir)){if(!/^[\w.-]+$/.test(name))continue;const uri=dir+name;const info=await FS.getInfoAsync(uri);if(!info.isDirectory)media.push({uri,name,base64:await FS.readAsStringAsync(uri,{encoding:FS.EncodingType.Base64})});}
  const moments=await loadMoments();
  const referenced=new Set<string>();
  const visit=(value:any,key='')=>{if(typeof value==='string'&&['avatar','userAvatar','backgroundImage','bgImage','images'].includes(key)&&/^(file|content|ph):\/\//.test(value))referenced.add(value);else if(Array.isArray(value))value.forEach(v=>visit(v,key));else if(value&&typeof value==='object')Object.entries(value).forEach(([k,v])=>visit(v,k));};
  visit(c.conversations);visit(moments);for(const value of Object.values(preferences))try{visit(JSON.parse(value));}catch{/* Plain preference, not a JSON document. */}
  for(const uri of referenced)if(!media.some(m=>m.uri===uri)){
    try{const base64=await FS.readAsStringAsync(uri,{encoding:FS.EncodingType.Base64});media.push({uri,name:'linked_'+generateId()+'.bin',base64});}
    catch{throw Error('关联图片暂不可读，未生成缺图备份；请先导出原始记录或重新选择图片');}
  }
  const bundle=envelope({conversations:c.conversations,groups,moments,preferences,media});
  if(!validateBundle(bundle))throw Error('导出校验未通过，未生成不完整备份');return bundle;
}
async function saveDocument(name:string,text:string){
  if(Platform.OS!=='android')throw Error('此文件导出入口目前需要 Android 文件目录选择器');
  const permission=await FS.StorageAccessFramework.requestDirectoryPermissionsAsync();if(!permission.granted)return false;
  const uri=await FS.StorageAccessFramework.createFileAsync(permission.directoryUri,name,'application/json');
  await FS.writeAsStringAsync(uri,text);if(await FS.readAsStringAsync(uri)!==text)throw Error('导出文件回读校验失败');return true;
}
export async function exportRecoveryFile(){return saveDocument('Soulmate-'+Date.now()+'.json',JSON.stringify(await collectRecoveryBundle()));}
/** For protection mode: export original bytes without choosing a purportedly correct replica. */
export async function exportRawRecoveryFile(){
  const keys:Record<string,string|null>={},readFailures:string[]=[];
  let names:string[]=[];try{names=await AsyncStorage.getAllKeys();}catch{readFailures.push('数据库键列表');}
  for(const key of names)if(key.startsWith('@soulmate_')||key.startsWith('@agentsoul_'))try{keys[key]=await AsyncStorage.getItem(key);}catch{readFailures.push('数据库：'+key);}
  const rawFiles:Record<string,string>={};let extra:string[]=[];
  try{extra=(await FS.readDirectoryAsync(docs)).filter(name=>isGroupSnapshotFile(name)||isJournalFile(name));}catch{readFailures.push('文件目录列表');}
  for(const name of [...files,...extra,'soulmate_conversations.json','soulmate_conversations.bak.json'])try{if((await FS.getInfoAsync(docs+name)).exists)rawFiles[name]=await FS.readAsStringAsync(docs+name);}catch{readFailures.push('文件：'+name);}
  return saveDocument('Soulmate-original-'+Date.now()+'.json',JSON.stringify({format:'soulmate.raw-rescue.v1',createdAt:Date.now(),complete:!readFailures.length,readFailures,keys,files:rawFiles}));
}
export async function pickRecoveryFile():Promise<RecoveryBundle|null>{
  const picked=await File.pickFileAsync({mimeTypes:['application/json']});if(!picked||picked.canceled||!picked.result)return null;
  const raw=await new File(picked.result.uri).text();let bundle:any;try{bundle=JSON.parse(raw);}catch{throw Error('备份文件不是有效 JSON');}
  if(!validateBundle(bundle))throw Error('备份校验失败：格式、完整性或关联数据异常，原记录未修改');return bundle;
}
function mergeConversations(current:AgentSoulConversation[],incoming:AgentSoulConversation[]){
  const map=new Map(current.map(c=>[c.id,c]));
  for(const c of incoming){const existing=map.get(c.id);if(!existing){map.set(c.id,c);continue;}
    if(JSON.stringify(existing)===JSON.stringify(c))continue;
    const branch:StoryBranch={id:generateId(),label:'从备份恢复 · '+new Date().toLocaleString('zh-CN'),createdAt:Date.now(),messages:c.messages,memories:c.memories||[],memoryState:c.memoryState};
    map.set(c.id,hydrateStory({...existing,story:{activeId:existing.story?.activeId||'original:'+existing.id,revision:(existing.story?.revision||0)+1,branches:[...(existing.story?.branches||[]),...(c.story?.branches||[]).filter(b=>!existing.story?.branches.some(e=>e.id===b.id)&&b.id!==existing.story?.activeId),branch]}}));
  }return [...map.values()];
}
export async function restoreRecoveryBundle(bundle:RecoveryBundle){
  if(!validateBundle(bundle))throw Error('备份完整性校验失败，未修改记录');
  await assertRecoveryReady();
  const current=await loadConversations();
  let moments:Moment[]=[];try{moments=await loadMoments();}catch{/* Original unreadable bytes are retained in the journal below. */}
  const conversations=mergeConversations(current.conversations,bundle.data.conversations),groups={...bundle.data.groups};
  for(const c of current.conversations.filter(c=>c.type==='group')){const old=await loadGroupMessages(c.id).catch(()=>null);if(old){const ids=new Set(old.map(m=>m.id));groups[c.id]=[...old,...(groups[c.id]||[]).filter(m=>!ids.has(m.id))].sort((a,b)=>a.timestamp-b.timestamp);}}
  const mergedMoments=new Map(bundle.data.moments.map(m=>[m.id,m]));for(const m of moments){const other=mergedMoments.get(m.id);const ids=new Set(m.comments.map(c=>c.id));mergedMoments.set(m.id,{...m,comments:[...m.comments,...(other?.comments||[]).filter(c=>!ids.has(c.id))]});}
  const target=envelope({...bundle.data,conversations,groups,moments:[...mergedMoments.values()]});if(!validateBundle(target))throw Error('合并结果校验失败，原数据未修改');
  const keys:Record<string,string|null>={};
  const groupSnapshots=Object.keys(groups).map(groupSnapshotNames);
  const targets=new Set([...(await AsyncStorage.getAllKeys()).filter(k=>k.startsWith('@soulmate_')||k.startsWith('@agentsoul_')), ...Object.keys(groups).map(groupKey),...groupSnapshots.flatMap(s=>[s.key,s.key+':head']),...Object.keys(target.data.preferences),'@soulmate_conversations_commit_v1','@soulmate_conversations_commit_v1:head',CONTINUITY_KEY,CONTINUITY_KEY+':head','@soulmate_moments_commit_v1','@soulmate_moments_commit_v1:head']);
  for(const key of targets)if(key!==RECOVERY_JOURNAL&&!key.startsWith('@soulmate_recovery_archive_'))keys[key]=await AsyncStorage.getItem(key);
  const previousFiles:Record<string,string|null>={};for(const name of [...files,...groupSnapshots.flatMap(s=>[s.file,s.file+'.head',s.file+'.replica'])])previousFiles[name]=(await FS.getInfoAsync(docs+name)).exists?await FS.readAsStringAsync(docs+name):null;
  const journal:Journal={id:generateId(),target,previous:{keys,files:previousFiles}};const raw=JSON.stringify(journal);
  await prepareJournal(raw,journal.id);
  await resumeRecovery();
}
export async function resumeRecovery(){
  const stored=await AsyncStorage.getItem(RECOVERY_JOURNAL);if(!stored)throw Error('没有待继续的恢复事务');const raw=await journalText(stored);
  const journal=JSON.parse(raw) as Journal;if(!validateBundle(journal.target)||!journal.previous?.keys||!journal.previous?.files)throw Error('恢复事务格式异常，原始记录已保留');
  const mapping=new Map<string,string>();
  if(journal.target.data.media.length)await FS.makeDirectoryAsync(docs+'user-media/',{intermediates:true});
  for(const m of journal.target.data.media){const uri=docs+'user-media/recovered_'+journal.id+'_'+m.name;await FS.writeAsStringAsync(uri,m.base64,{encoding:FS.EncodingType.Base64});if(await FS.readAsStringAsync(uri,{encoding:FS.EncodingType.Base64})!==m.base64)throw Error('媒体恢复校验失败，事务保留供重试');mapping.set(m.uri,uri);}
  const target=JSON.parse(JSON.stringify(journal.target.data),(_key,value)=>typeof value==='string'&&mapping.has(value)?mapping.get(value):value) as BundleData;
  for(const [key,value] of Object.entries(target.preferences))try{target.preferences[key]=JSON.stringify(JSON.parse(value,(_k,v)=>typeof v==='string'&&mapping.has(v)?mapping.get(v):v));}catch{/* Preserve non-JSON preferences unchanged. */}
  for(const [key,value] of Object.entries(target.preferences)){await AsyncStorage.setItem(key,value);if(await AsyncStorage.getItem(key)!==value)throw Error('偏好恢复未成功');}
  for(const [id,messages] of Object.entries(target.groups)){const names=groupSnapshotNames(id);await new SnapshotStore(names.key,names.file,validGroupMessages,true).write(messages);}
  await new SnapshotStore<Moment[]>('@soulmate_moments_commit_v1','soulmate_moments.commit.json',validMoments,true).write(target.moments);
  await new SnapshotStore<AgentSoulConversation[]>('@soulmate_conversations_commit_v1','soulmate_conversations.commit.json',validConversations,true).write(target.conversations);
  await new SnapshotStore<AgentSoulConversation[]>(CONTINUITY_KEY,CONTINUITY_FILE,validConversations,true).write(target.conversations);
  // Keep pre-restore bytes as a user-invoked recovery archive. Never auto-delete them.
  const archive='@soulmate_recovery_archive_'+journal.id;await AsyncStorage.setItem(archive,stored);if(await AsyncStorage.getItem(archive)!==stored||await journalText(stored)!==raw)throw Error('恢复前原文归档未完成');
  await AsyncStorage.removeItem(RECOVERY_JOURNAL);
}
export async function rollbackPendingRecovery(){
  const stored=await AsyncStorage.getItem(RECOVERY_JOURNAL);if(!stored)throw Error('没有待撤回的恢复事务');const raw=await journalText(stored);
  const journal=JSON.parse(raw) as Journal;if(!journal.previous?.keys||!journal.previous?.files)throw Error('恢复前原文不可读，已停止撤回');
  for(const [key,value] of Object.entries(journal.previous.keys)){if(key===RECOVERY_JOURNAL)continue;if(value===null)await AsyncStorage.removeItem(key);else await AsyncStorage.setItem(key,value);if(await AsyncStorage.getItem(key)!==value)throw Error('撤回校验未完成');}
  for(const [name,value] of Object.entries(journal.previous.files)){if(!files.includes(name)&&!isGroupSnapshotFile(name))throw Error('恢复事务包含非法路径');const uri=docs+name;if(value===null)await FS.deleteAsync(uri,{idempotent:true});else{await FS.writeAsStringAsync(uri,value);if(await FS.readAsStringAsync(uri)!==value)throw Error('原始文件撤回未完成');}}
  await AsyncStorage.removeItem(RECOVERY_JOURNAL);
}
