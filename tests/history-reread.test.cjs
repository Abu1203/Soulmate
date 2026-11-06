const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ui,character,until,nodes,label}=require('./ui-harness.cjs');
const COMMIT='@soulmate_conversations_commit_v1';
const FILE='file://docs/soulmate_conversations.commit.json';
function role(){return {...character(),settings:{...character().settings,memoryRecall:{enabled:false,interval:10}},messages:[{id:'u',role:'user',content:'不能遗失的历史',timestamp:1},{id:'a1',role:'assistant',content:'旧回复',timestamp:2,inReplyTo:'u'}]};}
async function mount(seed){const h=ui();await seed(h.f);const Provider=h.f.load('src/contexts/AgentSoulContext.tsx').AgentSoulProvider;h.host.start(()=>Provider({children:null}));h.api=()=>h.host.tree.props.value;await until(()=>h.api().hasApiKey&&h.api().storageWarning!==null);return h;}

test('retry exposes a now-readable attested history after initial empty protection, without changing any disk bytes',async()=>{
 let readable=false;
 const h=await mount(async f=>{
  const {SnapshotStore}=f.load('src/services/snapshotStore.ts');await new SnapshotStore(COMMIT,'soulmate_conversations.commit.json',Array.isArray).write([role()]);
  const get=f.as.getItem,read=f.fm.readAsStringAsync;
  f.as.getItem=async k=>{if(k===COMMIT)throw Error('Row too big');return get(k);};
  f.fm.readAsStringAsync=async k=>{if(k===FILE&&!readable)throw Error('temporarily unavailable');return read(k);};
 });
 try{
  assert.equal(h.api().conversations.length,0);const kv=[...h.f.kv],files=[...h.f.files];readable=true;
  await h.api().loadList();assert.equal(h.api().conversations.length,1);assert.equal(h.api().activeConversation.messages[0].content,'不能遗失的历史');
  assert.equal(h.api().storageUncertain,true);assert.deepEqual([...h.f.kv],kv);assert.deepEqual([...h.f.files],files);
 }finally{h.host.close();}
});

test('retry never replaces an already visible conversation with an ambiguous empty result',async()=>{
 const h=await mount(async f=>{f.kv.set('@agentsoul_conversations',JSON.stringify([role()]));f.files.set('file://docs/soulmate_conversations.json','broken peer');});
 try{
  assert.equal(h.api().conversations.length,1);h.f.kv.set('@agentsoul_conversations','temporarily broken');
  await h.api().loadList();assert.equal(h.api().conversations.length,1);assert.equal(h.api().activeConversation.messages[0].content,'不能遗失的历史');
 }finally{h.host.close();}
});

test('a slow retry cannot replace a conversation changed and saved while the retry was reading',async()=>{
 const h=await mount(async f=>{f.kv.set('@agentsoul_conversations',JSON.stringify([role()]));f.files.set('file://docs/soulmate_conversations.json','broken peer');});
 let release;
 try{
  // First establish a healthy independent commit, so a subsequent read can succeed.
  await h.api().updateConversation('a',{name:'读取开始前'});
  const get=h.f.as.getItem;let waiting=false;
  h.f.as.getItem=async k=>{if(k==='@soulmate_ai_personas'){waiting=true;await new Promise(r=>{release=r;});}return get(k);};
  const loading=h.api().loadList();await until(()=>waiting);
  const messages=[...h.api().conversations[0].messages,{id:'new-user',role:'user',content:'读取途中刚发出的消息',timestamp:3}];
  await h.api().updateConversation('a',{name:'读取途中已保存的新名称',messages});release();release=null;await loading;
  assert.equal(h.api().conversations[0].name,'读取途中已保存的新名称');
  assert.equal(h.api().conversations[0].messages.at(-1).content,'读取途中刚发出的消息');
  // A later save must not commit the stale read and erase the already-saved message.
  await h.api().updateConversation('a',{isPinned:true});
  const storage=h.f.load('src/services/agentsoulStorage.ts');const disk=JSON.parse(JSON.parse(h.f.kv.get(storage.CONTINUITY_KEY)).payload);
  assert.equal(disk[0].messages.at(-1).content,'读取途中刚发出的消息');
 }finally{release?.();h.host.close();}
});

test('unreadable history is not presented as a genuinely empty conversation list',()=>{
 const h=ui({api:{conversations:[],activeConversation:null,storageUncertain:true,storageWarning:'历史读取失败'}});
 try{h.start('screens/AgentSoulSidebar');const list=nodes(h.host.tree,n=>n.type==='FlatList')[0];assert.match(label(list.props.ListEmptyComponent),/未能读取/);assert.doesNotMatch(label(list.props.ListEmptyComponent),/暂无对话/);}finally{h.host.close();}
});
