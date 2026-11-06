const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./harness.cjs');
const {ui,character,until,button}=require('./ui-harness.cjs');
const MAIN='@agentsoul_conversations',COMMIT='@soulmate_conversations_commit_v1',CF='soulmate_conversations.commit.json',CONT='@soulmate_conversations_continuity_commit_v1';
const old=()=>({...character('old'),messages:[{id:'u',role:'user',content:'真实旧事件 🐈',timestamp:1},{id:'a',role:'assistant',content:'完整旧回复',timestamp:2,inReplyTo:'u'}],memories:[{id:'m',content:'旧事件记忆',tags:[],timestamp:2,weight:80,isFlashbulb:false,source:{scene:'private',characterId:'old',conversationId:'old',messageIds:['u','a'],replies:[{messageId:'a',versionId:'legacy:a:1'}]}}]});
const restart=f=>fixture({'@react-native-async-storage/async-storage':f.as,'expo-file-system/legacy':f.fm});
async function seed(f){const {SnapshotStore}=f.load('src/services/snapshotStore.ts');await new SnapshotStore(COMMIT,CF,Array.isArray).write([old()]);await new SnapshotStore(CONT,'soulmate_conversations.continuity.commit.json',Array.isArray).write([character('new')]);}

test('1.7.3 reproduction: a new continuation no longer silently masks the original history on restart',async()=>{
 const f=fixture();await seed(f);const original=f.kv.get(COMMIT);const s=f.load('src/services/agentsoulStorage.ts');const loaded=await s.loadConversations();
 assert.equal(loaded.conversations[0].id,'new');assert.equal(loaded.recoverableCount,1);assert.equal(loaded.corrupt,true);
 const preview=await s.inspectOriginalHistory(loaded.conversations);assert.equal(preview.count,1);assert.equal(preview.messages,2);
 const plan=await s.prepareOriginalHistoryCopies(loaded.conversations,preview.token);assert.equal(plan.conversations.length,2);const copy=plan.copies[0];
 assert.notEqual(copy.id,'old');assert.equal(copy.messages[0].content,'真实旧事件 🐈');assert.equal(copy.memories[0].source.characterId,copy.id);assert.equal(copy.memories[0].source.conversationId,copy.id);
 await s.writeConversationsImmediate(plan.conversations);assert.equal(f.kv.get(COMMIT),original);
 const next=await restart(f).load('src/services/agentsoulStorage.ts').loadConversations();assert.equal(next.corrupt,false);assert.equal(next.conversations.length,2);assert.equal(next.conversations[1].messages.length,2);
});

test('after a formerly unreadable old row becomes readable, explicit recovery retains both new and old chats',async()=>{
 const f=fixture();f.kv.set(MAIN,JSON.stringify([old()]));let fail=true;const get=f.as.getItem;f.as.getItem=async k=>{if(k===MAIN&&fail)throw Error('Row too big to fit into CursorWindow');return get(k);};
 const s=f.load('src/services/agentsoulStorage.ts');assert.equal((await s.loadConversations()).conversations.length,0);await s.writeConversationsImmediate([character('new')]);fail=false;
 const again=restart(f).load('src/services/agentsoulStorage.ts'),loaded=await again.loadConversations();assert.equal(loaded.recoverableCount,1);assert.equal(loaded.conversations[0].id,'new');assert.ok(f.kv.get(MAIN).includes('真实旧事件'));
});

test('provider recovery persists copies before showing success and can reopen the found chat',async()=>{
 const h=ui();await seed(h.f);const Provider=h.f.load('src/contexts/AgentSoulContext.tsx').AgentSoulProvider;h.host.start(()=>Provider({children:null}));const api=()=>h.host.tree.props.value;
 try{await until(()=>api().conversations.length===1);const preview=await api().inspectHistoryRecovery();assert.equal(await api().recoverHistoryCopies(preview.token),1);assert.equal(api().conversations.length,2);assert.equal(api().activeConversation.messages[0].content,'真实旧事件 🐈');assert.equal(api().activeConversation.memories[0].content,'旧事件记忆');assert.equal((await restart(h.f).load('src/services/agentsoulStorage.ts').loadConversations()).conversations.length,2);}finally{h.host.close();}
});

test('a damaged newer deletion is never bypassed by recovering a valid older replica',async()=>{
 const f=fixture(),{SnapshotStore}=f.load('src/services/snapshotStore.ts');const store=new SnapshotStore(COMMIT,CF,Array.isArray);await store.write([old()]);f.faults.file=true;await store.write([]);f.faults.file=false;f.kv.set(COMMIT,'truncated');
 const s=f.load('src/services/agentsoulStorage.ts');assert.equal((await s.inspectOriginalHistory([character('new')])).count,0);assert.equal((await s.loadConversations()).conversations.length,0);
});

