const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./harness.cjs');
const {ui,character,nodes,tick,until}=require('./ui-harness.cjs');
const plain=v=>JSON.parse(JSON.stringify(v));
const MAIN='@agentsoul_conversations',COMMIT='@soulmate_conversations_commit_v1',FILE='file://docs/soulmate_conversations.commit.json';
const role=()=>({...character(),settings:{...character().settings,memoryRecall:{enabled:false,interval:10}},messages:[{id:'old-u',role:'user',content:'原有用户消息',timestamp:1},{id:'old-a',role:'assistant',content:'原有完整回复',timestamp:2,inReplyTo:'old-u'}]});
const response=text=>new Response('data:'+JSON.stringify({choices:[{delta:{content:text},finish_reason:'stop'}]})+'\n\ndata:[DONE]\n\n');
const restart=f=>fixture({'@react-native-async-storage/async-storage':f.as,'expo-file-system/legacy':f.fm});
const unchanged=(f,before)=>{for(const [k,v]of before.kv)assert.equal(f.kv.get(k),v,k);for(const [k,v]of before.files)assert.equal(f.files.get(k),v,k);};
const original=f=>({kv:new Map(f.kv),files:new Map(f.files)});
async function mount(seed,fetch){let calls=0,bodies=[];const h=ui({mocks:{fetch:async(...args)=>{calls++;bodies.push(JSON.parse(args[1].body));return fetch?fetch(...args):response('模型真实返回的测试回复');}}});await seed(h.f);const Provider=h.f.load('src/contexts/AgentSoulContext.tsx').AgentSoulProvider;h.host.start(()=>Provider({children:null}));await until(()=>h.host.tree.props.value.hasApiKey);h.apiNow=()=>h.host.tree.props.value;h.calls=()=>calls;h.bodies=bodies;return h;}

test('a corrupt obsolete backup does not lock valid primary history',async()=>{
 const f=fixture();const c=role();f.kv.set(MAIN,JSON.stringify([c]));f.kv.set(MAIN+'_backup','broken obsolete backup');const s=f.load('src/services/agentsoulStorage.ts');const loaded=await s.loadConversations();assert.equal(loaded.corrupt,false);assert.equal(loaded.conversations[0].messages.length,2);await s.writeConversationsImmediate(loaded.conversations);assert.equal(f.kv.get(MAIN+'_backup'),'broken obsolete backup');assert.equal(f.kv.has(s.CONTINUITY_KEY),false);
});

test('legacy copy conflict permits real send, preserves every original byte and restarts with new messages',async()=>{
 const h=await mount(f=>{f.kv.set(MAIN,JSON.stringify([role()]));f.files.set('file://docs/soulmate_conversations.json',JSON.stringify([{...role(),messages:[],updatedAt:99}]));f.kv.set('@agentsoul_active','a');});
 try{assert.equal(h.apiNow().storageUncertain,true);const before=original(h.f);await h.apiNow().sendMessage('冲突后继续聊天');assert.equal(h.calls(),1);assert.equal(h.apiNow().isStreaming,false);assert.equal(h.apiNow().conversations[0].messages.length,4);assert.ok(!h.apiNow().conversations[0].messages.at(-1).error);unchanged(h.f,before);const loaded=await restart(h.f).load('src/services/agentsoulStorage.ts').loadConversations();assert.equal(loaded.corrupt,false);assert.equal(loaded.conversations[0].messages.length,4);assert.ok(loaded.conversations[0].messages.some(m=>m.content==='冲突后继续聊天'));}finally{h.host.close();}
});

test('a damaged replica can continue from its doubly attested peer without repairing original storage',async()=>{
 const h=await mount(async f=>{const s=f.load('src/services/agentsoulStorage.ts');await s.loadConversations();await s.writeConversationsImmediate([role()]);f.files.set(FILE,'truncated peer');f.kv.set('@agentsoul_active','a');});
 try{assert.equal(h.apiNow().conversations[0].messages.length,2);const before=original(h.f);await h.apiNow().sendMessage('仍记得前文吗');assert.equal(h.calls(),1);assert.ok(h.bodies[0].messages.some(m=>m.content==='原有完整回复'));unchanged(h.f,before);assert.equal((await restart(h.f).load('src/services/agentsoulStorage.ts').loadConversations()).conversations[0].messages.length,4);}finally{h.host.close();}
});

