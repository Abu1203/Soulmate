const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./harness.cjs');
const {ui,character,nodes,label,button,tick,until}=require('./ui-harness.cjs');
const plain=v=>JSON.parse(JSON.stringify(v));
const response=text=>new Response('data:'+JSON.stringify({choices:[{delta:{content:text},finish_reason:'stop'}]})+'\n\ndata:[DONE]\n\n');
async function provider(mocks={},seed){const h=ui({mocks:{fetch:async()=>response('真正的回复'),...mocks}});const c={...character(),settings:{...character().settings,memoryRecall:{enabled:false,interval:10}}};h.f.kv.set('@agentsoul_conversations',JSON.stringify([c]));h.f.kv.set('@agentsoul_active','a');await seed?.(h.f);const Provider=h.f.load('src/contexts/AgentSoulContext.tsx').AgentSoulProvider;h.host.start(()=>Provider({children:null}));h.api=()=>h.host.tree.props.value;await until(()=>h.api().activeConversation&&h.api().hasApiKey);return h;}

test('large snapshots retain their format and full history without creating oversized Android database rows',async()=>{
 const f=fixture(),{SnapshotStore}=f.load('src/services/snapshotStore.ts'),small=['original'],large=['完整思考与聊天'.repeat(90000)];
 const s=new SnapshotStore('k','k.json',Array.isArray);await s.write(small);const old=f.kv.get('k');const set=f.as.setItem;let largeAttempts=0;
 f.as.setItem=async(k,v)=>{if(k==='k'&&v.length>262144){largeAttempts++;throw Error('database row limit');}return set(k,v);};
 await s.write(large);assert.equal(largeAttempts,0);assert.equal(f.kv.get('k'),old);
 const disk=JSON.parse(f.files.get('file://docs/k.json'));assert.equal(disk.format,'soulmate.snapshot.v1');assert.equal(JSON.parse(disk.payload)[0],large[0]);
 const read=await new SnapshotStore('k','k.json',Array.isArray).read();assert.equal(read.damaged,false);assert.deepEqual(plain(read.value),large);
  assert.equal(f.files.get('file://docs/k.json.replica'),f.files.get('file://docs/k.json'));
  f.files.delete('file://docs/k.json');const withReplica=await new SnapshotStore('k','k.json',Array.isArray).read();assert.equal(withReplica.damaged,false);assert.deepEqual(plain(withReplica.value),large);
});

test('a damaged latest large-file replica never resurrects the older database history',async()=>{
 const f=fixture(),{SnapshotStore}=f.load('src/services/snapshotStore.ts'),s=new SnapshotStore('k','k.json',Array.isArray);
 await s.write(['deleted later']);const write=f.fm.writeAsStringAsync;
 f.fm.writeAsStringAsync=async(k,v)=>{if(k==='file://docs/k.json.pending')throw Error('primary write failed');return write(k,v);};
 await s.write(['current'.repeat(50000)]);const replica=JSON.parse(f.files.get('file://docs/k.json.replica'));replica.payload='[broken';f.files.set('file://docs/k.json.replica',JSON.stringify(replica));
 const result=await new SnapshotStore('k','k.json',Array.isArray).read();assert.equal(result.damaged,true);assert.equal(result.value,null);assert.equal(result.available,undefined);assert.ok(f.kv.get('k').includes('deleted later'));
});

test('a conflicting third snapshot at the same revision cannot bypass conflict detection',async()=>{
 const f=fixture(),{SnapshotStore,checksum}=f.load('src/services/snapshotStore.ts');await new SnapshotStore('k','k.json',Array.isArray).write(['valid']);
 const other=JSON.parse(f.kv.get('k'));other.payload='["conflicting"]';other.checksum=checksum(other.payload);f.files.set('file://docs/k.json.replica',JSON.stringify(other));
 const result=await new SnapshotStore('k','k.json',Array.isArray).read();assert.equal(result.damaged,true);assert.equal(result.value,null);
});

