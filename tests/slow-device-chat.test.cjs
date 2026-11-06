const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ui,character,until,tick}=require('./ui-harness.cjs');
const {fixture}=require('./harness.cjs');
const gate=()=>{let release;return {promise:new Promise(r=>release=r),release:()=>release()};};
const response=text=>new Response('data:'+JSON.stringify({choices:[{delta:{content:text},finish_reason:'stop'}]})+'\n\ndata:[DONE]\n\n');
async function provider(fetch){
 const h=ui({mocks:{fetch}}),c=character();c.settings.memoryRecall={enabled:false,interval:10};
 h.f.kv.set('@agentsoul_conversations',JSON.stringify([c]));h.f.kv.set('@agentsoul_active','a');
 const Provider=h.f.load('src/contexts/AgentSoulContext.tsx').AgentSoulProvider;
 h.host.start(()=>Provider({children:null}));h.api=()=>h.host.tree.props.value;
 await until(()=>h.api().activeConversation&&h.api().hasApiKey);return h;
}
function slowFirstWrite(f){const g=gate(),write=f.fm.writeAsStringAsync;let entered=false;
 f.fm.writeAsStringAsync=async(k,v)=>{if(!entered&&k.endsWith('soulmate_conversations.commit.json.pending')){entered=true;await g.promise;}return write(k,v);};
 return {...g,entered:()=>entered};
}
async function restart(f){return fixture({'@react-native-async-storage/async-storage':f.as,'expo-file-system/legacy':f.fm}).load('src/services/agentsoulStorage.ts').loadConversations();}

test('second turn displays and reaches the model before the preceding disk save finishes; restart retains both',async()=>{
 const requests=[];const h=await provider(async(_u,init)=>{requests.push(JSON.parse(init.body));return response('reply '+requests.length);});
 const disk=slowFirstWrite(h.f);let first,second,firstSettled=false;
 try{
  first=h.api().sendMessage('first').then(()=>{firstSettled=true;});
  await until(()=>disk.entered()&&!h.api().isStreaming&&h.api().activeConversation.messages.at(-1)?.content==='reply 1');
  second=h.api().sendMessage('second');
  await until(()=>requests.length===2&&!h.api().isStreaming&&h.api().activeConversation.messages.at(-1)?.content==='reply 2');
  assert.equal(firstSettled,false);assert.equal(h.api().activeConversation.messages.length,4);
  assert.ok(requests[1].messages.some(m=>m.role==='assistant'&&m.content==='reply 1'));
  await h.api().loadList();assert.equal(h.api().activeConversation.messages.length,4);
  disk.release();await Promise.all([first,second]);
  const loaded=await restart(h.f);assert.equal(loaded.corrupt,false);assert.deepEqual(Array.from(loaded.conversations[0].messages,m=>m.content),['first','reply 1','second','reply 2']);
 }finally{disk.release();await Promise.allSettled([first,second]);h.host.close();}
});

test('stop and duplicate-send protection work on the next turn while the previous save is slow',async()=>{
 const network=gate();let requests=0;const h=await provider(async()=>++requests===1?response('reply 1'):(await network.promise,response('late reply')));
 const disk=slowFirstWrite(h.f);let first,second;
 try{
  first=h.api().sendMessage('first');await until(()=>disk.entered()&&!h.api().isStreaming);
  second=h.api().sendMessage('second');await until(()=>requests===2);
  await assert.rejects(h.api().sendMessage('duplicate'),/生成/);
  h.api().stopMessage();await until(()=>!h.api().isStreaming);
  assert.match(h.api().activeConversation.messages.at(-1).error,/停止|超时/);
  network.release();disk.release();await Promise.all([first,second]);
  const loaded=await restart(h.f);assert.equal(loaded.conversations[0].messages.length,4);assert.notEqual(loaded.conversations[0].messages.at(-1).content,'late reply');
 }finally{network.release();disk.release();await Promise.allSettled([first,second]);h.host.close();}
});

test('failed chat writes keep both turns in memory, show failure, and retry the latest complete history',async()=>{
 let calls=0;const h=await provider(async()=>response('reply '+(++calls)));
 try{
  h.f.faults.kv=h.f.faults.file=true;
  await h.api().sendMessage('first');await h.api().sendMessage('second');
  assert.equal(h.api().activeConversation.messages.length,4);assert.match(h.api().storageWarning,/保存/);
  h.f.faults.kv=h.f.faults.file=false;
  assert.equal(await h.api().retryPendingSave(),true);
  assert.equal((await restart(h.f)).conversations[0].messages.length,4);
 }finally{h.host.close();}
});