test('a broken newer deletion never reactivates older history, while a fresh chat remains possible',async()=>{
 const h=await mount(async f=>{const s=f.load('src/services/agentsoulStorage.ts');await s.loadConversations();await s.writeConversationsImmediate([role()]);f.faults.file=true;await s.writeConversationsImmediate([]);f.faults.file=false;f.kv.set(COMMIT,f.kv.get(COMMIT).slice(0,30));});
 try{assert.equal(h.apiNow().conversations.length,0);const before=original(h.f);await h.apiNow().sendMessage('创建新的对话');assert.equal(h.calls(),1);assert.equal(h.apiNow().conversations.length,1);assert.equal(h.apiNow().conversations[0].messages.length,2);assert.ok(!JSON.stringify(h.bodies).includes('原有完整回复'));unchanged(h.f,before);const loaded=await restart(h.f).load('src/services/agentsoulStorage.ts').loadConversations();assert.equal(loaded.conversations[0].messages.length,2);}finally{h.host.close();}
});

test('invalid legacy business data is kept byte for byte and does not prevent a new chat',async()=>{
 const raw=JSON.stringify([{...role(),memories:[null]}]);const h=await mount(f=>f.kv.set(MAIN,raw));try{await h.apiNow().sendMessage('新消息仍能发送');assert.equal(h.calls(),1);assert.equal(h.f.kv.get(MAIN),raw);assert.equal(h.apiNow().isStreaming,false);assert.equal(h.apiNow().conversations[0].messages.length,2);}finally{h.host.close();}
});

test('disk failure cannot suppress a model request or mark its successful reply as failed',async()=>{
 const h=await mount(f=>{f.kv.set(MAIN,JSON.stringify([role()]));f.kv.set('@agentsoul_active','a');});try{h.f.faults.kv=h.f.faults.file=true;await h.apiNow().sendMessage('写入失败也继续');assert.equal(h.calls(),1);assert.equal(h.apiNow().isStreaming,false);const c=h.apiNow().conversations[0];assert.equal(c.messages.length,4);assert.equal(c.messages.at(-1).content,'模型真实返回的测试回复');assert.ok(!c.messages.at(-1).error);assert.match(h.apiNow().storageWarning,/未保存/);const before=plain(c);await h.apiNow().loadList();assert.deepEqual(plain(h.apiNow().conversations[0]),before);await h.apiNow().sendMessage('接着聊第二轮');assert.equal(h.calls(),2);assert.ok(h.bodies[1].messages.some(m=>m.content==='写入失败也继续'));assert.equal(h.apiNow().conversations[0].messages.length,6);h.f.faults.kv=h.f.faults.file=false;assert.equal(await h.apiNow().retryPendingSave(),true);const loaded=await restart(h.f).load('src/services/agentsoulStorage.ts').loadConversations();assert.equal(loaded.conversations[0].messages.length,6);}finally{h.host.close();}
});

test('new conversation and first reply remain available when both engines fail to write',async()=>{
 const h=await mount(()=>{});try{h.f.faults.kv=h.f.faults.file=true;await h.apiNow().sendMessage('第一条消息');assert.equal(h.calls(),1);assert.equal(h.apiNow().activeConversation.messages.length,2);assert.equal(h.apiNow().isStreaming,false);h.f.faults.kv=h.f.faults.file=false;assert.equal(await h.apiNow().retryPendingSave(),true);assert.equal((await restart(h.f).load('src/services/agentsoulStorage.ts').loadConversations()).conversations[0].messages.length,2);}finally{h.host.close();}
});

test('API errors release the request even during disk failures, and next messages can retry',async()=>{
 let fail=true;const h=await mount(f=>{f.kv.set(MAIN,JSON.stringify([role()]));f.kv.set('@agentsoul_active','a');},async()=>fail?new Response(JSON.stringify({error:{message:'invalid API key'}}),{status:401}):response('第二次成功'));
 try{h.f.faults.kv=h.f.faults.file=true;await h.apiNow().sendMessage('失败的一轮');assert.equal(h.apiNow().isStreaming,false);assert.ok(h.apiNow().conversations[0].messages.at(-1).error);fail=false;await h.apiNow().sendMessage('重新发送');assert.equal(h.calls(),2);assert.equal(h.apiNow().conversations[0].messages.at(-1).content,'第二次成功');assert.ok(!h.apiNow().conversations[0].messages.at(-1).error);}finally{h.host.close();}
});