test('long group history survives Android-sized row read failures and restart without changing its legacy bytes',async()=>{
 const f=fixture(),key='@soulmate_group_msgs_g',old=JSON.stringify([{id:'old',role:'user',content:'旧群聊',timestamp:1}]);f.kv.set(key,old);const get=f.as.getItem;
 f.as.getItem=async k=>{const raw=await get(k);if(raw&&raw.length>262144)throw Error('Row too big to fit into CursorWindow');return raw;};
 const s=f.load('src/services/groupStorage.ts');await s.appendGroupMessage('g',{id:'new',role:'user',content:'不可截断的群聊记录'.repeat(50000),timestamp:2});
 assert.equal(f.kv.get(key),old);const restarted=fixture({'@react-native-async-storage/async-storage':f.as,'expo-file-system/legacy':f.fm});const messages=await restarted.load('src/services/groupStorage.ts').loadGroupMessages('g');assert.equal(messages.length,2);assert.equal(messages[1].content.length,'不可截断的群聊记录'.repeat(50000).length);
});

test('group deletion stays deleted after restart while obsolete legacy history remains protected',async()=>{
 const f=fixture(),s=f.load('src/services/groupStorage.ts');await s.appendGroupMessage('g',{id:'u',role:'user',content:'已删除群聊',timestamp:1});await s.removeGroupMessages('g');
 f.kv.set('@soulmate_group_msgs_g',JSON.stringify([{id:'old',role:'user',content:'过时副本',timestamp:1}]));
 const fresh=fixture({'@react-native-async-storage/async-storage':f.as,'expo-file-system/legacy':f.fm});assert.equal((await fresh.load('src/services/groupStorage.ts').loadGroupMessages('g')).length,0);
});

test('group snapshots participate in restore and exact rollback rather than masking the restored group',async()=>{
 const {recoveryFixture}=require('./recovery-test-helpers.cjs');const make=async(text)=>{const f=recoveryFixture(),g={...character('g'),type:'group',memberIds:['a']};f.kv.set('@agentsoul_conversations',JSON.stringify([character(),g]));await f.load('src/services/groupStorage.ts').appendGroupMessage('g',{id:text,role:'user',content:text,timestamp:1});return f;};
 const source=await make('备份中的群聊'),bundle=await source.load('src/services/recoveryBundle.ts').collectRecoveryBundle(),dest=await make('当前群聊');const recovery=dest.load('src/services/recoveryBundle.ts');
 await recovery.restoreRecoveryBundle(plain(bundle));assert.equal((await dest.load('src/services/groupStorage.ts').loadGroupMessages('g')).length,2);
 const originalFiles=new Map(dest.files),originalKv=new Map(dest.kv),set=dest.as.setItem;dest.as.setItem=async(k,v)=>{if(k.startsWith('@soulmate_recovery_archive_'))throw Error('archive failed');return set(k,v);};
 await assert.rejects(recovery.restoreRecoveryBundle(plain(bundle)));dest.as.setItem=set;await recovery.rollbackPendingRecovery();
 for(const [k,v]of originalFiles)assert.equal(dest.files.get(k),v,k);for(const [k,v]of originalKv)assert.equal(dest.kv.get(k),v,k);
});

test('a large restore journal cannot poison Android storage with an unreadable transaction row',async()=>{
 const {recoveryFixture}=require('./recovery-test-helpers.cjs');const source=recoveryFixture();const c=character();c.messages=[{id:'u',role:'user',content:'完整长历史'.repeat(100000),timestamp:1}];source.kv.set('@agentsoul_conversations',JSON.stringify([c]));const bundle=await source.load('src/services/recoveryBundle.ts').collectRecoveryBundle();const dest=recoveryFixture(),get=dest.as.getItem;
 dest.as.getItem=async k=>{const raw=await get(k);if(raw&&raw.length>262144)throw Error('Row too big');return raw;};
 await dest.load('src/services/recoveryBundle.ts').restoreRecoveryBundle(plain(bundle));assert.equal(dest.kv.has('@soulmate_recovery_transaction'),false);const loaded=await dest.load('src/services/agentsoulStorage.ts').loadConversations();assert.equal(loaded.corrupt,false);assert.equal(loaded.conversations[0].messages[0].content,c.messages[0].content);
});