test('an earlier failed snapshot cannot be retried over a later successful queued snapshot',async()=>{
 const f=fixture(),s=f.load('src/services/agentsoulStorage.ts');await s.loadConversations();
 const disk=gate(),set=f.as.setItem,write=f.fm.writeAsStringAsync;let entered=false;
 const fail=async value=>{try{if(JSON.parse(JSON.parse(value).payload)[0].name==='old'){entered=true;await disk.promise;throw Error('old write failed');}}catch(e){if(e.message==='old write failed')throw e;}};
 f.as.setItem=async(k,v)=>{if(k==='@soulmate_conversations_commit_v1')await fail(v);return set(k,v);};
 f.fm.writeAsStringAsync=async(k,v)=>{if(k.endsWith('.pending'))await fail(v);return write(k,v);};
 const first=s.saveConversations([{...character(),name:'old'}]);const rejected=assert.rejects(first);const flushingFirst=s.flushConversationsNow();
 await until(()=>entered);assert.equal(s.hasPendingConversationWrites(),true);
 const next=s.saveConversations([{...character(),name:'new'}]);const flushingNext=s.flushConversationsNow();disk.release();
 await Promise.all([rejected,flushingFirst,next,flushingNext]);assert.equal(s.hasPendingConversationWrites(),false);
 await s.flushConversationsNow();assert.equal((await restart(f)).conversations[0].name,'new');
});

test('deleting a role after a displayed reply waits for pending saves and cannot be resurrected by them',async()=>{
 const h=await provider(async()=>response('reply'));const disk=slowFirstWrite(h.f);let sending,deleting;
 try{
  sending=h.api().sendMessage('hello');await until(()=>disk.entered()&&!h.api().isStreaming);
  deleting=h.api().deleteConversation('a');await tick();assert.equal(h.api().conversations.length,1);
  disk.release();await Promise.all([sending,deleting]);assert.equal(h.api().conversations.length,0);
  assert.equal((await restart(h.f)).conversations.length,0);
 }finally{disk.release();await Promise.allSettled([sending,deleting]);h.host.close();}
});

test('group background reads overlap with bounded concurrency and keep exact selection/tie order',async()=>{
 const f=fixture(),{buildGroupInteractionBlock}=f.load('src/services/contextBundle.ts');const gates=Array.from({length:6},gate);let active=0,max=0,started=[];
 const task=buildGroupInteractionBlock({aiConvId:'a',aiName:'role',conversations:Array.from({length:6},(_,i)=>({id:String(i),name:'Group'+i,type:'group',memberIds:['a']})),maxGroups:2,loadGroupMsgs:async id=>{
  active++;max=Math.max(max,active);started.push(+id);await gates[+id].promise;active--;return [{role:'user',content:'entry'+id,timestamp:1}];
 }});
 try{
  await until(()=>started.length===3);assert.equal(max,3);
  gates[2].release();await until(()=>started.length===4);gates[1].release();await until(()=>started.length===5);gates[0].release();await until(()=>started.length===6);
  gates.forEach(g=>g.release());const text=await task;assert.ok(text.includes('Group0'));assert.ok(text.includes('Group1'));assert.ok(!text.includes('Group2'));assert.ok(text.indexOf('Group0')<text.indexOf('Group1'));assert.equal(max,3);
 }finally{gates.forEach(g=>g.release());await task;}
});

test('private preflight reads feed and group context concurrently without dropping either source',async()=>{
 const feed=gate(),group=gate();let feedStarted=false,groupStarted=false;
 const f=fixture({'./momentsStorage':{loadMoments:async()=>{feedStarted=true;await feed.promise;return [];}} ,'./contextBundle':{buildMomentsInteractionBlock:()=> 'feed evidence',createGroupMsgsLoader:()=>()=>[],buildGroupInteractionBlock:async()=>{groupStarted=true;await group.promise;return 'group evidence';}}});
 const task=f.load('src/services/SoulService.ts').buildCharacterRequest({character:character(),history:[],query:'hello',conversations:[character()]});
 try{await until(()=>feedStarted&&groupStarted);feed.release();group.release();const request=await task;assert.ok(request.messages[0].content.includes('feed evidence'));assert.ok(request.messages[0].content.includes('group evidence'));assert.equal(request.thinking,true);}
 finally{feed.release();group.release();await task;}
});

test('cooperative checksum preserves the existing format and permits event-loop progress during a large save',async()=>{
 const f=fixture(),{checksum,checksumCooperatively}=f.load('src/services/snapshotStore.ts');
 for(const text of ['', '中文\u0000😀', 'a'.repeat(32768)+'💚尾'])assert.equal(await checksumCooperatively(text),checksum(text));
 const text='共同经历😀'.repeat(250000);let yielded=false;const timer=setTimeout(()=>{yielded=true;},0);
 const actual=await checksumCooperatively(text);clearTimeout(timer);assert.equal(yielded,true);assert.equal(actual,checksum(text));
});