test('one invalid conversation cannot hide valid peers in the same checksum-verified latest snapshot',async()=>{
 const f=fixture(),{SnapshotStore}=f.load('src/services/snapshotStore.ts');await new SnapshotStore(COMMIT,CF,Array.isArray).write([old(),{...character('bad'),memories:[null]}]);const bytes=f.kv.get(COMMIT);
 const s=f.load('src/services/agentsoulStorage.ts'),loaded=await s.loadConversations();assert.equal(loaded.corrupt,true);assert.equal(loaded.conversations.length,1);assert.equal(loaded.conversations[0].id,'old');assert.equal(f.kv.get(COMMIT),bytes);
 const report=(await s.inspectOriginalHistory([])).diagnostic;assert.match(report,/conversation\[1\].MEMORY_FIELDS_OR_OWNER/);assert.ok(!report.includes('真实旧事件'));assert.ok(!report.includes('完整旧回复'));assert.ok(!report.includes('旧事件记忆'));
});

test('partial recovery is not allowed to select older valid business data over latest invalid business data',async()=>{
 const f=fixture(),{SnapshotStore}=f.load('src/services/snapshotStore.ts');const store=new SnapshotStore(COMMIT,CF,Array.isArray);await store.write([old()]);f.faults.file=true;await store.write([{...character('bad'),memories:[null]}]);f.faults.file=false;
 const s=f.load('src/services/agentsoulStorage.ts');assert.equal((await s.loadConversations()).conversations.length,0);assert.equal((await s.inspectOriginalHistory([])).count,0);
});

test('explicit deletion tombstones are not advertised as missing history',async()=>{
 const f=fixture();await seed(f);const c={...old(),messages:[],story:{activeId:'x',revision:1,branches:[],deletedIds:['u','a']}};
 const s=f.load('src/services/agentsoulStorage.ts');assert.equal((await s.inspectOriginalHistory([c])).count,0);
});

test('a changed source requires a new preview instead of restoring unseen data',async()=>{
 const f=fixture();await seed(f);const s=f.load('src/services/agentsoulStorage.ts'),preview=await s.inspectOriginalHistory([character('new')]);const {SnapshotStore}=f.load('src/services/snapshotStore.ts');await new SnapshotStore(COMMIT,CF,Array.isArray).write([{...old(),name:'changed'}]);
 await assert.rejects(s.prepareOriginalHistoryCopies([character('new')],preview.token),/已变化/);
});

test('copy failure reports failure and does not replace the currently displayed conversation or originals',async()=>{
 const h=ui();await seed(h.f);const original=h.f.kv.get(COMMIT),Provider=h.f.load('src/contexts/AgentSoulContext.tsx').AgentSoulProvider;h.host.start(()=>Provider({children:null}));const api=()=>h.host.tree.props.value;
 try{await until(()=>api().conversations.length===1);const preview=await api().inspectHistoryRecovery();h.f.faults.kv=h.f.faults.file=true;await assert.rejects(api().recoverHistoryCopies(preview.token));assert.equal(api().conversations.length,1);assert.equal(h.f.kv.get(COMMIT),original);}finally{h.host.close();}
});

test('sidebar reread offers an explicit recovery choice and does not import without confirmation',async()=>{
 let restored=0,reads=0;const h=ui({api:{storageUncertain:true,storageWarning:'未读取',loadList:async()=>{reads++;},inspectHistoryRecovery:async()=>({count:1,messages:2,token:'t',diagnostic:'metadata'}),recoverHistoryCopies:async t=>{assert.equal(t,'t');restored++;return 1;}}});
 try{h.start('screens/AgentSoulSidebar');await button(h.host.tree,'重新读取').props.onPress();assert.equal(reads,1);assert.equal(restored,0);const alert=h.alerts.find(v=>v[0]==='找到历史记录');assert.ok(alert);await alert[2].find(b=>b.text==='找回记录').onPress();assert.equal(restored,1);}finally{h.host.close();}
});

test('native large-row patch is narrow, idempotent and refuses unknown library source',()=>{
 const {patch}=require('../scripts/patch-android-storage.cjs');const file=path.join(__dirname,'../node_modules/@react-native-async-storage/async-storage/android/src/main/kotlin/org/asyncstorage/legacy_storage/LegacyStorageSupplier.kt');const before=fs.readFileSync(file,'utf8'),after=patch(before);
 assert.equal(patch(after),after);assert.match(after,/SQLiteBlobTooBigException/);assert.match(after,/substr\(CAST\(value AS BLOB\), :start, :count\)/);assert.match(after,/CodingErrorAction.REPORT/);
 assert.equal(after.slice(after.indexOf('private object MIGRATION_TO_NEXT')),before.slice(before.indexOf('private object MIGRATION_TO_NEXT')));assert.throws(()=>patch('unknown source'));
 assert.throws(()=>patch(after.replace('offset += count','offset += 1')),/incomplete or changed/);
});