test('a failed large restore can restart and roll back using its verified file journal',async()=>{
 const {recoveryFixture}=require('./recovery-test-helpers.cjs');const source=recoveryFixture(),large=character();large.messages=[{id:'u',role:'user',content:'长历史'.repeat(100000),timestamp:1}];source.kv.set('@agentsoul_conversations',JSON.stringify([large]));const bundle=await source.load('src/services/recoveryBundle.ts').collectRecoveryBundle(),dest=recoveryFixture();dest.kv.set('@agentsoul_conversations',JSON.stringify([{...character(),name:'必须保留的原角色'}]));
 const before=new Map(dest.kv),set=dest.as.setItem;dest.as.setItem=async(k,v)=>{if(k.startsWith('@soulmate_recovery_archive_'))throw Error('archive failed');return set(k,v);};await assert.rejects(dest.load('src/services/recoveryBundle.ts').restoreRecoveryBundle(plain(bundle)));dest.as.setItem=set;
 const pointer=JSON.parse(dest.kv.get('@soulmate_recovery_transaction'));assert.equal(pointer.format,'soulmate.recovery-journal.file.v1');assert.ok(dest.files.get('file://docs/'+pointer.file).length>262144);
 const fresh=fixture({'react-native':{Platform:{OS:'android'}},'expo-file-system':{File:class{}},'@react-native-async-storage/async-storage':dest.as,'expo-file-system/legacy':dest.fm});await fresh.load('src/services/recoveryBundle.ts').rollbackPendingRecovery();for(const [k,v]of before)assert.equal(dest.kv.get(k),v);const read=await fresh.load('src/services/agentsoulStorage.ts').loadConversations();assert.equal(read.conversations[0].name,'必须保留的原角色');assert.equal(read.corrupt,false);
});

test('raw rescue keeps readable files when a database row fails and declares the missing data',async()=>{
 const {recoveryFixture}=require('./recovery-test-helpers.cjs');const f=recoveryFixture();f.kv.set('@agentsoul_conversations','oversized original');f.files.set('file://docs/soulmate_conversations.json','exact original file bytes');const get=f.as.getItem;f.as.getItem=async k=>{if(k==='@agentsoul_conversations')throw Error('row too big');return get(k);};
 f.fm.StorageAccessFramework={requestDirectoryPermissionsAsync:async()=>({granted:true,directoryUri:'file://export/'}),createFileAsync:async()=> 'file://export/rescue.json'};
 assert.equal(await f.load('src/services/recoveryBundle.ts').exportRawRecoveryFile(),true);const raw=JSON.parse(f.files.get('file://export/rescue.json'));assert.equal(raw.complete,false);assert.ok(raw.readFailures.some(x=>x.includes('@agentsoul_conversations')));assert.equal(raw.files['soulmate_conversations.json'],'exact original file bytes');assert.equal(f.kv.get('@agentsoul_conversations'),'oversized original');
});

test('failed large-file writes cannot advance database receipts or overwrite the small rollback snapshot',async()=>{
 const f=fixture(),{SnapshotStore}=f.load('src/services/snapshotStore.ts'),s=new SnapshotStore('k','k.json',Array.isArray);await s.write(['before']);const body=f.kv.get('k'),head=f.kv.get('k:head');f.faults.file=true;
 await assert.rejects(s.write(['large'.repeat(100000)]));assert.equal(f.kv.get('k'),body);assert.equal(f.kv.get('k:head'),head);
});

test('a temporary model/configuration read failure stays retryable instead of permanently caching defaults',async()=>{
 const f=fixture();f.kv.set('agentfile_provider_migrated_v1','1');f.kv.set('agentfile_model_qwen','user-selected-model');f.kv.set('agentfile_custom_provider',JSON.stringify({name:'接口',baseUrl:'https://real.example/v1',model:'real'}));const get=f.as.getItem;let fail=true;
 f.as.getItem=async k=>{if(fail&&['agentfile_model_qwen','agentfile_custom_provider'].includes(k))throw Error('locked');return get(k);};const p=f.load('src/services/llmProviders.ts');
 await assert.rejects(p.getModelForProvider('qwen'));await assert.rejects(p.getCustomProvider());fail=false;assert.equal(await p.getModelForProvider('qwen'),'user-selected-model');assert.equal((await p.getCustomProvider()).model,'real');
});