test('rereading during streaming cannot remove the in-flight message or already received reply',async()=>{
 let finish;const h=await mount(f=>{f.kv.set(MAIN,JSON.stringify([role()]));f.kv.set('@agentsoul_active','a');},async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data:{"choices":[{"delta":{"content":"已收到的片段"}}]}\n\n'));finish=()=>{controller.enqueue(new TextEncoder().encode('data:[DONE]\n\n'));controller.close();};}})));
 try{const sending=h.apiNow().sendMessage('开始生成');await until(()=>h.apiNow().conversations[0].messages.at(-1)?.content==='已收到的片段');await h.apiNow().loadList();assert.equal(h.apiNow().conversations[0].messages.at(-1).content,'已收到的片段');finish();await sending;finish=null;assert.equal(h.apiNow().conversations[0].messages.length,4);assert.equal(h.apiNow().isStreaming,false);}finally{finish?.();h.host.close();}
});

test('a second damaged continuation is archived before replacement, retaining original bytes',async()=>{
 const f=fixture(),s=f.load('src/services/agentsoulStorage.ts');f.kv.set(MAIN,JSON.stringify([role()]));f.files.set('file://docs/soulmate_conversations.json','broken original');await s.loadConversations();await s.writeConversationsImmediate([role()]);const uri='file://docs/'+s.CONTINUITY_FILE;f.files.set(uri,'broken continuation');const before=[f.kv.get(s.CONTINUITY_KEY),f.files.get(uri),f.kv.get(s.CONTINUITY_KEY+':head'),f.files.get(uri+'.head'),f.files.get(uri+'.replica')??null];const fresh=restart(f),store=fresh.load('src/services/agentsoulStorage.ts');assert.equal((await store.loadConversations()).corrupt,true);await store.writeConversationsImmediate([role()]);const archives=[...f.kv.entries()].filter(([k])=>k.startsWith('@soulmate_recovery_archive_continuity_'));assert.equal(archives.length,1);assert.deepEqual(JSON.parse(archives[0][1]).values,before);assert.equal(f.files.get('file://docs/soulmate_conversations.json'),'broken original');assert.equal((await restart(f).load('src/services/agentsoulStorage.ts').loadConversations()).corrupt,false);
});

test('an unreadable newer receipt cannot authorize the older snapshot as continuation history',async()=>{
 const f=fixture(),{SnapshotStore}=f.load('src/services/snapshotStore.ts');const s=new SnapshotStore('k','k.json',Array.isArray);await s.write(['old deleted content']);f.faults.file=true;await s.write([]);f.faults.file=false;f.kv.delete('k');const read=await new SnapshotStore('k','k.json',Array.isArray).read();assert.equal(read.value,null);assert.equal(read.available,undefined);assert.equal(read.damaged,true);
});

test('storage warning never disables the actual input and send handler',async()=>{
 let sent;const h=ui({api:{storageUncertain:true,storageWarning:'历史副本异常',sendMessage:async text=>{sent=text;}}});try{h.start('screens/AgentSoulChatScreen');const input=nodes(h.host.tree,n=>n.type==='TextInput'&&n.props.placeholder==='说点什么...')[0];assert.notEqual(input.props.editable,false);input.props.onChangeText('还能发送');await tick();await nodes(h.host.tree,n=>n.props.accessibilityLabel==='发送消息')[0].props.onPress();assert.equal(sent,'还能发送');}finally{h.host.close();}
});

test('an unfinished recovery cannot be overwritten, but does not prevent a model reply',async()=>{
 const journal='original unfinished recovery transaction';const h=await mount(f=>{f.kv.set(MAIN,JSON.stringify([role()]));f.kv.set('@soulmate_recovery_transaction',journal);});try{const before=original(h.f);await h.apiNow().sendMessage('恢复未完成也可以聊天');assert.equal(h.calls(),1);assert.equal(h.apiNow().isStreaming,false);assert.equal(h.apiNow().activeConversation.messages.at(-1).content,'模型真实返回的测试回复');unchanged(h.f,before);assert.match(h.apiNow().storageWarning,/未保存/);h.f.kv.delete('@soulmate_recovery_transaction');assert.equal(await h.apiNow().retryPendingSave(),true);const loaded=await restart(h.f).load('src/services/agentsoulStorage.ts').loadConversations();assert.equal(loaded.conversations[0].messages.length,2);}finally{h.host.close();}
});

test('an unreadable oversized key cannot hide newer file messages or be overwritten during continued saves',async()=>{
 const f=fixture(),key='@soulmate_conversations_continuity_commit_v1';f.kv.set(MAIN,JSON.stringify([role()]));f.files.set('file://docs/soulmate_conversations.json','broken original');const get=f.as.getItem;f.as.getItem=async k=>{if(k===key&&f.kv.has(k))throw Error('Row too big to fit into CursorWindow');return get(k);};
 const s=f.load('src/services/agentsoulStorage.ts');await s.loadConversations();await s.writeConversationsImmediate([role()]);const unreadable=f.kv.get(key);const fresh=restart(f),next=fresh.load('src/services/agentsoulStorage.ts');const loaded=await next.loadConversations();assert.equal(loaded.conversations[0].messages.length,2);loaded.conversations[0].messages.push({id:'later',role:'user',content:'文件中的新消息',timestamp:3});await next.writeConversationsImmediate(loaded.conversations);assert.equal(f.kv.get(key),unreadable);const loadedAgain=await restart(f).load('src/services/agentsoulStorage.ts').loadConversations();assert.equal(loadedAgain.conversations[0].messages.at(-1).content,'文件中的新消息');assert.equal(f.files.get('file://docs/soulmate_conversations.json'),'broken original');
});

test('failure to preserve a damaged continuation keeps all bytes intact without blocking chat',async()=>{
 let block=true;
 const h=await mount(async f=>{f.kv.set(MAIN,JSON.stringify([role()]));f.files.set('file://docs/soulmate_conversations.json','broken original');const s=f.load('src/services/agentsoulStorage.ts');await s.loadConversations();await s.writeConversationsImmediate([role()]);f.files.set('file://docs/'+s.CONTINUITY_FILE,'broken continuation');const set=f.as.setItem,write=f.fm.writeAsStringAsync;f.as.setItem=async(k,v)=>{if(block&&k.startsWith('@soulmate_recovery_archive_continuity_'))throw Error('archive failed');return set(k,v);};f.fm.writeAsStringAsync=async(k,v)=>{if(block&&k.includes('recovery_archive_continuity_'))throw Error('archive failed');return write(k,v);};f.kv.set('@agentsoul_active','a');});
 try{const before=original(h.f);await h.apiNow().sendMessage('原文保护失败也能收到回复');assert.equal(h.calls(),1);assert.equal(h.apiNow().isStreaming,false);assert.equal(h.apiNow().conversations[0].messages.length,4);unchanged(h.f,before);assert.match(h.apiNow().storageWarning,/未保存/);block=false;assert.equal(await h.apiNow().retryPendingSave(),true);assert.equal((await restart(h.f).load('src/services/agentsoulStorage.ts').loadConversations()).conversations[0].messages.length,4);}finally{h.host.close();}
});

test('explicit recovery and rollback keep continuation snapshots aligned with original snapshots',async()=>{
 const {recoveryFixture}=require('./recovery-test-helpers.cjs');const source=recoveryFixture();source.kv.set(MAIN,JSON.stringify([role()]));const bundle=await source.load('src/services/recoveryBundle.ts').collectRecoveryBundle();
 const dest=recoveryFixture();dest.kv.set(MAIN,JSON.stringify([{...role(),name:'当前角色'}]));dest.files.set('file://docs/soulmate_conversations.json','conflict');const s=dest.load('src/services/agentsoulStorage.ts');await s.loadConversations();await s.writeConversationsImmediate([{...role(),name:'当前角色'}]);const recover=dest.load('src/services/recoveryBundle.ts');await recover.restoreRecoveryBundle(plain(bundle));assert.equal((await restart(dest).load('src/services/agentsoulStorage.ts').loadConversations()).conversations[0].name,'当前角色');const latest=JSON.parse(JSON.parse(dest.kv.get(s.CONTINUITY_KEY)).payload);assert.ok(latest[0].story.branches.length);const roundtrip=await recover.collectRecoveryBundle();assert.ok(roundtrip.data.conversations[0].story.branches.length);
 const set=dest.as.setItem;dest.as.setItem=async(k,v)=>{if(k.startsWith('@soulmate_recovery_archive_'))throw Error('archive failed');return set(k,v);};const beforeKv=dest.kv.get(s.CONTINUITY_KEY),beforeFile=dest.files.get('file://docs/'+s.CONTINUITY_FILE);await assert.rejects(recover.restoreRecoveryBundle(plain(bundle)));dest.as.setItem=set;await recover.rollbackPendingRecovery();assert.equal(dest.kv.get(s.CONTINUITY_KEY),beforeKv);assert.equal(dest.files.get('file://docs/'+s.CONTINUITY_FILE),beforeFile);
});