test('a legacy invalid peer is isolated without dropping a whole valid conversation or mutating its bytes',async()=>{
 const f=fixture(),raw=JSON.stringify([old(),{...character('bad'),memories:[null]}]);f.kv.set(MAIN,raw);const s=f.load('src/services/agentsoulStorage.ts');
 const loaded=await s.loadConversations();assert.equal(loaded.corrupt,true);assert.equal(loaded.conversations[0].id,'old');assert.equal(loaded.conversations.length,1);assert.equal(f.kv.get(MAIN),raw);
});

test('group members, sender identity and separate legacy persona memories survive explicit recovery',async()=>{
 const h=ui(),c=old(),memories=c.memories;delete c.memories;const group={...character('g'),type:'group',memberIds:['old']};
 h.f.kv.set(MAIN,JSON.stringify([c,group]));h.f.kv.set('@soulmate_ai_personas',JSON.stringify({old:{id:'old',memories}}));
 h.f.kv.set('@soulmate_group_msgs_g',JSON.stringify([{id:'gu',role:'user',content:'群中旧问题',timestamp:1},{id:'ga',role:'assistant',senderId:'old',inReplyTo:'gu',content:'群中旧回复',timestamp:2}]));
 const {SnapshotStore}=h.f.load('src/services/snapshotStore.ts');await new SnapshotStore(CONT,'soulmate_conversations.continuity.commit.json',Array.isArray).write([character('new')]);
 const before=new Map(h.f.kv);const Provider=h.f.load('src/contexts/AgentSoulContext.tsx').AgentSoulProvider;h.host.start(()=>Provider({children:null}));const api=()=>h.host.tree.props.value;
 try{await until(()=>api().conversations.length===1);const preview=await api().inspectHistoryRecovery();assert.equal(await api().recoverHistoryCopies(preview.token),2);
 const role=api().conversations.find(c=>c.recoveredFrom?.conversationId==='old'),g=api().conversations.find(c=>c.recoveredFrom?.conversationId==='g');assert.equal(g.memberIds[0],role.id);assert.equal(role.memories[0].content,'旧事件记忆');assert.equal(role.memories[0].source.characterId,role.id);
 const messages=await h.f.load('src/services/groupStorage.ts').loadGroupMessages(g.id);assert.equal(messages[1].senderId,role.id);assert.equal(messages[1].content,'群中旧回复');assert.equal(h.f.kv.get(MAIN),before.get(MAIN));assert.equal(h.f.kv.get('@soulmate_group_msgs_g'),before.get('@soulmate_group_msgs_g'));assert.equal(h.f.kv.get('@soulmate_ai_personas'),before.get('@soulmate_ai_personas'));
 }finally{h.host.close();}
});

test('a save-only legacy recovery action cannot report success while original history is still unreadable',async()=>{
 const f=fixture();await seed(f);f.kv.set(COMMIT,'broken');f.files.set('file://docs/'+CF,'broken');const s=f.load('src/services/agentsoulStorage.ts');assert.equal((await s.loadConversations()).corrupt,true);assert.equal(await s.restoreCorruptBackup(),false);
});

test('saving a new chat cannot dismiss the unresolved-original warning or disable its recovery entry',async()=>{
 const f=fixture();await seed(f);const s=f.load('src/services/agentsoulStorage.ts');const loaded=await s.loadConversations();assert.equal(s.isStorageUncertain(),true);
 await s.writeConversationsImmediate([{...loaded.conversations[0],name:'新会话继续保存'}]);assert.equal(s.isStorageUncertain(),true);assert.equal((await s.inspectOriginalHistory(loaded.conversations)).count,1);
});

test('partial salvage remains visibly incomplete after continuation saves and restart',async()=>{
 const f=fixture(),{SnapshotStore}=f.load('src/services/snapshotStore.ts');await new SnapshotStore(COMMIT,CF,Array.isArray).write([old(),{...character('bad'),memories:[null]}]);
 const s=f.load('src/services/agentsoulStorage.ts'),loaded=await s.loadConversations();await s.writeConversationsImmediate(loaded.conversations);assert.equal(s.isStorageUncertain(),true);
 assert.equal((await restart(f).load('src/services/agentsoulStorage.ts').loadConversations()).corrupt,true);
});