test('an optional thinking-compatibility cache write cannot hang a successful model response',async()=>{
 let calls=0,release;const f=fixture({fetch:async()=>++calls===1?new Response('thinking is not supported',{status:400}):new Response('{"choices":[{"message":{"content":"有效正文"}}]}')});const set=f.as.setItem;f.as.setItem=async(k,v)=>{if(k.startsWith('agentfile_nothinking_'))await new Promise(r=>release=r);return set(k,v);};
 const p=f.load('src/services/llmProviders.ts'),config={...await p.getLLMConfig(),provider:'custom',baseUrl:'https://proxy.invalid',model:'custom'};const task=p.postChat({config,messages:[],stream:false});
 try{const result=await Promise.race([task,new Promise(r=>setTimeout(()=>r(null),60))]);assert.ok(result);assert.equal((await result.json()).choices[0].message.content,'有效正文');}finally{release?.();await task;}
});

test('a rejected optimistic mutation cannot poison every subsequent chat save',async()=>{
 const h=await provider();try{
  await assert.rejects(h.api().updateConversation('a',{settings:{...h.api().activeConversation.settings,temperature:NaN}}));
  assert.equal(h.api().activeConversation.settings.temperature,.7);await h.api().sendMessage('还可以正常聊吗');
  const {fixture}=require('./harness.cjs');const fresh=fixture({'@react-native-async-storage/async-storage':h.f.as,'expo-file-system/legacy':h.f.fm});
  const disk=await fresh.load('src/services/agentsoulStorage.ts').loadConversations();assert.equal(disk.corrupt,false);assert.equal(disk.conversations[0].messages.at(-1).content,'真正的回复');
 }finally{h.host.close();}
});

test('normalizing legacy split replies keeps their memory-version references valid and recallable',async()=>{
 const f=fixture(),story=f.load('src/services/storyEngine.ts'),valid=f.load('src/services/dataValidation.ts').validConversations,c=character();
 c.messages=[{id:'u',role:'user',content:'我们的约定',timestamp:1},{id:'part1',role:'assistant',content:'周日一起去海边。',inReplyTo:'u',timestamp:2},{id:'part2',role:'assistant',content:'我会提前联系。',inReplyTo:'u',timestamp:3}];
 c.memories=[{id:'promise',content:'双方约定周日去海边并提前联系',kind:'agreement',tags:[],weight:80,isFlashbulb:false,timestamp:3,source:{characterId:'a',conversationId:'a',scene:'private',messageIds:['u','part1','part2'],replies:c.messages.slice(1).map(m=>({messageId:m.id,versionId:story.selectedVersion(m).id}))}}];
 assert.equal(valid([c]),true);const hydrated=story.hydrateStory(c);assert.equal(hydrated.messages.length,2);assert.equal(valid([hydrated]),true);assert.equal(story.activeMemories(hydrated).length,1);
 const h=await provider({},f=>f.kv.set('@agentsoul_conversations',JSON.stringify([c])));try{await h.api().sendMessage('接着聊');assert.equal(h.api().storageWarning,null);const raw=h.f.kv.get('@soulmate_conversations_commit_v1');assert.equal(JSON.parse(JSON.parse(raw).payload)[0].messages.at(-1).content,'真正的回复');}finally{h.host.close();}
});

test('legacy split blocks do not create recursively invalid legacyParts during normalization',()=>{
 const f=fixture(),story=f.load('src/services/storyEngine.ts'),valid=f.load('src/services/dataValidation.ts').validConversations,c=character();
 const a={id:'p1',role:'assistant',content:'一',timestamp:2,inReplyTo:'u'},b={id:'p2',role:'assistant',content:'二',timestamp:3,inReplyTo:'u'};
 c.messages=[{id:'u',role:'user',content:'输入',timestamp:1},{...a,legacyParts:[{...a}]},{...b,legacyParts:[{...b}]}];assert.equal(valid([c]),true);const hydrated=story.hydrateStory(c);assert.equal(valid([hydrated]),true);assert.equal(hydrated.messages[1].content,'一二');
});

test('legacy full-reply normalization preserves selected tail versions and never duplicates old tails',()=>{
 const f=fixture(),story=f.load('src/services/storyEngine.ts'),c=character();c.messages=[{id:'u',role:'user',content:'输入',timestamp:1},
 {id:'p1',role:'assistant',content:'新第一句。',versions:[{content:'旧第一句。'}],versionIndex:1,timestamp:2,inReplyTo:'u'},
 {id:'p2',role:'assistant',content:'新第二句。',versions:[{content:'选中的旧第二句。'}],versionIndex:1,timestamp:3,inReplyTo:'u'},
 {id:'p3',role:'assistant',content:'第三句。',timestamp:4,inReplyTo:'u'}];
 const hydrated=story.hydrateStory(c),m=hydrated.messages[1];assert.equal(story.selectedVersion(m).content,'旧第一句。选中的旧第二句。第三句。');
 assert.equal(m.content,'新第一句。选中的旧第二句。第三句。');assert.equal(m.legacyParts[1].content,'新第二句。');assert.equal(f.load('src/services/dataValidation.ts').validConversations([hydrated]),true);
});

test('stop releases private request ownership during an unresponsive credential preflight, without posting a ghost message',async()=>{
 let hang=false,release,entered=false;const h=await provider({'../services/storage':{getApiKey:async()=>{if(hang){entered=true;await new Promise(r=>release=r);}return 'TEST-ONLY';}}});
 let sending;
 try{hang=true;sending=h.api().sendMessage('尚未发出的消息');void sending.catch(()=>{});await until(()=>entered);h.api().stopMessage();await tick();await tick();assert.equal(h.api().isStreaming,false);assert.equal(h.api().activeConversation.messages.length,0);
 }finally{hang=false;release?.();await sending?.catch(()=>{});h.host.close();}
});

test('the actual model request can start while the initial disk write is slow, and final history still saves in order',async()=>{
 let requests=0,release,waiting=false;const h=await provider({fetch:async()=>{requests++;return response('模型已经返回');}});let sending;
 const write=h.f.fm.writeAsStringAsync,set=h.f.as.setItem;let block=true;
 const wait=async()=>{if(block){waiting=true;await new Promise(r=>{const previous=release;release=()=>{previous?.();r();};});}};
 h.f.as.setItem=async(k,v)=>{if(k==='@soulmate_conversations_commit_v1')await wait();return set(k,v);};
 h.f.fm.writeAsStringAsync=async(k,v)=>{if(k.endsWith('soulmate_conversations.commit.json.pending'))await wait();return write(k,v);};
 try{sending=h.api().sendMessage('慢盘也要先请求');await until(()=>waiting);await new Promise(r=>setTimeout(r,60));assert.equal(requests,1);assert.equal(h.api().activeConversation.messages.at(-1).content,'模型已经返回');assert.equal(h.api().activeConversation.messages.at(-1).isStreaming,false);assert.equal(h.api().isStreaming,false);
 }finally{block=false;release?.();await sending;h.host.close();}
 const raw=h.f.kv.get('@soulmate_conversations_commit_v1');assert.equal(JSON.parse(JSON.parse(raw).payload)[0].messages.at(-1).content,'模型已经返回');
});

test('the drawer has an immediate explicit exit, and new-chat persistence cannot trap it open',async()=>{
 let closes=0,release;const h=ui({api:{createNew:()=>new Promise(r=>release=r)}});try{
  h.start('screens/AgentSoulSidebar',{onCloseDrawer:()=>closes++});const close=nodes(h.host.tree,n=>n.props.accessibilityLabel==='关闭侧边栏')[0];assert.ok(close);close.props.onPress();assert.equal(closes,1);
  const create=nodes(h.host.tree,n=>n.type==='TouchableOpacity'&&label(n).includes('新建对话'))[0];create.props.onPress();assert.equal(closes,2);
 }finally{release?.('new');h.host.close();}
});

test('discarding a new draft after a failed draft read never deletes the unreadable original',async()=>{
 const h=ui();const raw='unreadable original draft';h.f.kv.set('@soulmate_moments_draft',raw);
 try{h.start('screens/MomentsPublishScreen');await until(()=>nodes(h.host.tree,n=>n.type==='TextInput'&&n.props.placeholder==='分享这一刻的想法...')[0]?.props.editable);nodes(h.host.tree,n=>n.type==='TextInput')[0].props.onChangeText('另一篇新动态');await tick();button(h.host.tree,'取消').props.onPress();await tick();const modal=nodes(h.host.tree,n=>n.type==='GlassModal')[0];await modal.props.onCancel();await tick();assert.equal(h.f.kv.get('@soulmate_moments_draft'),raw);
 }finally{h.host.close();}
});

test('a failed explicit draft save keeps the editor open and gives failure feedback',async()=>{
 const h=ui();try{h.start('screens/MomentsPublishScreen');await until(()=>nodes(h.host.tree,n=>n.type==='TextInput')[0]?.props.editable);nodes(h.host.tree,n=>n.type==='TextInput')[0].props.onChangeText('需要保存的草稿');await tick();button(h.host.tree,'取消').props.onPress();await tick();h.f.faults.kv=true;await nodes(h.host.tree,n=>n.type==='GlassModal')[0].props.onConfirm();assert.equal(h.navigation.backs,0);assert.ok(h.alerts.length);
 }finally{h.host.close();}
});

test('group replies stay after their parent question even when existing timestamps are ahead of the clock',async()=>{
 const a=character(),g={...character('g'),type:'group',memberIds:['a']};const h=ui({api:{conversations:[a,g],updateConversation:async()=>{}},mocks:{fetch:async()=>response('本轮回答')}});
 const t=Date.now()+86400000;h.f.kv.set('@soulmate_group_msgs_g',JSON.stringify([{id:'old-u',role:'user',content:'旧问题',timestamp:t},{id:'old-a',role:'assistant',content:'旧回复',inReplyTo:'old-u',senderId:'a',timestamp:t+1}]));
 try{h.start('screens/GroupChatScreen',{route:{params:{convId:'g'}}});await until(()=>nodes(h.host.tree,n=>n.type==='FlatList')[0]?.props.data.length===2);nodes(h.host.tree,n=>n.type==='TextInput')[0].props.onChangeText('时钟变化后的问题');await tick();nodes(h.host.tree,n=>n.type==='TouchableOpacity'&&label(n)==='↑')[0].props.onPress();await until(()=>nodes(h.host.tree,n=>n.type==='FlatList')[0]?.props.data.length===4);const msgs=await h.f.load('src/services/groupStorage.ts').loadGroupMessages('g');const turns=h.f.load('src/services/conversationContext.ts').completeTurns(msgs);assert.equal(turns.length,2);assert.equal(turns.at(-1).assistants[0].content,'本轮回答');
 }finally{h.host.close();}
});

test('group stop also releases ownership during credential preflight without adding a ghost turn',async()=>{
 let release,entered=false;const a=character(),g={...character('g'),type:'group',memberIds:['a']};const h=ui({api:{conversations:[a,g]},mocks:{'../services/storage':{getApiKey:async()=>{entered=true;await new Promise(r=>release=r);return 'TEST-ONLY';}}}});
 try{h.start('screens/GroupChatScreen',{route:{params:{convId:'g'}}});await tick();await tick();nodes(h.host.tree,n=>n.type==='TextInput')[0].props.onChangeText('不要再发送');await tick();button(h.host.tree,'↑').props.onPress();await until(()=>entered);button(h.host.tree,'■').props.onPress();await tick();await tick();assert.ok(nodes(h.host.tree,n=>n.type==='TouchableOpacity'&&label(n)==='↑').length);assert.equal((await h.f.load('src/services/groupStorage.ts').loadGroupMessages('g')).length,0);
 }finally{release?.();await tick();h.host.close();}
});

test('deleting a social source cancels even its still-pending context preflight',async()=>{
 let release;const f=fixture({'./storage':{getApiKey:()=>new Promise(r=>release=r)}}),ctl=new AbortController();const task=f.load('src/services/momentsAI.ts').generateAIReply('角色','设定','评论',undefined,'设定',undefined,{aiConvId:'a',signal:ctl.signal});void task.catch(()=>{});ctl.abort();
 try{const result=await Promise.race([task.then(()=>false,()=>true),new Promise(r=>setTimeout(()=>r(false),50))]);assert.equal(result,true);}finally{release?.('TEST-ONLY');await task.catch(()=>{});}
});

test('Android back can dismiss the actual chat game-picker modal',async()=>{
 const h=ui();try{h.start('screens/AgentSoulChatScreen');const modal=nodes(h.host.tree,n=>n.type==='Modal')[0];assert.equal(typeof modal.props.onRequestClose,'function');modal.props.onRequestClose();await tick();assert.equal(nodes(h.host.tree,n=>n.type==='Modal')[0].props.visible,false);}finally{h.host.close();}
});

test('an unreadable unused custom profile cannot block loading the selected official provider',async()=>{
 const h=ui({api:{checkApiKey:async()=>true}});h.f.kv.set('agentfile_custom_provider','broken custom profile');
 try{h.start('screens/ApiKeyScreen');await until(()=>!button(h.host.tree,'测试连接').props.disabled);const model=nodes(h.host.tree,n=>n.type==='TextInput'&&n.props.placeholder==='也可手动填写模型 ID')[0];assert.equal(model.props.value,'deepseek-flash');assert.ok(label(h.host.tree).includes('DeepSeek · deepseek-flash'));}finally{h.host.close();}
});

test('successful API save cannot navigate away after its screen has closed',async()=>{
 const h=ui({api:{checkApiKey:async()=>true}});try{h.start('screens/ApiKeyScreen');await until(()=>!button(h.host.tree,'测试连接').props.disabled);await button(h.host.tree,'保存并连接').props.onPress();h.host.close();await new Promise(r=>setTimeout(r,1250));assert.equal(h.navigation.backs,0);}finally{h.host.close();}
});

test('failed API-key deletion is caught and reported without clearing the visible saved key',async()=>{
 const h=ui({api:{checkApiKey:async()=>true},mocks:{'expo-secure-store':{getItemAsync:async()=> 'TEST-ONLY',setItemAsync:async()=>{},deleteItemAsync:async()=>{throw Error('secure storage locked');}}}});
 try{h.start('screens/ApiKeyScreen');await until(()=>label(h.host.tree).includes('删除 DeepSeek 的 API Key'));const key=()=>nodes(h.host.tree,n=>n.type==='TextInput'&&n.props.placeholder==='sk-...')[0].props.value;const before=key();await nodes(h.host.tree,n=>n.type==='GlassModal')[0].props.onConfirm();await tick();assert.equal(key(),before);const toast=nodes(h.host.tree,n=>n.type==='Toast')[0];assert.equal(toast.props.visible,true);assert.match(toast.props.message,/locked|失败/);}finally{h.host.close();}
});

test('full messages, reply versions and memories survive real file IO and a separate Node process restart',async()=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'soulmate-audit-disk-'));
 try{
  const {diskFixture}=require('./disk-fixture.cjs'),f=diskFixture(directory),c=character();c.settings.memoryRecall={enabled:false,interval:10};
  c.messages=[{id:'u',role:'user',content:'完整旧问题',timestamp:1},{id:'r',role:'assistant',content:'完整回复',inReplyTo:'u',timestamp:2,versions:[{content:'原始回复'}],thinking:{kind:'legacy_reasoning',content:'完整保留的思考'.repeat(50000),duration:3,collapsed:false}}];
  c.memories=[{id:'memory',content:'双方约定周末去海边',kind:'agreement',tags:[],weight:80,isFlashbulb:false,timestamp:1,manualLocked:true}];
  const store=f.load('src/services/agentsoulStorage.ts');await store.loadConversations();await store.writeConversationsImmediate([c]);
  const code="const f=require(process.argv[1]).diskFixture(process.argv[2]);f.load('src/services/agentsoulStorage.ts').loadConversations().then(r=>{const c=r.conversations[0];console.log(JSON.stringify({corrupt:r.corrupt,id:c.id,messages:c.messages.length,thinking:c.messages[1].thinking.content.length,versions:c.messages[1].versions[0].content,memory:c.memories[0].content}));}).catch(e=>{console.error(e);process.exitCode=1;});";
  const child=spawnSync(process.execPath,['-e',code,path.join(__dirname,'disk-fixture.cjs'),directory],{encoding:'utf8',timeout:20000});assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout.trim());assert.deepEqual(result,{corrupt:false,id:'a',messages:2,thinking:c.messages[1].thinking.content.length,versions:'原始回复',memory:c.memories[0].content});
 }finally{
  // Only remove the checked, newly-created fixture directory.
  const root=path.resolve(os.tmpdir());assert.ok(path.resolve(directory).startsWith(root+path.sep));assert.ok(path.basename(directory).startsWith('soulmate-audit-disk-'));await fs.rm(directory,{recursive:true,force:true});
 }
});
